import { Redirect, router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";

import { useSession } from "@/auth/session-provider";
import { LoadingScreen } from "@/components/loading";
import { Sheet } from "@/components/sheet";
import {
  Button,
  Card,
  Chip,
  Divider,
  Empty,
  errorMessage,
  Field,
  Notice,
  Screen,
  SectionHeader,
  TopBar,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import {
  BACKGROUNDS,
  EVALUATION,
  EVALUATION_ENABLED,
  LIGHTING,
} from "@/features/evaluation/config";
import {
  formatLatency,
  formatProportion,
  summariseTrials,
} from "@/features/evaluation/metrics";
import { runModelBenchmarks } from "@/features/evaluation/model-benchmarks";
import { withBenchmarks, type EvaluationRun } from "@/features/evaluation/run";
import { deleteRun, exportRun, listRuns } from "@/features/evaluation/storage";
import type {
  TrialConditions,
  TrialRecord,
  TrialTruth,
} from "@/features/evaluation/trial";
import {
  createRun,
  enrolledProducts,
  runContext,
  useEvaluationTrials,
  type EnrolledProduct,
} from "@/features/evaluation/use-evaluation";
import { useVisionSession } from "@/features/vision/use-vision-session";
import {
  useCameraMode,
  VisionCameraView,
} from "@/features/vision/vision-camera-view";
import { vision, type VisionModels } from "@/features/vision/vision-service";

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/**
 * Research evaluation of recognition accuracy and latency (Menu → Evaluation). Owners only,
 * and only in builds with EXPO_PUBLIC_EVALUATION=1. Runs the till's own recognition but never
 * learns, sells or beeps; results are saved as files, outside the shop's data.
 */
export default function EvaluationScreen() {
  const { can } = useSession();
  if (!EVALUATION_ENABLED || !can("shop:manage")) return <Redirect href="/" />;
  return <EvaluationSession />;
}

function EvaluationSession() {
  const { store } = useShop();
  const session = useVisionSession(() => vision.vectorIndex(store));
  if (session.state === "ready") return <Evaluation models={session.models} />;
  if (session.state === "loading")
    return <LoadingScreen message="Loading the models…" />;
  return (
    <Screen>
      <TopBar title="Evaluation" onBack={leave} />
      <Notice message={session.message} error />
    </Screen>
  );
}

function Evaluation({ models }: { models: VisionModels }) {
  const { store } = useShop();
  const [enrolled] = useState(() => enrolledProducts(store));
  const indexViews = vision.vectorIndex(store).size;
  const context = () => runContext(models, enrolled, indexViews);
  const [open, setOpen] = useState<EvaluationRun | null>(null);
  if (open)
    return (
      <RunScreen
        key={open.id}
        initial={open}
        models={models}
        enrolled={enrolled}
        context={context}
        onClose={() => setOpen(null)}
      />
    );
  return (
    <RunList
      models={models}
      enrolled={enrolled}
      indexViews={indexViews}
      onCreate={(name) => setOpen(createRun(name, context()))}
      onOpen={setOpen}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Run list

function RunList({
  models,
  enrolled,
  indexViews,
  onCreate,
  onOpen,
}: {
  models: VisionModels;
  enrolled: EnrolledProduct[];
  indexViews: number;
  onCreate: (name: string) => void;
  onOpen: (run: EvaluationRun) => void;
}) {
  const c = usePalette();
  const { mode } = useCameraMode();
  const [name, setName] = useState("");
  const [runs, setRuns] = useState(() => safeList());
  const [message, setMessage] = useState<string | null>(null);

  function confirmDelete(run: EvaluationRun) {
    Alert.alert(
      "Delete this run?",
      `"${run.name || "Untitled run"}" and its ${run.trials.length} trials will be removed from this phone. Export it first if you need it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteRun(run.id);
            setRuns(safeList());
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <TopBar
        title="Evaluation"
        subtitle="Recognition accuracy and latency"
        onBack={leave}
      />
      {__DEV__ && (
        <Notice message="This is a development build: models and JavaScript run much slower than in a release build. Report latency from a release build only." />
      )}
      {enrolled.length === 0 && (
        <Notice message="No products have photos yet. Add 1–2 photos to each test product in the catalogue first." />
      )}
      {!!message && <Notice message={message} />}

      <Card>
        <SectionHeader title="This phone" />
        <Text style={[ui.body, { color: c.text }]}>
          {runContextLine(models, mode)}
        </Text>
        <Text style={[ui.caption, { color: c.muted }]}>
          {enrolled.length} products with photos · {indexViews} stored views
        </Text>
      </Card>

      <Card>
        <SectionHeader title="New run" />
        <Field
          label="Name"
          placeholder="e.g. Shop counter, morning"
          value={name}
          onChangeText={setName}
        />
        <Button
          title="Start a new run"
          icon="play-outline"
          disabled={enrolled.length === 0}
          onPress={() => onCreate(name)}
        />
      </Card>

      <SectionHeader title="Saved runs" />
      {runs.length === 0 ? (
        <Empty
          title="No runs yet"
          description="Runs are saved on this phone after every trial, then exported for analysis."
        />
      ) : (
        runs.map((run) => (
          <Card key={run.id}>
            <Text style={[ui.sectionTitle, { color: c.text }]}>
              {run.name || "Untitled run"}
            </Text>
            <Text style={[ui.caption, { color: c.muted }]}>
              {new Date(run.createdAt).toLocaleString("en-GB")} ·{" "}
              {run.trials.length} trials · {run.benchmarks.length} benchmarks ·{" "}
              {run.context.device.model} ({run.context.device.build})
            </Text>
            <View style={ui.row}>
              <View style={ui.grow}>
                <Button title="Open" size="sm" onPress={() => onOpen(run)} />
              </View>
              <View style={ui.grow}>
                <Button
                  title="Export"
                  size="sm"
                  secondary
                  onPress={() =>
                    void exportRun(run)
                      .then((where) =>
                        setMessage(where ? `Saved the JSON and CSV files to ${where}.` : null),
                      )
                      .catch((cause) => setMessage(errorMessage(cause)))
                  }
                />
              </View>
              <View style={ui.grow}>
                <Button
                  title="Delete"
                  size="sm"
                  variant="danger"
                  onPress={() => confirmDelete(run)}
                />
              </View>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

function safeList(): EvaluationRun[] {
  try {
    return listRuns();
  } catch {
    return [];
  }
}

function runContextLine(models: VisionModels, mode: string) {
  return `${models.accelerator.toUpperCase()} · camera ${mode} · ${__DEV__ ? "development" : "release"} build`;
}

// ---------------------------------------------------------------------------------------------
// One run: trials, benchmark, summary

type Phase = "trials" | "benchmark";

function RunScreen({
  initial,
  models,
  enrolled,
  context,
  onClose,
}: {
  initial: EvaluationRun;
  models: VisionModels;
  enrolled: EnrolledProduct[];
  context: () => ReturnType<typeof runContext>;
  onClose: () => void;
}) {
  const c = usePalette();
  const { store } = useShop();
  const { mode, demote } = useCameraMode();
  const trials = useEvaluationTrials(initial, mode, context);
  const { run } = trials;
  const [phase, setPhase] = useState<Phase>("trials");
  const [truth, setTruth] = useState<TrialTruth | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [conditions, setConditions] = useState<TrialConditions>({
    lighting: LIGHTING[0],
    background: BACKGROUNDS[0],
  });
  const [message, setMessage] = useState<string | null>(null);
  const summary = useMemo(() => summariseTrials(run.trials), [run.trials]);
  const nameOf = (id: string | null) =>
    id ? (store.catalogue.product(id)?.name ?? "Deleted product") : "–";
  const sameItem = truth
    ? run.trials.filter((t) => sameTruth(t.truth, truth)).length
    : 0;

  function close() {
    trials.abort();
    onClose();
  }

  if (phase === "benchmark")
    return (
      <BenchmarkPhase
        models={models}
        onDone={(results) => {
          if (results.length)
            trials.replaceRun(
              withBenchmarks(run, results, new Date().toISOString()),
            );
          setPhase("trials");
        }}
      />
    );

  return (
    <Screen>
      <TopBar
        title={run.name || "Untitled run"}
        subtitle={`${run.trials.length} trials · ${run.context.device.model}`}
        backIcon="close"
        backLabel="Close run"
        onBack={close}
      />
      {!!message && <Notice message={message} />}

      <SummaryCard run={run} summary={summary} />

      <Card>
        <SectionHeader title="Conditions" />
        <View style={ui.wrap}>
          {LIGHTING.map((value) => (
            <Chip
              key={value}
              label={value}
              selected={conditions.lighting === value}
              onPress={() => setConditions((p) => ({ ...p, lighting: value }))}
            />
          ))}
        </View>
        <View style={ui.wrap}>
          {BACKGROUNDS.map((value) => (
            <Chip
              key={value}
              label={value}
              selected={conditions.background === value}
              onPress={() => setConditions((p) => ({ ...p, background: value }))}
            />
          ))}
        </View>
      </Card>

      <Card>
        <SectionHeader
          title="Item in front of the camera"
          action={
            <Button
              title={truth ? "Change" : "Choose"}
              size="sm"
              secondary
              disabled={trials.running || !!trials.pending}
              onPress={() => setChoosing(true)}
            />
          }
        />
        <Text style={[ui.body, { color: truth ? c.text : c.muted }]}>
          {truth ? truthLabel(truth) : "Choose the item before each trial."}
        </Text>
        {truth && (
          <Text style={[ui.caption, { color: c.muted }]}>
            {sameItem} trials kept for this item
          </Text>
        )}
      </Card>

      <VisionCameraView
        models={models}
        mode={mode}
        active={trials.running}
        onView={trials.onView}
        onDetection={trials.onDetection}
        onError={(m) => {
          trials.onError();
          setMessage(m);
        }}
        onUnsupported={demote}
        captureLabel="Capture"
      />

      {trials.pending ? (
        <ResultCard
          trial={trials.pending}
          nameOf={nameOf}
          onKeep={trials.keep}
          onDiscard={trials.discard}
        />
      ) : trials.running ? (
        <View style={ui.stack}>
          <Text style={[ui.body, { color: c.muted, textAlign: "center" }]}>
            {mode === "still"
              ? "Frame the item, then tap Capture."
              : `Hold the item in the guide. The trial stops at a match or after ${EVALUATION.trialTimeoutMs / 1000} s.`}
          </Text>
          <Button title="Stop without recording" secondary onPress={trials.abort} />
        </View>
      ) : (
        <Button
          title="Start trial"
          icon="play-outline"
          disabled={!truth}
          onPress={() => {
            setMessage(null);
            if (truth) trials.start(truth, conditions);
          }}
        />
      )}

      <View style={ui.row}>
        <View style={ui.grow}>
          <Button
            title="Benchmark models"
            icon="speedometer-outline"
            secondary
            disabled={trials.running || !!trials.pending}
            onPress={() => setPhase("benchmark")}
          />
        </View>
        <View style={ui.grow}>
          <Button
            title="Export"
            icon="download-outline"
            secondary
            disabled={trials.running}
            onPress={() =>
              void exportRun(run)
                .then((where) =>
                  setMessage(where ? `Saved the JSON and CSV files to ${where}.` : null),
                )
                .catch((cause) => setMessage(errorMessage(cause)))
            }
          />
        </View>
      </View>

      <RecentTrials
        trials={run.trials}
        nameOf={nameOf}
        onRemove={trials.removeTrial}
      />

      <TruthSheet
        visible={choosing}
        enrolled={enrolled}
        onPick={(picked) => {
          setTruth(picked);
          setChoosing(false);
        }}
        onClose={() => setChoosing(false)}
      />
    </Screen>
  );
}

function sameTruth(a: TrialTruth, b: TrialTruth) {
  return a.kind === "product" && b.kind === "product"
    ? a.productId === b.productId
    : a.kind === "unknown" && b.kind === "unknown" && a.label === b.label;
}

function truthLabel(truth: TrialTruth) {
  return truth.kind === "product"
    ? `${truth.name} (${truth.enrolledViews} stored views)`
    : `Unknown item: ${truth.label} (should not match)`;
}

function SummaryCard({
  run,
  summary,
}: {
  run: EvaluationRun;
  summary: ReturnType<typeof summariseTrials>;
}) {
  const c = usePalette();
  const lines: [string, string][] = [
    ["Top-1 accuracy", formatProportion(summary.top1)],
    ["Top-3 hit rate", formatProportion(summary.top3)],
    ["False accepts (unknown)", formatProportion(summary.falseAccept)],
    ["Time to lock", formatLatency(summary.timeToLock)],
    ["Detector / frame", formatLatency(summary.stages.detect)],
    ["Embedder / view", formatLatency(summary.stages.embed)],
  ];
  const latest = run.benchmarks.slice(-4);
  return (
    <Card>
      <SectionHeader
        title="Results so far"
        action={
          <Text style={[ui.caption, { color: c.muted }]}>
            {summary.known} known · {summary.unknown} unknown
          </Text>
        }
      />
      {lines.map(([label, value]) => (
        <View key={label}>
          <Text style={[ui.caption, { color: c.muted }]}>{label}</Text>
          <Text style={[ui.body, { color: c.text, fontVariant: ["tabular-nums"] }]}>
            {value}
          </Text>
        </View>
      ))}
      {latest.length > 0 && (
        <>
          <Divider />
          <Text style={[ui.caption, { color: c.muted }]}>Latest benchmark</Text>
          {latest.map((b) => (
            <Text
              key={`${b.name}-${b.at}`}
              style={[ui.caption, { color: c.text, fontVariant: ["tabular-nums"] }]}
            >
              {b.name}: {formatLatency(b.summary)}
            </Text>
          ))}
        </>
      )}
    </Card>
  );
}

function ResultCard({
  trial,
  nameOf,
  onKeep,
  onDiscard,
}: {
  trial: TrialRecord;
  nameOf: (id: string | null) => string;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const c = usePalette();
  const verdict = trial.correct ? "Correct" : "Wrong";
  const decision =
    trial.outcome === "locked"
      ? `Matched ${nameOf(trial.lockedProductId)} (${trial.lockedScore?.toFixed(3)}) in ${trial.lockMs?.toFixed(0)} ms`
      : trial.outcome === "timeout"
        ? `No match within ${(trial.durationMs / 1000).toFixed(1)} s`
        : "No match: the photo did not clear the threshold";
  return (
    <Card>
      <SectionHeader
        title={verdict}
        action={
          <Text
            style={[ui.caption, { color: trial.correct ? c.accent : c.danger }]}
          >
            Trial {trial.index}
          </Text>
        }
      />
      <Text style={[ui.body, { color: c.text }]}>{decision}</Text>
      <Text style={[ui.caption, { color: c.muted }]}>
        Top 3:{" "}
        {trial.finalRanking.length
          ? trial.finalRanking
              .map((r) => `${nameOf(r.productId)} ${r.score.toFixed(3)}`)
              .join(" · ")
          : "no view embedded"}
        {"\n"}
        {trial.framesProcessed} frames · {trial.viewsEmbedded} views · detector{" "}
        {trial.stages.detect?.median.toFixed(1) ?? "–"} ms · embedder{" "}
        {trial.stages.embed?.median.toFixed(1) ?? "–"} ms
      </Text>
      <View style={ui.row}>
        <View style={ui.grow}>
          <Button title="Keep" icon="checkmark" onPress={onKeep} />
        </View>
        <View style={ui.grow}>
          <Button title="Discard" secondary onPress={onDiscard} />
        </View>
      </View>
    </Card>
  );
}

function RecentTrials({
  trials,
  nameOf,
  onRemove,
}: {
  trials: TrialRecord[];
  nameOf: (id: string | null) => string;
  onRemove: (index: number) => void;
}) {
  const c = usePalette();
  if (trials.length === 0) return null;
  return (
    <View style={ui.stack}>
      <SectionHeader title="Recent trials" />
      {trials
        .slice(-10)
        .reverse()
        .map((t) => (
          <Pressable
            key={t.index}
            accessibilityRole="button"
            accessibilityHint="Long press to remove this trial"
            onLongPress={() =>
              Alert.alert(`Remove trial ${t.index}?`, undefined, [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Remove",
                  style: "destructive",
                  onPress: () => onRemove(t.index),
                },
              ])
            }
          >
            <Text style={[ui.caption, { color: c.text }]}>
              {t.correct ? "✓" : "✗"} #{t.index}{" "}
              {t.truth.kind === "product" ? t.truth.name : `Unknown: ${t.truth.label}`}{" "}
              → {t.outcome === "locked" ? nameOf(t.lockedProductId) : t.outcome}
              {t.lockMs !== null ? ` · ${t.lockMs.toFixed(0)} ms` : ""}
            </Text>
          </Pressable>
        ))}
      <Text style={[ui.caption, { color: c.faint }]}>
        Long press a trial to remove it.
      </Text>
    </View>
  );
}

function TruthSheet({
  visible,
  enrolled,
  onPick,
  onClose,
}: {
  visible: boolean;
  enrolled: EnrolledProduct[];
  onPick: (truth: TrialTruth) => void;
  onClose: () => void;
}) {
  const c = usePalette();
  const [label, setLabel] = useState("");
  return (
    <Sheet
      visible={visible}
      title="What is in front of the camera?"
      onClose={onClose}
    >
      <Field
        label="An item without photos in this shop"
        placeholder="e.g. Sweets, loose"
        value={label}
        onChangeText={setLabel}
        accessory={
          <Button
            title="Use"
            size="sm"
            disabled={!label.trim()}
            onPress={() => onPick({ kind: "unknown", label: label.trim() })}
          />
        }
      />
      <FlatList
        data={enrolled}
        keyExtractor={(p) => p.productId}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Empty
            title="No products with photos"
            description="Add photos to products in the catalogue first."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              onPick({
                kind: "product",
                productId: item.productId,
                name: item.name,
                enrolledViews: item.views,
              })
            }
            style={({ pressed }) => [
              ui.spread,
              {
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderColor: c.border,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[ui.body, { color: c.text }]}>{item.name}</Text>
            <Text style={[ui.caption, { color: c.muted }]}>
              {item.views} views
            </Text>
          </Pressable>
        )}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Benchmark: no camera is mounted, so nothing else touches the models.

function BenchmarkPhase({
  models,
  onDone,
}: {
  models: VisionModels;
  onDone: (results: Awaited<ReturnType<typeof runModelBenchmarks>>) => void;
}) {
  const c = usePalette();
  const { store } = useShop();
  const [progress, setProgress] = useState("Waiting for the camera to stop…");
  const [results, setResults] = useState<Awaited<
    ReturnType<typeof runModelBenchmarks>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Give the unmounted camera's last frame time to finish with the models.
    const timer = setTimeout(() => {
      void runModelBenchmarks(
        models,
        vision.vectorIndex(store),
        (label, done, total) => {
          if (!cancelled && (done % 10 === 0 || done === total))
            setProgress(`${label}: ${done} of ${total}`);
        },
      )
        .then((r) => !cancelled && setResults(r))
        .catch((cause) => !cancelled && setError(errorMessage(cause)));
    }, 750);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [models, store]);

  return (
    <Screen>
      <TopBar
        title="Model benchmark"
        subtitle={`${EVALUATION.benchmarkWarmup} warm-up + ${EVALUATION.benchmarkIterations} timed runs per stage`}
        disabled={!results && !error}
        onBack={() => onDone(results ?? [])}
      />
      {!!error && <Notice message={error} error />}
      {!results && !error && (
        <Notice message={`Keep the phone still and the screen on. ${progress}`} />
      )}
      {results?.map((r) => (
        <Card key={r.name}>
          <Text style={[ui.sectionTitle, { color: c.text }]}>{r.name}</Text>
          <Text style={[ui.caption, { color: c.muted }]}>{r.description}</Text>
          <Text style={[ui.body, { color: c.text, fontVariant: ["tabular-nums"] }]}>
            mean {r.summary.mean.toFixed(1)} ± {r.summary.sd.toFixed(1)} ms · median{" "}
            {r.summary.median.toFixed(1)} · p95 {r.summary.p95.toFixed(1)} · max{" "}
            {r.summary.max.toFixed(1)}
          </Text>
        </Card>
      ))}
      {(results || error) && (
        <Button
          title={results ? "Save to run" : "Back"}
          onPress={() => onDone(results ?? [])}
        />
      )}
    </Screen>
  );
}
