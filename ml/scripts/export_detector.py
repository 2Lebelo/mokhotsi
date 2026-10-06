"""Export the YOLOv8n product detector to a LiteRT (.tflite) model for the phone.

Inputs:
  --weights      Ultralytics .pt weights (default: yolov8n.pt; fine-tuned weights later).
  --imgsz        Square input size; must match the app's resizer (default 640 -> 640x640x3).
  --quantize     Precision. Ultralytics >= 8.4.83: 32 | 16 | 8 | w8a16 | w8a32 (`quantize=`).
                 Older versions: 32 | 16 | 8, mapped to `half=` / `int8=`.
  --data         Dataset YAML for INT8 calibration (needed for 8 and w8a16).
  --out-dir      Where to write the model and manifest (default: ml/artifacts).
  --model-version  Version string stored in the manifest, e.g. yolov8n-640@2026-10-06.

Outputs:
  <out-dir>/detector.tflite
  <out-dir>/manifest.json   (detector entry updated; shape validated by mobile/src/ml/manifest.ts)
"""

import argparse
from dataclasses import dataclass
from pathlib import Path

# Ultralytics replaced the standalone `tflite` export with Google LiteRT in 8.4.83
# (docs.ultralytics.com/integrations/tflite). `format="tflite"` still works there but warns.
LITERT_SINCE = (8, 4, 83)


@dataclass(frozen=True)
class ExportApi:
    version: str
    format: str
    quantize_kwargs: str


def _parse_version(version: str) -> tuple[int, ...]:
    parts = []
    for piece in version.split(".")[:3]:
        digits = "".join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits or 0))
    return tuple(parts)


def resolve_export_api() -> ExportApi:
    """Inspect the INSTALLED Ultralytics and report which export format/args apply."""
    import ultralytics

    version = ultralytics.__version__
    if _parse_version(version) >= LITERT_SINCE:
        return ExportApi(version, "litert", "quantize=8|'w8a16'|'w8a32'|16|32, data=, fraction=")
    return ExportApi(version, "tflite", "int8=True | half=True, data=, fraction=")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--weights", default="yolov8n.pt")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--quantize", default="32", choices=["32", "16", "8", "w8a16", "w8a32"])
    parser.add_argument("--data", type=Path, default=None, help="calibration dataset YAML")
    parser.add_argument(
        "--out-dir", type=Path, default=Path(__file__).resolve().parents[1] / "artifacts"
    )
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--check-only", action="store_true", help="print the export API and exit")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    api = resolve_export_api()
    print(
        f"ultralytics {api.version}: format={api.format!r}; quantisation args: {api.quantize_kwargs}"
    )
    if args.check_only:
        return
    # TODO(feature): YOLO(args.weights).export(format=api.format, imgsz=args.imgsz, <quantisation per api>,
    # data=args.data) -> copy to out-dir/detector.tflite -> update manifest via _manifest.build_manifest
    # (arch "yolov8n", input [imgsz, imgsz, 3], input_range [0, 1], score_threshold 0.25).
    raise NotImplementedError("TODO(feature): export_detector.py export step")


if __name__ == "__main__":
    main()
