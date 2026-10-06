"""Export the MobileNetV2 product embedder (no classification head) to LiteRT (.tflite).

Model: tf.keras.applications.MobileNetV2(include_top=False, pooling="avg", weights="imagenet",
input_shape=(224, 224, 3)) -> a 1280-d global-average-pooled feature vector. The app
L2-normalises it on-device, so cosine similarity is a dot product.
Conversion: tf.lite.TFLiteConverter.from_saved_model (LiteRT's recommended TF path).

Inputs:
  --input-size     Square input (default 224 -> 224x224x3).
  --quantize       none | dynamic | int8 (int8 needs --calibration-dir).
  --calibration-dir  Folder of representative product crops for int8 calibration.
  --out-dir        Where to write the model and manifest (default: ml/artifacts).
  --model-version  Version string stored in the manifest and on every stored vector,
                   e.g. mobilenet_v2-224-1280@2026-10-06. Changing it means re-embedding.

Outputs:
  <out-dir>/embedder.tflite   input [1, 224, 224, 3] float32 in [-1, 1]; output [1, 1280]
  <out-dir>/manifest.json     (embedder entry updated; dim 1280, input_range [-1, 1])
"""

import argparse
from pathlib import Path

EMBEDDING_DIM = 1280


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--input-size", type=int, default=224)
    parser.add_argument("--quantize", default="none", choices=["none", "dynamic", "int8"])
    parser.add_argument("--calibration-dir", type=Path, default=None)
    parser.add_argument(
        "--out-dir", type=Path, default=Path(__file__).resolve().parents[1] / "artifacts"
    )
    parser.add_argument("--model-version", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.quantize == "int8" and args.calibration_dir is None:
        raise SystemExit("--quantize int8 requires --calibration-dir")
    # TODO(feature): build MobileNetV2(include_top=False, pooling="avg") -> tf.saved_model.save ->
    # TFLiteConverter.from_saved_model (+ optimizations / representative_dataset for int8) ->
    # write embedder.tflite -> assert output dim == EMBEDDING_DIM -> update manifest via _manifest.
    raise NotImplementedError("TODO(feature): export_embedder.py conversion")


if __name__ == "__main__":
    main()
