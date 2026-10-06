"""Writes `manifest.json` in exactly the shape mobile/src/ml/manifest.ts validates.

Keep SCHEMA_VERSION and field names in sync with that file; bump both together.
"""

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

SCHEMA_VERSION = 1

Dtype = Literal["float32", "uint8", "int8"]


@dataclass(frozen=True)
class DetectorEntry:
    file: str
    arch: str
    input: tuple[int, int, int]  # height, width, channels
    dtype: Dtype
    input_range: tuple[float, float]
    score_threshold: float
    model_version: str


@dataclass(frozen=True)
class EmbedderEntry:
    file: str
    arch: str
    input: tuple[int, int, int]
    dtype: Dtype
    input_range: tuple[float, float]
    dim: int
    model_version: str


def _check(entry: DetectorEntry | EmbedderEntry, name: str) -> None:
    if not entry.file.endswith(".tflite"):
        raise ValueError(f"{name}.file must end with .tflite")
    if len(entry.input) != 3 or any(n <= 0 for n in entry.input):
        raise ValueError(f"{name}.input must be three positive ints")
    if not entry.input_range[0] < entry.input_range[1]:
        raise ValueError(f"{name}.input_range must be [low, high]")


def build_manifest(
    detector: DetectorEntry, embedder: EmbedderEntry, match_threshold: float
) -> dict:
    _check(detector, "detector")
    _check(embedder, "embedder")
    if not 0 <= detector.score_threshold <= 1:
        raise ValueError("detector.score_threshold must be in [0, 1]")
    if embedder.dim <= 0:
        raise ValueError("embedder.dim must be positive")
    if not -1 <= match_threshold <= 1:
        raise ValueError("match_threshold must be in [-1, 1]")
    return {
        "schema_version": SCHEMA_VERSION,
        "detector": {
            **asdict(detector),
            "input": list(detector.input),
            "input_range": list(detector.input_range),
        },
        "embedder": {
            **asdict(embedder),
            "input": list(embedder.input),
            "input_range": list(embedder.input_range),
        },
        "match_threshold": match_threshold,
    }


def write_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def read_manifest(path: Path) -> dict:
    """Read an existing manifest (e.g. to update one model's entry and keep the other)."""
    return json.loads(path.read_text(encoding="utf-8"))
