"""Check that an exported .tflite model matches its source model before shipping it.

Inputs:
  --model       detector | embedder
  --tflite      Path to the exported .tflite file.
  --images      Folder of sample product photos (jpg/png).
  --weights     Source weights for the detector (.pt); the embedder rebuilds MobileNetV2.
  --min-cosine  Embedder: minimum cosine(reference, tflite) per image (default 0.995).
  --min-iou     Detector: minimum IoU of the top box per image (default 0.9).

Outputs:
  A per-image table on stdout and a non-zero exit code if any image is below the threshold.
  Run it after every export and after changing quantisation.
"""

import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--model", required=True, choices=["detector", "embedder"])
    parser.add_argument("--tflite", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--weights", type=Path, default=None)
    parser.add_argument("--min-cosine", type=float, default=0.995)
    parser.add_argument("--min-iou", type=float, default=0.9)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    # TODO(feature): preprocess each image exactly as the app does (resize, input_range); run the
    # reference model and the LiteRT interpreter (verify the import path for the installed
    # ai-edge-litert); compare cosine (embedder) or top-box IoU (detector); exit 1 on any failure.
    raise NotImplementedError(f"TODO(feature): parity_check.py for {args.model}")


if __name__ == "__main__":
    main()
