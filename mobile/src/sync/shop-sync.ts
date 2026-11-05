import { ApiError, isOffline, type ApiClient } from "../api/client.ts";
import {
  confirmPhotos,
  photoTickets,
  photoUrls,
  reportSyncIssues,
  syncPull,
  syncPush,
  syncSnapshot,
} from "../api/endpoints.ts";
import type { PhotoConfirm } from "../api/types.ts";
import { SYNC_SCHEMA_VERSION, type PulledRecord } from "../contracts/sync.ts";
import type { Applied } from "../db/repositories/remote.ts";
import type { SnapshotProgress } from "../db/repositories/sync-state.ts";
import type { ShopStore } from "../db/store.ts";
import type { OutboxOp, SyncedFile, SyncIssue } from "../db/types.ts";
import { bindShop } from "./bind.ts";
import type { FileStore } from "./types.ts";

const PUSH_LIMIT = 200;
/** Batches per run: a backlog drains over a few runs instead of holding the network. */
const PUSH_BATCHES = 10;
const TICKET_BATCH = 50;
const URL_BATCH = 100;
const FILE_CONCURRENCY = 2;
/** Images uploaded or downloaded per run, so a first sync of a big shop stays responsive. */
const FILES_PER_RUN = 300;
const ISSUE_BATCH = 100;

export type SyncState =
  /** The run finished; everything this phone had was sent and the shop is up to date. */
  | "synced"
  | "offline"
  /** The server or the data failed in an unexpected way; retried later. */
  | "error"
  /** The shop is suspended: changes wait on this phone until it is active again. */
  | "paused"
  /** This app is too old for the server's sync. */
  | "update_required"
  /** This phone was removed from the shop: nothing is sent any more. */
  | "revoked";

export type SyncOutcome = {
  state: SyncState;
  changed: Applied;
  message?: string;
};

export type ShopSyncOptions = {
  api: ApiClient;
  store: ShopStore;
  files: FileStore;
  shopId: string;
  deviceId: string;
  claimant: boolean;
  modelVersion: string;
};

/**
 * One sync run for one shop file, in the order that keeps the server consistent:
 * bind (once) → upload images → push the outbox → pull (or download the shop) → report
 * issues → download images. Each step leaves the file consistent, so a run interrupted anywhere (no signal,
 * app closed) simply continues next time. The till never waits for any of it.
 */
export class ShopSync {
  private options: ShopSyncOptions;
  private changed: Applied = { catalogue: false, sales: false, embeddings: false };

  constructor(options: ShopSyncOptions) {
    this.options = options;
  }

  async run(): Promise<SyncOutcome> {
    const { store, files, shopId, claimant, modelVersion } = this.options;
    try {
      await bindShop(store, files, { shopId, claimant, modelVersion });
      await bestEffort(this.uploadImages());
      const pushed = await this.push();
      await this.pull();
      // Up to date: whatever is still waiting for a record it refers to is reported.
      store.remote.escalateStale();
      await bestEffort(this.reportIssues());
      await bestEffort(this.downloadImages());
      store.sync.markSynced();
      return { state: pushed, changed: this.changed };
    } catch (cause) {
      return { ...describe(cause), changed: this.changed };
    }
  }

  private get api() {
    return this.options.api;
  }

  private get store() {
    return this.options.store;
  }

  // --- Images -----------------------------------------------------------------------------

  /** Images go up before the changes that refer to them; a failed one never blocks a push. */
  private async uploadImages(): Promise<void> {
    const { store, api, files, shopId } = this;
    store.files.adoptReferenced();
    const tried = new Set<string>();
    while (tried.size < FILES_PER_RUN) {
      const batch = store.files
        .inState("local", TICKET_BATCH + tried.size)
        .filter((file) => !tried.has(file.sha256))
        .slice(0, TICKET_BATCH);
      if (!batch.length) return;
      batch.forEach((file) => tried.add(file.sha256));

      const present = batch.filter((file) => {
        if (files.exists(file.uri)) return true;
        store.files.forget(file.sha256); // Gone from this phone: nothing left to send.
        return false;
      });
      if (!present.length) continue;
      const { tickets } = await photoTickets(
        api,
        shopId,
        present.map((file) => ({
          sha256: file.sha256,
          kind: file.kind,
          bytes: Math.max(1, files.size(file.uri)),
        })),
      );
      const byHash = new Map(present.map((file) => [file.sha256, file]));
      const uploaded: PhotoConfirm[] = [];
      await eachLimited(tickets, FILE_CONCURRENCY, async (ticket) => {
        const file = byHash.get(ticket.sha256);
        if (!file) return;
        if (ticket.existing) return store.files.markUploaded(file.sha256);
        if (!ticket.upload_url || !ticket.fields)
          return store.files.markFailed(file.sha256, ticket.problem ?? "no ticket");
        try {
          const result = await files.upload(file.uri, {
            url: ticket.upload_url,
            fields: ticket.fields,
          });
          uploaded.push({ sha256: file.sha256, kind: file.kind, ...result });
        } catch (cause) {
          store.files.markFailed(file.sha256, String(cause));
        }
      });
      if (!uploaded.length) continue;
      const { confirmed, rejected } = await confirmPhotos(api, shopId, uploaded);
      for (const sha of confirmed) store.files.markUploaded(sha);
      for (const problem of rejected) store.files.markFailed(problem.sha256, problem.code);
    }
  }

  private async downloadImages(): Promise<void> {
    const { store, api, files, shopId } = this;
    const tried = new Set<string>();
    while (tried.size < FILES_PER_RUN) {
      const batch = store.files
        .inState("missing", URL_BATCH + tried.size)
        .filter((file) => !tried.has(file.sha256))
        .slice(0, URL_BATCH);
      if (!batch.length) return;
      batch.forEach((file) => tried.add(file.sha256));
      const { urls } = await photoUrls(api, shopId, batch.map((file) => file.sha256));
      await eachLimited(batch, FILE_CONCURRENCY, async (file: SyncedFile) => {
        const url = urls[file.sha256];
        if (!url) return; // Not uploaded yet by the phone that has it.
        try {
          await files.download(url, file.uri);
          store.files.markDownloaded(file.sha256);
          this.changed.catalogue = true;
          if (file.kind === "crop") this.changed.embeddings = true;
        } catch (cause) {
          store.files.markFailed(file.sha256, String(cause));
        }
      });
    }
  }

  // --- Issues -----------------------------------------------------------------------------

  /** What could not sync as asked goes to the system admin; this phone then forgets it. */
  private async reportIssues(): Promise<void> {
    const { store, api, shopId } = this;
    for (;;) {
      const batch = store.sync.unreported(ISSUE_BATCH);
      if (!batch.length) return;
      const { accepted } = await reportSyncIssues(api, shopId, batch.map(issueToWire));
      store.sync.forgetIssues(accepted);
      if (accepted.length < batch.length) return; // Never expected; avoids looping on it.
    }
  }

  // --- Push -------------------------------------------------------------------------------

  /** Sends queued changes oldest first. "paused" when the shop is suspended. */
  private async push(): Promise<SyncState> {
    const { store, api, shopId } = this;
    let limit = PUSH_LIMIT;
    for (let batch = 0; batch < PUSH_BATCHES; batch++) {
      const ops = store.outbox.batch(limit);
      if (!ops.length) break;
      let response;
      try {
        response = await syncPush(api, shopId, {
          device_id: this.options.deviceId,
          schema_version: SYNC_SCHEMA_VERSION,
          ops: ops.map(toWire),
        });
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 413 && ops.length > 1) {
          limit = Math.max(1, Math.floor(ops.length / 2));
          continue;
        }
        if (cause instanceof ApiError && cause.code === "shop_suspended") return "paused";
        throw cause;
      }
      this.recordPush(ops, response.acked, response.rejected, response.flagged, response.seq);
      limit = PUSH_LIMIT;
    }
    return "synced";
  }

  private recordPush(
    ops: readonly OutboxOp[],
    acked: readonly string[],
    rejected: readonly { op_id: string; code: string; message: string }[],
    flagged: readonly string[],
    seq: string,
  ): void {
    const { store } = this;
    const byId = new Map(ops.map((op) => [op.op_id, op]));
    const issue = (opId: string) => {
      const op = byId.get(opId);
      return { entity: op?.entity ?? "unknown", entity_id: op?.entity_id ?? "", op_id: opId };
    };
    store.transaction(() => {
      store.outbox.ack(acked, Number(seq));
      for (const refusal of rejected) {
        store.outbox.reject(refusal.op_id, `${refusal.code}: ${refusal.message}`);
        store.sync.addIssue({
          kind: "rejected",
          ...issue(refusal.op_id),
          code: refusal.code,
          message: refusal.message,
        });
      }
      for (const opId of flagged)
        store.sync.addIssue({
          kind: "flagged",
          ...issue(opId),
          code: "flagged",
          message: "Kept, but recorded for the owner to review.",
        });
    });
  }

  // --- Pull -------------------------------------------------------------------------------

  private async pull(): Promise<void> {
    const { store } = this;
    let restarted = false;
    for (;;) {
      const progress = store.sync.snapshot();
      if (progress) await this.downloadShop(progress);
      try {
        await this.pullChanges();
        return;
      } catch (cause) {
        // The server pruned this phone's history: download the shop again (once per run).
        if (cause instanceof ApiError && cause.status === 410 && !restarted) {
          restarted = true;
          store.sync.restartSnapshot();
          continue;
        }
        throw cause;
      }
    }
  }

  private async pullChanges(): Promise<void> {
    const { store, api, shopId } = this;
    for (;;) {
      const page = await syncPull(api, shopId, store.sync.cursor());
      const records = page.changes.map(
        (change) => ({ entity: change.entity, record: change.record }) as PulledRecord,
      );
      this.apply(records, () => {
        store.sync.setCursor(page.next_cursor);
        // Up to date: this phone's stock is the server's plus what it has not counted yet.
        if (!page.has_more) store.stock.rebase(Number(page.next_cursor));
      });
      if (!page.has_more) return;
    }
  }

  /** A new phone's download of the shop, resumable page by page. */
  private async downloadShop(start: SnapshotProgress): Promise<void> {
    const { store, api, shopId } = this;
    let progress = start;
    while (progress.remaining.length) {
      const [entity, ...rest] = progress.remaining;
      const page = await syncSnapshot(
        api,
        shopId,
        entity,
        progress.after,
        this.options.modelVersion,
      );
      const seq = progress.seq ?? page.snapshot_seq;
      const next: SnapshotProgress = page.has_more
        ? { remaining: progress.remaining, after: page.after, seq }
        : { remaining: rest, after: null, seq };
      const records = page.records.map((record) => ({ entity, record }) as PulledRecord);
      this.apply(records, () => {
        if (next.remaining.length) store.sync.setSnapshot(next);
        else {
          // Done: pull continues from the moment the download started.
          store.sync.setSnapshot(null);
          store.sync.setCursor(seq);
        }
      });
      progress = next;
    }
  }

  private apply(records: readonly PulledRecord[], commit: () => void): void {
    const applied = this.store.remote.applyPage(
      records,
      { modelVersion: this.options.modelVersion, imageUri: (sha) => this.files.uriFor(sha) },
      commit,
    );
    this.changed.catalogue ||= applied.catalogue;
    this.changed.sales ||= applied.sales;
    this.changed.embeddings ||= applied.embeddings;
  }

  private get files() {
    return this.options.files;
  }

  private get shopId() {
    return this.options.shopId;
  }
}

function issueToWire(issue: SyncIssue) {
  return {
    id: issue.id,
    kind: issue.kind,
    entity: issue.entity.slice(0, 64),
    entity_id: issue.entity_id.slice(0, 64),
    op_id: issue.op_id,
    code: issue.code.slice(0, 64),
    message: issue.message.slice(0, 1000),
    created_at: issue.created_at,
  };
}

function toWire(op: OutboxOp) {
  return {
    op_id: op.op_id,
    entity: op.entity,
    entity_id: op.entity_id,
    op: op.op,
    payload: op.payload as Record<string, unknown>,
  };
}

/**
 * Images are not worth failing a run for (e.g. photo storage briefly unavailable): changes
 * still sync and images are retried next run. Losing the connection or the phone's access
 * still ends the run.
 */
async function bestEffort(step: Promise<void>): Promise<void> {
  try {
    await step;
  } catch (cause) {
    const fatal = describe(cause).state;
    if (fatal === "offline" || fatal === "revoked" || fatal === "update_required") throw cause;
  }
}

function describe(cause: unknown): Omit<SyncOutcome, "changed"> {
  if (isOffline(cause)) return { state: "offline" };
  if (cause instanceof ApiError) {
    if (cause.code === "device_revoked" || cause.code === "device_unregistered")
      return { state: "revoked", message: cause.message };
    if (cause.status === 426) return { state: "update_required", message: cause.message };
    if (cause.code === "shop_suspended") return { state: "paused", message: cause.message };
    return { state: "error", message: cause.message };
  }
  return { state: "error", message: cause instanceof Error ? cause.message : String(cause) };
}

/** Runs `work` over `items`, at most `limit` at a time. */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<unknown>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
