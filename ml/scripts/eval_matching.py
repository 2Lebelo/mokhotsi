"""Measure product matching accuracy and pick the cosine match threshold.

Inputs:
  --embedder    Exported embedder .tflite.
  --detector    Optional detector .tflite; if given, crop each image to the top box first
                (mirrors the on-device pipeline). Otherwise images are used as-is.
  --enrol-dir   One sub-folder per product with 1-3 enrolment photos (product_id/*.jpg).
  --query-dir   Same layout: held-out photos of the same products (and optionally an
                `_unknown/` folder of products that are NOT enrolled).
  --thresholds  start:stop:step for the sweep (default 0.50:0.95:0.05).
  --out         JSON report path (default: ml/artifacts/eval_matching.json).

Outputs:
  Per-threshold top-1 accuracy, false-accept rate (unknown items matched) and reject rate,
  plus a suggested `match_threshold` to copy into manifest.json (placeholder today: 0.75).
"""

import argparse
from pathlib import Path


def _thresholds(spec: str) -> list[float]:
    start, stop, step = (float(x) for x in spec.split(":"))
    count = round((stop - start) / step) + 1
    return [round(start + i * step, 4) for i in range(count)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--embedder", type=Path, required=True)
    parser.add_argument("--detector", type=Path, default=None)
    parser.add_argument("--enrol-dir", type=Path, required=True)
    parser.add_argument("--query-dir", type=Path, required=True)
    parser.add_argument("--thresholds", type=_thresholds, default=_thresholds("0.50:0.95:0.05"))
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "artifacts" / "eval_matching.json",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    # TODO(feature): embed enrol photos (L2-normalised) into one float32 matrix; embed each query;
    # top-1 by dot product; sweep thresholds -> accuracy / false-accept / reject; write JSON report.
    raise NotImplementedError(
        f"TODO(feature): eval_matching.py over {len(args.thresholds)} thresholds"
    )


if __name__ == "__main__":
    main()
