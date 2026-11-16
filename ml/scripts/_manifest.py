"""Writes `manifest.json` in exactly the shape mobile/src/ml/manifest.ts validates.

Keep SCHEMA_VERSION and field names in sync with that file; bump both together.
Schema 5: thresholds live on the embedder (match_threshold, match_margin), the
embedder's tensor contract is fixed float32 NHWC so it carries no layout/dtype,
and `matching` holds only top_k.
"""

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

SCHEMA_VERSION = 5

Layout = Literal["nhwc", "nchw"]


@dataclass(frozen=True)
class DetectorEntry:
    file: str
    arch: str
    model_version: str
    input: tuple[int, int, int]  # height, width, channels
    layout: Layout  # Ultralytics LiteRT export: "nchw"
    dtype: Literal["float32"]
    input_range: tuple[float, float]
    output: tuple[int, int]  # [channels, anchors]: 4 box rows + one score row per class
    show_threshold: float
    keep_threshold: float
    max_fps: int


@dataclass(frozen=True)
class EmbedderEntry:
    file: str
    arch: str
    model_version: str
    input: tuple[int, int, int]
    input_range: tuple[float, float]
    resize: Literal["letterbox"]
    dim: int
    match_threshold: float
    match_margin: float
    sha256: str  # of the model file, pinning exactly which export this describes


def _check_common(entry: DetectorEntry | EmbedderEntry, name: str) -> None:
    if not entry.file.endswith(".tflite"):
        raise ValueError(f"{name}.file must end with .tflite")
    if len(entry.input) != 3 or any(n <= 0 for n in entry.input):
        raise ValueError(f"{name}.input must be three positive ints")
    if not entry.input_range[0] < entry.input_range[1]:
        raise ValueError(f"{name}.input_range must be [low, high]")


def build_manifest(detector: DetectorEntry, embedder: EmbedderEntry, top_k: int = 3) -> dict:
    _check_common(detector, "detector")
    _check_common(embedder, "embedder")
    if detector.output[0] < 5:
        raise ValueError("detector.output[0] must be at least 5 (4 box rows + scores)")
    if not 0 <= detector.keep_threshold <= detector.show_threshold <= 1:
        raise ValueError("need 0 <= keep_threshold <= show_threshold <= 1")
    if embedder.dim <= 0:
        raise ValueError("embedder.dim must be positive")
    for key in ("match_threshold", "match_margin"):
        if not 0 <= getattr(embedder, key) <= 1:
            raise ValueError(f"embedder.{key} must be in [0, 1]")
    if not re.fullmatch(r"[0-9a-f]{64}", embedder.sha256):
        raise ValueError("embedder.sha256 must be 64 lowercase hex characters")
    if top_k < 1:
        raise ValueError("matching.top_k must be a positive integer")
    return {
        "schema_version": SCHEMA_VERSION,
        "detector": {
            **asdict(detector),
            "input": list(detector.input),
            "input_range": list(detector.input_range),
            "output": list(detector.output),
        },
        "embedder": {
            **asdict(embedder),
            "input": list(embedder.input),
            "input_range": list(embedder.input_range),
        },
        "matching": {"top_k": top_k},
    }


def write_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def read_manifest(path: Path) -> dict:
    """Read an existing manifest (e.g. to update one model's entry and keep the other)."""
    return json.loads(path.read_text(encoding="utf-8"))
