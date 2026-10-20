import type { MatchingSpec } from "./manifest.ts";
import type { Candidate } from "./vector-index.ts";

/**
 * Turns a stream of per-embedding rankings into one decision. A product locks in
 * once it wins `needed` of the last `window` embeddings, where a win requires the
 * accept threshold and a clear lead over the runner-up. One lucky frame never decides.
 */
export class MatchVoter {
  private readonly spec: Pick<MatchingSpec, "accept_threshold" | "margin">;
  private readonly window: number;
  private readonly needed: number;
  private votes: (string | null)[] = [];

  constructor(
    spec: Pick<MatchingSpec, "accept_threshold" | "margin">,
    window = 3,
    needed = 2,
  ) {
    this.spec = spec;
    this.window = window;
    this.needed = needed;
  }

  /** Records one ranking (best first) and returns the locked product id, if any. */
  push(ranking: readonly Candidate[]): string | null {
    const [top, second] = ranking;
    const wins =
      top !== undefined &&
      top.score >= this.spec.accept_threshold &&
      top.score - (second?.score ?? 0) >= this.spec.margin;
    this.votes = [...this.votes, wins ? top.productId : null].slice(
      -this.window,
    );
    if (!wins) return null;
    const count = this.votes.filter((id) => id === top.productId).length;
    return count >= this.needed ? top.productId : null;
  }

  reset(): void {
    this.votes = [];
  }
}
