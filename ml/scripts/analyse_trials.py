"""Turn the phone's evaluation exports into the tables and charts for Chapter 4.5.

Inputs:
  runs          One or more run files exported from the app (Menu -> Evaluation -> Export),
                named eval-<date>-<name>-<id>.json. Runs from several days or phones combine.
  --out         Output folder (default: ml/artifacts/chapter4_5).
  --allow-dev   Include runs from development builds (their latency is not representative;
                by default they are left out of every latency table).

Outputs (in --out):
  chapter4_5.md        Every table, ready to paste: setup, accuracy, per product, per condition,
                       latency per stage, end-to-end timing, model benchmark.
  summary.json         The same numbers, machine-readable.
  trials.csv           All trials, one row each, for a spreadsheet or SPSS.
  latency_stages.png   Box plot of per-frame / per-view stage latency.
  time_to_lock.png     Cumulative distribution of time to lock.
  product_accuracy.png Top-1 and top-3 per product.
  confusion.png        True product against locked product.

Metric definitions match mobile/src/features/evaluation/metrics.ts (docs/evaluation-protocol.md).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

from _metrics import (
    LATENCY_HEADER,
    confusion,
    latency_row,
    markdown_table,
    proportion,
    summarise,
    summarise_or_none,
)

RUN_SCHEMA = "mokhotsi-evaluation-run/1"
NONE = "(no match)"

STAGE_LABELS = {
    "resize": "GPU resize (frame -> detector input)",
    "detect": "Detector inference",
    "decode": "Box decoding",
    "frame": "Whole frame (resize + detect + decode, + embed when it ran)",
    "crop": "Crop for embedder",
    "embed": "Embedder inference",
    "match": "Index search (top-k)",
    "capture": "Photo capture (still mode)",
    "photoDecode": "Photo decode + rotate (still mode)",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("runs", nargs="+", type=Path)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "artifacts" / "chapter4_5",
    )
    parser.add_argument("--allow-dev", action="store_true")
    return parser.parse_args()


def load_runs(paths: list[Path]) -> list[dict]:
    runs = []
    for path in paths:
        run = json.loads(path.read_text(encoding="utf8"))
        if run.get("schema") != RUN_SCHEMA:
            raise SystemExit(f"{path}: not an evaluation run ({run.get('schema')!r})")
        run["_file"] = path.name
        runs.append(run)
    return runs


def truth_name(trial: dict) -> str:
    truth = trial["truth"]
    return truth["name"] if truth["kind"] == "product" else f"Unknown: {truth['label']}"


def accuracy(trials: list[dict]) -> dict:
    """Same definitions as metrics.ts summariseTrials."""
    known = [t for t in trials if t["truth"]["kind"] == "product"]
    unknown = [t for t in trials if t["truth"]["kind"] == "unknown"]
    locked = [t for t in known if t["outcome"] == "locked"]
    return {
        "trials": len(trials),
        "known": len(known),
        "unknown": len(unknown),
        "top1": proportion(sum(t["correct"] for t in known), len(known)),
        "top3": proportion(sum(t["top3Hit"] is True for t in known), len(known)),
        "rank1": proportion(sum(t["rank1Correct"] is True for t in known), len(known)),
        "lock_rate": proportion(len(locked), len(known)),
        "precision": proportion(sum(t["correct"] for t in locked), len(locked)),
        "false_accept": proportion(sum(t["outcome"] == "locked" for t in unknown), len(unknown)),
        "overall": proportion(sum(t["correct"] for t in trials), len(trials)),
        "time_to_lock": summarise_or_none(t["lockMs"] for t in locked if t["lockMs"] is not None),
    }


def accuracy_rows(a: dict) -> list[list[object]]:
    return [
        ["Top-1 accuracy (locked to the right product)", a["top1"].text()],
        ["Top-3 hit rate (right product among the 3 shown)", a["top3"].text()],
        ["Rank-1 accuracy (first suggestion right, no threshold)", a["rank1"].text()],
        ["Lock rate (known items)", a["lock_rate"].text()],
        ["Precision when locked", a["precision"].text()],
        ["False-accept rate (unknown items locked)", a["false_accept"].text()],
        ["Correct decisions overall (known + unknown)", a["overall"].text()],
    ]


def main() -> None:
    # Tables use ± and –; Windows consoles default to a code page without them.
    sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args()
    runs = load_runs(args.runs)
    trials = [dict(t, _run=r) for r in runs for t in r["trials"]]
    if not trials:
        raise SystemExit("These runs have no trials yet.")
    release = [t for t in trials if t["_run"]["context"]["device"]["build"] == "release"]
    dev_runs = [r["_file"] for r in runs if r["context"]["device"]["build"] != "release"]
    timed = trials if args.allow_dev else release
    if dev_runs:
        print(
            "WARNING: development-build runs "
            + ("included in" if args.allow_dev else "left out of")
            + f" the latency tables: {', '.join(dev_runs)}",
            file=sys.stderr,
        )

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    overall = accuracy(trials)
    md: list[str] = ["# Chapter 4.5: Recognition accuracy and processing latency", ""]

    # --- Table 1: setup -------------------------------------------------------------------
    devices = sorted(
        {
            f"{r['context']['device']['manufacturer']} {r['context']['device']['model']} "
            f"(Android {r['context']['device']['osVersion']}, "
            f"{(r['context']['device']['memoryBytes'] or 0) / 2**30:.1f} GB RAM, "
            f"{r['context']['accelerator'].upper()}, {r['context']['device']['build']} build)"
            for r in runs
        }
    )
    ctx = runs[0]["context"]
    products = sorted({truth_name(t) for t in trials if t["truth"]["kind"] == "product"})
    unknown_items = sorted({truth_name(t) for t in trials if t["truth"]["kind"] == "unknown"})
    modes = sorted({t["cameraMode"] for t in trials})
    conditions = sorted(
        {f"{t['conditions']['lighting']} / {t['conditions']['background']}" for t in trials}
    )
    md += [
        "## Table 4.x: Evaluation setup",
        "",
        markdown_table(
            ["Item", "Value"],
            [
                ["Phone(s)", "; ".join(devices)],
                ["Detector", ctx["models"]["detector"]],
                ["Embedder", ctx["models"]["embedder"]],
                ["Camera mode(s)", ", ".join(modes)],
                [
                    "Decision rule",
                    f"cosine >= {ctx['thresholds']['accept']} and lead >= "
                    f"{ctx['thresholds']['margin']}, winning {ctx['thresholds']['voterNeeded']} "
                    f"of the last {ctx['thresholds']['voterWindow']} views (live)",
                ],
                [
                    "Pipeline limits",
                    f"detector <= {ctx['pipeline']['detectorMaxFps']} fps, embedder <= "
                    f"{ctx['pipeline']['embedderMaxPerSecond']}/s, "
                    f"{ctx['pipeline']['stableFrames']} still frames before embedding, "
                    f"trial limit {ctx['pipeline']['trialTimeoutMs'] / 1000:.0f} s",
                ],
                [
                    "Enrolled products",
                    f"{ctx['index']['products']} products, {ctx['index']['views']} stored views",
                ],
                ["Products tested", f"{len(products)}"],
                ["Unenrolled items tested", f"{len(unknown_items)}"],
                ["Conditions", "; ".join(conditions)],
                [
                    "Trials",
                    f"{overall['trials']} ({overall['known']} known, {overall['unknown']} unknown)",
                ],
            ],
        ),
        "",
    ]

    # --- Table 2: accuracy ------------------------------------------------------------------
    md += [
        "## Table 4.x: Recognition accuracy (95% Wilson confidence intervals)",
        "",
        markdown_table(["Metric", "Result (95% CI) k/n"], accuracy_rows(overall)),
        "",
    ]

    # --- Table 3: per product -----------------------------------------------------------------
    by_product: dict[str, list[dict]] = defaultdict(list)
    for t in trials:
        by_product[truth_name(t)].append(t)
    product_rows, plot_names, plot_top1, plot_top3 = [], [], [], []
    for name in sorted(by_product):
        rows = by_product[name]
        a = accuracy(rows)
        is_known = rows[0]["truth"]["kind"] == "product"
        views = rows[0]["truth"].get("enrolledViews") if is_known else None
        product_rows.append(
            [
                name,
                views,
                len(rows),
                a["top1"].text() if is_known else "–",
                a["top3"].text() if is_known else "–",
                a["false_accept"].text() if not is_known else "–",
                a["time_to_lock"].median if a["time_to_lock"] else None,
            ]
        )
        if is_known:
            plot_names.append(name)
            plot_top1.append(a["top1"].rate or 0.0)
            plot_top3.append(a["top3"].rate or 0.0)
    md += [
        "## Table 4.x: Results per item",
        "",
        markdown_table(
            [
                "Item",
                "Stored views",
                "Trials",
                "Top-1",
                "Top-3",
                "False accepts",
                "Median time to lock (ms)",
            ],
            product_rows,
        ),
        "",
    ]

    # --- Table 4: per condition ---------------------------------------------------------------
    by_condition: dict[str, list[dict]] = defaultdict(list)
    for t in trials:
        by_condition[f"{t['conditions']['lighting']} / {t['conditions']['background']}"].append(t)
    condition_rows = []
    for name in sorted(by_condition):
        a = accuracy(by_condition[name])
        condition_rows.append(
            [
                name,
                a["trials"],
                a["top1"].text(),
                a["false_accept"].text(),
                a["time_to_lock"].median if a["time_to_lock"] else None,
            ]
        )
    md += [
        "## Table 4.x: Results by condition",
        "",
        markdown_table(
            ["Lighting / background", "Trials", "Top-1", "False accepts", "Median lock (ms)"],
            condition_rows,
        ),
        "",
    ]

    # --- Table 5: latency per stage (release builds) ------------------------------------------
    stage_samples: dict[str, list[float]] = defaultdict(list)
    for t in timed:
        for stage, values in t["samples"].items():
            stage_samples[stage].extend(values)
    stage_rows = [
        latency_row(STAGE_LABELS.get(stage, stage), summarise(stage_samples[stage]))
        for stage in STAGE_LABELS
        if stage_samples.get(stage)
    ]
    fps = [
        t["framesProcessed"] / (t["durationMs"] / 1000)
        for t in timed
        if t["durationMs"] > 0 and t["framesProcessed"]
    ]
    known_timed = [t for t in timed if t["truth"]["kind"] == "product"]
    locked_timed = [t for t in known_timed if t["outcome"] == "locked"]
    e2e = {
        "Start -> item first detected": summarise_or_none(
            t["firstDetectionMs"] for t in known_timed if t["firstDetectionMs"] is not None
        ),
        "Start -> item held still": summarise_or_none(
            t["firstStableMs"] for t in known_timed if t["firstStableMs"] is not None
        ),
        "Start -> first embedding": summarise_or_none(
            t["firstViewMs"] for t in known_timed if t["firstViewMs"] is not None
        ),
        "Start -> locked match": summarise_or_none(
            t["lockMs"] for t in locked_timed if t["lockMs"] is not None
        ),
        "Item detected -> locked match": summarise_or_none(
            t["lockFromDetectionMs"] for t in locked_timed if t["lockFromDetectionMs"] is not None
        ),
    }
    md += [
        "## Table 4.x: Processing latency per stage, on the phone",
        "",
        "Pooled over every frame / view of every trial"
        + ("" if args.allow_dev else " (release builds only)")
        + ".",
        "",
        markdown_table(LATENCY_HEADER, stage_rows) if stage_rows else "_No release-build trials._",
        "",
    ]
    if fps:
        f = summarise(fps)
        md += [
            f"Detector frames processed per second during trials: median {f.median:.1f} "
            f"(the pipeline caps it at {ctx['pipeline']['detectorMaxFps']} fps).",
            "",
        ]
    md += [
        "## Table 4.x: End-to-end recognition time (known items)",
        "",
        "Includes the pipeline's deliberate pacing (frame rate cap, still frames, embeddings per "
        "second, 2-of-3 voting), so it is longer than the sum of the stage latencies.",
        "",
        markdown_table(LATENCY_HEADER, [latency_row(k, v) for k, v in e2e.items()]),
        "",
    ]

    # --- Table 6: benchmarks ------------------------------------------------------------------
    bench_rows = []
    for r in runs:
        if r["context"]["device"]["build"] != "release" and not args.allow_dev:
            continue
        latest: dict[str, dict] = {}
        for b in r["benchmarks"]:
            latest[b["name"]] = b  # The newest of each kind per run.
        for b in latest.values():
            s = b["summary"]
            bench_rows.append(
                [
                    r["context"]["device"]["model"],
                    b["name"],
                    b["description"],
                    s["n"],
                    f"{s['mean']:.1f} ± {s['sd']:.1f}",
                    s["median"],
                    s["p95"],
                ]
            )
    md += [
        "## Table 4.x: Isolated model benchmark (no camera)",
        "",
        markdown_table(
            ["Phone", "Stage", "What was timed", "Runs", "Mean ± SD (ms)", "Median", "P95"],
            bench_rows,
        )
        if bench_rows
        else "_No benchmark recorded (Evaluation -> Benchmark models)._",
        "",
    ]

    # --- Confusion ----------------------------------------------------------------------------
    pairs = []
    for t in trials:
        predicted = NONE
        if t["outcome"] == "locked" and t["lockedProductId"]:
            predicted = names_for(runs).get(t["lockedProductId"], t["lockedProductId"])
        pairs.append((truth_name(t), predicted))
    labels, columns, matrix = confusion(pairs)

    (out / "chapter4_5.md").write_text("\n".join(md), encoding="utf8")
    write_trials_csv(out / "trials.csv", trials)
    summary = {
        "runs": [r["_file"] for r in runs],
        "accuracy": {k: (v.as_dict() if hasattr(v, "as_dict") else v) for k, v in overall.items()},
        "stages": {k: summarise(v).as_dict() for k, v in stage_samples.items() if v},
        "end_to_end": {k: (v.as_dict() if v else None) for k, v in e2e.items()},
        "confusion": {"rows": labels, "columns": columns, "matrix": matrix},
        "latency_builds": "all" if args.allow_dev else "release",
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf8")

    try:
        from _plots import plot_cdf, plot_confusion, plot_latency_boxes, plot_product_accuracy

        plot_latency_boxes(
            {
                k: stage_samples.get(k, [])
                for k in ("resize", "detect", "crop", "embed", "match", "frame")
            },
            out / "latency_stages.png",
            "Per-stage latency on the phone",
        )
        plot_cdf(
            {
                "Start -> lock": [t["lockMs"] for t in locked_timed if t["lockMs"] is not None],
                "Detected -> lock": [
                    t["lockFromDetectionMs"]
                    for t in locked_timed
                    if t["lockFromDetectionMs"] is not None
                ],
            },
            out / "time_to_lock.png",
            "Milliseconds",
        )
        plot_product_accuracy(plot_names, plot_top1, plot_top3, out / "product_accuracy.png")
        plot_confusion(labels, columns, matrix, out / "confusion.png")
    except ImportError as error:
        print(f"charts skipped: {error}", file=sys.stderr)

    print("\n".join(md))
    print(f"\nWrote {out}", file=sys.stderr)


def names_for(runs: list[dict]) -> dict[str, str]:
    names: dict[str, str] = {}
    for r in runs:
        for p in r["context"].get("enrolled", []):
            names[p["productId"]] = p["name"]
        for t in r["trials"]:
            if t["truth"]["kind"] == "product":
                names[t["truth"]["productId"]] = t["truth"]["name"]
    return names


def write_trials_csv(path: Path, trials: list[dict]) -> None:
    stages = list(STAGE_LABELS)
    with path.open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "run_file",
                "trial",
                "device",
                "build",
                "accelerator",
                "camera_mode",
                "lighting",
                "background",
                "truth_kind",
                "truth",
                "outcome",
                "locked_product_id",
                "locked_score",
                "correct",
                "top3_hit",
                "rank1_correct",
                "first_detection_ms",
                "first_stable_ms",
                "first_view_ms",
                "lock_ms",
                "lock_from_detection_ms",
                "duration_ms",
                "frames_processed",
                "views_embedded",
            ]
            + [f"{s}_median_ms" for s in stages]
        )
        for t in trials:
            run = t["_run"]
            writer.writerow(
                [
                    run["_file"],
                    t["index"],
                    run["context"]["device"]["model"],
                    run["context"]["device"]["build"],
                    run["context"]["accelerator"],
                    t["cameraMode"],
                    t["conditions"]["lighting"],
                    t["conditions"]["background"],
                    t["truth"]["kind"],
                    truth_name(t),
                    t["outcome"],
                    t["lockedProductId"],
                    t["lockedScore"],
                    t["correct"],
                    t["top3Hit"],
                    t["rank1Correct"],
                    t["firstDetectionMs"],
                    t["firstStableMs"],
                    t["firstViewMs"],
                    t["lockMs"],
                    t["lockFromDetectionMs"],
                    t["durationMs"],
                    t["framesProcessed"],
                    t["viewsEmbedded"],
                ]
                + [(t["stages"].get(s) or {}).get("median") for s in stages]
            )


if __name__ == "__main__":
    main()
