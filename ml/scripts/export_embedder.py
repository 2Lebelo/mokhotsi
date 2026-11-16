"""Export the MobileNetV2+ArcFace product embedder to LiteRT (.tflite).

Model: a MobileNetV2 backbone with an ArcFace-trained 256-d embedding head (the app's
current model was trained and exported outside this repo as a full-int8 model; this stub
documents the reproduction path). The app L2-normalises the output on-device, so cosine
similarity is a dot product.
Conversion: tf.lite.TFLiteConverter.from_saved_model (LiteRT's recommended TF path).
Shipped precision: float activations with float16 weights (`embedder_f16.tflite`). Full-int8
models fail their first inference on some phones' LiteRT runtimes (32-bit Galaxy A02), so an
int8 export is rewritten with `make_float_models.py --pass int8-to-float --pass fp16-weights`.

Inputs:
  --input-size     Square input (default 224 -> 224x224x3).
  --quantize       none | dynamic | int8 (int8 needs --calibration-dir).
  --calibration-dir  Folder of representative product crops for int8 calibration.
  --out-dir        Where to write the model and manifest (default: ml/artifacts).
  --model-version  Version string stored in the manifest and on every stored vector,
                   e.g. mobilenetv2_arcface_256-224@2026-11-11. Changing it means re-embedding.

Outputs:
  <out-dir>/embedder_f16.tflite   input [1, 224, 224, 3] float32 in [-1, 1]; output [1, 256]
                                  (float16 weights, float32 activations and tensor interface)
  <out-dir>/manifest.json         (embedder entry updated; dim 256, input_range [-1, 1])
"""

import argparse
from pathlib import Path

EMBEDDING_DIM = 256


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
    # TODO(feature): build the MobileNetV2 backbone + ArcFace embedding head -> tf.saved_model.save
    # -> TFLiteConverter.from_saved_model (+ optimizations / representative_dataset for int8) ->
    # make_float_models.py (float activations, fp16 weights) -> write embedder_f16.tflite ->
    # assert output dim == EMBEDDING_DIM -> update manifest via _manifest (schema 5:
    # match_threshold/match_margin on the embedder, plus its sha256).
    raise NotImplementedError("TODO(feature): export_embedder.py conversion")


if __name__ == "__main__":
    main()
