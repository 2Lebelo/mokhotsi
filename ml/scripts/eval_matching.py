"""Measure product matching accuracy offline and sweep the cosine match threshold.

Runs the app's exact recognition pipeline (see _pipeline.py) over a fixed photo set, so the
accuracy figures are reproducible and the threshold can be justified.

Inputs:
  --enrol-dir   One sub-folder per product with its enrolment photos (product_id/*.jpg), as
                they would be added to the product in the app (1-2 photos; more is allowed).
  --query-dir   Same layout: held-out photos of the same products, plus optionally an
                `_unknown/` folder of products that are NOT enrolled (should not match).
  --embedder    Embedder .tflite (default: the app's bundled model).
  --detector    Detector .tflite (default: the app's bundled model).
  --no-detector Embed whole images instead of the detected item.
  --float-index Keep float32 vectors (the app stores int8; this isolates quantisation).
  --thresholds  start:stop:step for the sweep (default 0.50:0.95:0.05).
  --threads     LiteRT CPU threads (default 4).
  --out         JSON report path (default: ml/artifacts/eval_matching.json). A per-query CSV,
                a Markdown summary and charts are written next to it.

Outputs, at the app's operating point (manifest accept_threshold and margin) and per threshold:
  top-1 accuracy, top-3 hit rate, rank-1 accuracy, false-accept rate on unknown items, reject
  rate, per-product accuracy, a confusion matrix, detector hit rate, desktop latency per stage,
  and a suggested `accept_threshold` (copy it into manifest.json only after reviewing it).

Decisions here are single-view. On the phone the live camera also needs 2 of the last 3
views to agree, which is stricter: treat these as the per-view figures.
"""

from __future__ import annotations

import argparse
import csv
import json
import platform
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from _metrics import (
    LATENCY_HEADER,
    confusion,
    latency_row,
    markdown_table,
    proportion,
    summarise_or_none,
)
from _pipeline import (
    CROP_PAD,
    MANIFEST_PATH,
    MODELS_DIR,
    PHOTO_CROP_PADS,
    Models,
    VectorIndex,
    accepts,
    embed_image,
    images_in,
    load_manifest,
)

UNKNOWN = "_unknown"
NONE = "(no match)"


def _thresholds(spec: str) -> list[float]:
    start, stop, step = (float(x) for x in spec.split(":"))
    count = round((stop - start) / step) + 1
    return [round(start + i * step, 4) for i in range(count)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--embedder", type=Path, default=MODELS_DIR / "embedder.tflite")
    parser.add_argument("--detector", type=Path, default=MODELS_DIR / "detector.tflite")
    parser.add_argument("--no-detector", action="store_true")
    parser.add_argument("--float-index", action="store_true")
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--enrol-dir", type=Path, required=True)
    parser.add_argument("--query-dir", type=Path, required=True)
    parser.add_argument("--thresholds", type=_thresholds, default=_thresholds("0.50:0.95:0.05"))
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "artifacts" / "eval_matching.json",
    )
    return parser.parse_args()


def product_folders(root: Path) -> dict[str, list[Path]]:
    if not root.is_dir():
        raise SystemExit(f"{root} is not a folder")
    folders = {
        d.name: images_in(d) for d in sorted(root.iterdir()) if d.is_dir() and d.name != UNKNOWN
    }
    return {name: photos for name, photos in folders.items() if photos}


def evaluate_at(queries: list[dict], threshold: float, margin: float) -> dict:
    known = [q for q in queries if q["truth"] != UNKNOWN]
    unknown = [q for q in queries if q["truth"] == UNKNOWN]
    decided = {id(q): accepts(q["ranking"], threshold, margin) for q in queries}
    correct_known = sum(decided[id(q)] == q["truth"] for q in known)
    wrong_known = sum(decided[id(q)] not in (None, q["truth"]) for q in known)
    rejected_known = sum(decided[id(q)] is None for q in known)
    false_accepts = sum(decided[id(q)] is not None for q in unknown)
    accepted_known = correct_known + wrong_known
    overall = correct_known + (len(unknown) - false_accepts)
    return {
        "threshold": threshold,
        "margin": margin,
        "top1": proportion(correct_known, len(known)).as_dict(),
        "wrong_accept": proportion(wrong_known, len(known)).as_dict(),
        "reject": proportion(rejected_known, len(known)).as_dict(),
        "precision": proportion(correct_known, accepted_known).as_dict(),
        "false_accept": proportion(false_accepts, len(unknown)).as_dict(),
        "overall": proportion(overall, len(queries)).as_dict(),
    }


def suggest(sweep: list[dict]) -> dict:
    """Most correct decisions overall; ties go to fewer false accepts, then the higher threshold."""

    def key(row: dict) -> tuple[float, float, float]:
        overall = row["overall"]["rate"] or 0.0
        false_accept = row["false_accept"]["rate"] or 0.0
        return (overall, -false_accept, row["threshold"])

    best = max(sweep, key=key)
    return {
        "accept_threshold": best["threshold"],
        "rule": "maximise correct decisions over known + unknown queries; "
        "ties -> lower false-accept rate -> higher threshold",
    }


def pct(p: dict) -> str:
    if p["rate"] is None:
        return "–"
    return f"{p['rate'] * 100:.1f}% ({p['low'] * 100:.1f}–{p['high'] * 100:.1f}) {p['k']}/{p['n']}"


def main() -> None:
    # Tables use ± and –; Windows consoles default to a code page without them.
    sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args()
    manifest = load_manifest(args.manifest)
    matching = manifest["matching"]
    accept, margin, top_k = matching["accept_threshold"], matching["margin"], matching["top_k"]
    detector = None if args.no_detector else args.detector
    models = Models(manifest, detector, args.embedder, args.threads)

    enrol = product_folders(args.enrol_dir)
    if not enrol:
        raise SystemExit(f"No product folders with photos in {args.enrol_dir}")
    query_known = product_folders(args.query_dir)
    unknown_dir = args.query_dir / UNKNOWN
    query_unknown = images_in(unknown_dir) if unknown_dir.is_dir() else []
    missing = sorted(set(query_known) - set(enrol))
    if missing:
        raise SystemExit(f"Query folders without enrolment photos: {', '.join(missing)}")

    # Enrol: every photo at both paddings, as reconcile.ts does for product photos.
    index = VectorIndex(manifest["embedder"]["dim"], quantise=not args.float_index)
    enrol_hits, enrol_total = 0, 0
    for product, photos in enrol.items():
        for photo in photos:
            embedded = embed_image(models, photo, PHOTO_CROP_PADS)
            enrol_total += 1
            enrol_hits += embedded.box is not None
            for vector in embedded.vectors:
                index.add(product, vector)
        print(f"enrolled {product}: {len(photos)} photos", file=sys.stderr)

    # Query: one view per photo at the live crop padding.
    queries: list[dict] = []
    jobs = [(p, photo) for p, photos in query_known.items() for photo in photos]
    jobs += [(UNKNOWN, photo) for photo in query_unknown]
    for truth, photo in jobs:
        embedded = embed_image(models, photo, (CROP_PAD,))
        start = time.perf_counter()
        ranking = index.top_k(embedded.vectors[0], top_k)
        match_ms = (time.perf_counter() - start) * 1000
        queries.append(
            {
                "image": str(photo.relative_to(args.query_dir)),
                "truth": truth,
                "detected": embedded.box is not None,
                "detector_score": embedded.detector_score,
                "ranking": ranking,
                "load_ms": embedded.load_ms,
                "detect_ms": embedded.detect_ms,
                "embed_ms": embedded.embed_ms[0],
                "match_ms": match_ms,
            }
        )
    known = [q for q in queries if q["truth"] != UNKNOWN]
    if not known:
        raise SystemExit(f"No query photos of enrolled products in {args.query_dir}")

    operating = evaluate_at(queries, accept, margin)
    sweep = [evaluate_at(queries, t, margin) for t in args.thresholds]
    top3 = proportion(sum(any(p == q["truth"] for p, _ in q["ranking"]) for q in known), len(known))
    rank1 = proportion(
        sum(bool(q["ranking"]) and q["ranking"][0][0] == q["truth"] for q in known), len(known)
    )

    per_product = []
    for product in sorted(query_known):
        rows = [q for q in known if q["truth"] == product]
        per_product.append(
            {
                "product": product,
                "enrol_photos": len(enrol[product]),
                "queries": len(rows),
                "top1": proportion(
                    sum(accepts(q["ranking"], accept, margin) == product for q in rows), len(rows)
                ).as_dict(),
                "top3": proportion(
                    sum(any(p == product for p, _ in q["ranking"]) for q in rows), len(rows)
                ).as_dict(),
                "mean_top_score": round(
                    sum(q["ranking"][0][1] for q in rows if q["ranking"]) / max(1, len(rows)), 4
                ),
            }
        )

    labels, columns, matrix = confusion(
        (q["truth"], accepts(q["ranking"], accept, margin) or NONE) for q in queries
    )
    latency = {
        name: summarise_or_none(q[key] for q in queries)
        for name, key in [
            ("load_and_crop", "load_ms"),
            ("detect", "detect_ms"),
            ("embed", "embed_ms"),
            ("match", "match_ms"),
        ]
    }
    if args.no_detector:
        latency["detect"] = None

    report = {
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "host": {"platform": platform.platform(), "processor": platform.processor()},
        "models": {
            "detector": None if args.no_detector else manifest["detector"]["model_version"],
            "embedder": manifest["embedder"]["model_version"],
            "index": "float32" if args.float_index else "int8",
            "threads": args.threads,
        },
        "dataset": {
            "products": len(enrol),
            "enrol_photos": enrol_total,
            "enrol_views": len(index),
            "known_queries": len(known),
            "unknown_queries": len(query_unknown),
        },
        "detector_hit_rate": {
            "enrol": proportion(enrol_hits, enrol_total).as_dict(),
            "query": proportion(sum(q["detected"] for q in queries), len(queries)).as_dict(),
        },
        "operating_point": {**operating, "top3": top3.as_dict(), "rank1": rank1.as_dict()},
        "sweep": sweep,
        "suggested": suggest(sweep),
        "per_product": per_product,
        "confusion": {"rows": labels, "columns": columns, "matrix": matrix},
        "latency_ms_desktop": {k: (v.as_dict() if v else None) for k, v in latency.items()},
        "queries": [{**q, "ranking": [[p, round(s, 5)] for p, s in q["ranking"]]} for q in queries],
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf8")
    write_query_csv(args.out.with_suffix(".csv"), queries, accept, margin)
    args.out.with_suffix(".md").write_text(
        markdown_report(report, latency, accept, margin), encoding="utf8"
    )
    try:
        from _plots import plot_confusion, plot_sweep

        plot_sweep(sweep, accept, args.out.with_name(args.out.stem + "_sweep.png"))
        plot_confusion(
            labels, columns, matrix, args.out.with_name(args.out.stem + "_confusion.png")
        )
    except ImportError as error:  # matplotlib missing: the tables are still written.
        print(f"charts skipped: {error}", file=sys.stderr)

    print(markdown_report(report, latency, accept, margin))
    print(f"\nWrote {args.out} (+ .csv, .md, charts)", file=sys.stderr)


def write_query_csv(path: Path, queries: list[dict], accept: float, margin: float) -> None:
    with path.open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            ["image", "truth", "detected", "detector_score", "decision", "correct"]
            + [f"rank{i}_{f}" for i in (1, 2, 3) for f in ("product", "score")]
            + ["load_ms", "detect_ms", "embed_ms", "match_ms"]
        )
        for q in queries:
            decision = accepts(q["ranking"], accept, margin)
            correct = decision == (None if q["truth"] == UNKNOWN else q["truth"])
            ranks: list[object] = []
            for i in range(3):
                ranks += list(q["ranking"][i]) if i < len(q["ranking"]) else ["", ""]
            writer.writerow(
                [
                    q["image"],
                    q["truth"],
                    q["detected"],
                    q["detector_score"],
                    decision or "",
                    correct,
                ]
                + ranks
                + [round(q[k], 3) for k in ("load_ms", "detect_ms", "embed_ms", "match_ms")]
            )


def markdown_report(report: dict, latency: dict, accept: float, margin: float) -> str:
    op = report["operating_point"]
    ds = report["dataset"]
    lines = [
        "# Offline matching evaluation",
        "",
        f"{ds['products']} products, {ds['enrol_photos']} enrolment photos ({ds['enrol_views']} "
        f"stored views), {ds['known_queries']} known and {ds['unknown_queries']} unknown query "
        f"photos. Index: {report['models']['index']}. Single-view decisions.",
        "",
        f"## At the app's operating point (threshold {accept}, margin {margin})",
        "",
        markdown_table(
            ["Metric", "Value (95% CI) k/n"],
            [
                ["Top-1 accuracy (accepted and correct)", pct(op["top1"])],
                ["Top-3 hit rate", pct(op["top3"])],
                ["Rank-1 accuracy (no threshold)", pct(op["rank1"])],
                ["Wrong accepts (known items)", pct(op["wrong_accept"])],
                ["Rejected (known items)", pct(op["reject"])],
                ["Precision when accepted", pct(op["precision"])],
                ["False accepts (unknown items)", pct(op["false_accept"])],
                ["Correct decisions overall", pct(op["overall"])],
                ["Detector found the item (queries)", pct(report["detector_hit_rate"]["query"])],
            ],
        ),
        "",
        "## Threshold sweep",
        "",
        markdown_table(
            ["Threshold", "Top-1", "Rejected", "Wrong accepts", "False accepts", "Overall"],
            [
                [
                    f"{row['threshold']:.2f}",
                    pct(row["top1"]),
                    pct(row["reject"]),
                    pct(row["wrong_accept"]),
                    pct(row["false_accept"]),
                    pct(row["overall"]),
                ]
                for row in report["sweep"]
            ],
        ),
        "",
        f"Suggested accept_threshold: **{report['suggested']['accept_threshold']}** "
        f"({report['suggested']['rule']}).",
        "",
        "## Per product",
        "",
        markdown_table(
            ["Product", "Enrol photos", "Queries", "Top-1", "Top-3", "Mean top score"],
            [
                [
                    p["product"],
                    p["enrol_photos"],
                    p["queries"],
                    pct(p["top1"]),
                    pct(p["top3"]),
                    p["mean_top_score"],
                ]
                for p in report["per_product"]
            ],
        ),
        "",
        f"## Desktop latency per query ({report['host']['processor'] or 'CPU'}, "
        f"{report['models']['threads']} threads; not phone figures)",
        "",
        markdown_table(LATENCY_HEADER, [latency_row(k, v) for k, v in latency.items()]),
        "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
