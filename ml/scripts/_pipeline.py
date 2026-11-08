"""A desktop mirror of the app's recognition pipeline, for offline evaluation.

Every step copies the app's code so desktop results describe the shipped behaviour:

  photo -> upright -> centre square -> 448 px crop source      (still-pipeline.ts `prepare`)
  crop source -> 320 px detector input, [0,1], NCHW           (tensors.ts `sampleToTensor`)
  detector -> arg-max box -> show threshold                   (yolo.ts `decodeBestBox`, `holdBox`)
  box -> padded square -> 224 px embedder input, [-1,1], NHWC (geometry.ts `squareCrop`)
  embedder -> L2 normalise -> int8 index -> best view/product (vector.ts, vector-index.ts)
  accept: top >= accept_threshold and top - second >= margin  (voter.ts, one view)

Model shapes and thresholds come from mobile/assets/models/manifest.json. App-side constants
are mirrored from PIPELINE in mobile/src/features/vision/config.ts: keep them in step.

Known, small difference: the app resizes the centre square to 448 px with Android's bitmap
filter; Pillow's bilinear filter also antialiases when shrinking. Both feed the same
bilinear sampler afterwards, so embeddings differ only slightly.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter
from PIL import Image, ImageOps

MOBILE = Path(__file__).resolve().parents[2] / "mobile"
MODELS_DIR = MOBILE / "assets" / "models"
MANIFEST_PATH = MODELS_DIR / "manifest.json"

# Mirrors PIPELINE in mobile/src/features/vision/config.ts.
CROP_SOURCE_SIZE = 448
CROP_PAD = 0.08
PHOTO_CROP_PADS = (0.08, 0.25)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def load_manifest(path: Path = MANIFEST_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf8"))


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class ScoredBox(Box):
    score: float


WHOLE = Box(0.0, 0.0, 1.0, 1.0)


def square_crop(box: Box, pad: float) -> Box:
    """geometry.ts squareCrop: a padded square, shifted (not clipped) to stay inside."""
    side = min(1.0, max(box.width, box.height) * (1 + 2 * pad))
    cx = box.x + box.width / 2
    cy = box.y + box.height / 2
    x = min(max(cx - side / 2, 0.0), 1 - side)
    y = min(max(cy - side / 2, 0.0), 1 - side)
    return Box(x, y, side, side)


def crop_source(path: Path, size: int = CROP_SOURCE_SIZE) -> np.ndarray:
    """An upright photo's centre square at `size` px, as uint8 RGB (H, W, 3)."""
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    side = min(image.width, image.height)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    square = image.crop((left, top, left + side, top + side))
    if side != size:
        square = square.resize((size, size), Image.Resampling.BILINEAR)
    return np.asarray(square, dtype=np.uint8)


def _axis(start: float, step: float, size: int, limit: int):
    s = start + (np.arange(size) + 0.5) * step - 0.5
    s = np.clip(s, 0, limit - 1)
    i0 = np.floor(s).astype(np.int64)
    i1 = np.where(i0 + 1 < limit, i0 + 1, i0)
    return i0, i1, s - i0


def sample_to_tensor(
    pixels: np.ndarray,
    region: Box,
    size: int,
    layout: str,
    value_range: tuple[float, float],
) -> np.ndarray:
    """tensors.ts sampleToTensor: bilinear `region` -> size x size, mapped to `value_range`.

    Returns float32 shaped (1, 3, size, size) for "nchw" or (1, size, size, 3) for "nhwc".
    """
    height, width = pixels.shape[:2]
    x0, x1, fx = _axis(region.x * width, region.width * width / size, size, width)
    y0, y1, fy = _axis(region.y * height, region.height * height / size, size, height)
    src = pixels.astype(np.float64)
    fx = fx[None, :, None]
    fy = fy[:, None, None]
    top = src[y0][:, x0] * (1 - fx) + src[y0][:, x1] * fx
    bottom = src[y1][:, x0] * (1 - fx) + src[y1][:, x1] * fx
    rgb = top * (1 - fy) + bottom * fy
    low, high = value_range
    values = (low + rgb * ((high - low) / 255)).astype(np.float32)
    if layout == "nchw":
        return values.transpose(2, 0, 1)[None]
    return values[None]


def decode_best_box(output: np.ndarray, threshold: float = 0.0) -> ScoredBox | None:
    """yolo.ts decodeBestBox over a (channels, anchors) YOLOv8 output; no NMS needed."""
    out = np.asarray(output, dtype=np.float32).reshape(output.shape[-2], output.shape[-1])
    scores = out[4:]
    flat = int(np.argmax(scores))  # First maximum in row-major order, as the app's loop.
    best_score = float(scores.reshape(-1)[flat])
    if not best_score > threshold:
        return None
    anchor = flat % out.shape[1]
    cx, cy, w, h = (float(out[c, anchor]) for c in range(4))
    x = max(0.0, cx - w / 2)
    y = max(0.0, cy - h / 2)
    return ScoredBox(
        x,
        y,
        max(0.0, min(1.0, cx + w / 2) - x),
        max(0.0, min(1.0, cy + h / 2) - y),
        best_score,
    )


def hold_box(best: ScoredBox | None, shown: bool, show: float, keep: float) -> ScoredBox | None:
    if best is None:
        return None
    return best if best.score >= (keep if shown else show) else None


def l2_normalize(vector: np.ndarray) -> np.ndarray:
    vector = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.sqrt(np.sum(vector.astype(np.float64) ** 2)))
    return vector / norm if norm > 0 else vector


class Models:
    """The bundled detector and embedder on LiteRT (CPU, XNNPACK), validated against the manifest."""

    def __init__(
        self,
        manifest: dict,
        detector: Path | None,
        embedder: Path,
        threads: int = 4,
    ) -> None:
        self.manifest = manifest
        self.detector = self._load(detector, threads) if detector else None
        self.embedder = self._load(embedder, threads)
        spec = manifest["embedder"]
        self._check(self.embedder, [1, *spec["input"]], [1, spec["dim"]], "embedder")
        if self.detector:
            spec = manifest["detector"]
            h, w, c = spec["input"]
            shape = [1, c, h, w] if spec["layout"] == "nchw" else [1, h, w, c]
            self._check(self.detector, shape, [1, *spec["output"]], "detector")

    @staticmethod
    def _load(path: Path, threads: int) -> Interpreter:
        interpreter = Interpreter(model_path=str(path), num_threads=threads)
        interpreter.allocate_tensors()
        return interpreter

    @staticmethod
    def _check(interpreter: Interpreter, inp: list[int], out: list[int], name: str) -> None:
        got_in = list(interpreter.get_input_details()[0]["shape"])
        got_out = list(interpreter.get_output_details()[0]["shape"])
        if got_in != inp or got_out != out:
            raise SystemExit(
                f"{name}: model is {got_in} -> {got_out}, the manifest says {inp} -> {out}"
            )

    @staticmethod
    def _run(interpreter: Interpreter, tensor: np.ndarray) -> np.ndarray:
        interpreter.set_tensor(interpreter.get_input_details()[0]["index"], tensor)
        interpreter.invoke()
        return interpreter.get_tensor(interpreter.get_output_details()[0]["index"])

    def detect(self, source: np.ndarray) -> tuple[ScoredBox | None, float | None, float]:
        """(box past the show threshold, best raw score, ms) for a crop source."""
        if self.detector is None:
            return None, None, 0.0
        spec = self.manifest["detector"]
        start = time.perf_counter()
        tensor = sample_to_tensor(
            source, WHOLE, spec["input"][0], spec["layout"], tuple(spec["input_range"])
        )
        output = self._run(self.detector, tensor)[0]
        best = decode_best_box(output, 0.0)
        box = hold_box(best, False, spec["show_threshold"], spec["keep_threshold"])
        return box, (best.score if best else None), (time.perf_counter() - start) * 1000

    def embed(self, source: np.ndarray, region: Box) -> tuple[np.ndarray, float]:
        spec = self.manifest["embedder"]
        start = time.perf_counter()
        tensor = sample_to_tensor(
            source, region, spec["input"][0], spec["layout"], tuple(spec["input_range"])
        )
        vector = l2_normalize(self._run(self.embedder, tensor))
        return vector, (time.perf_counter() - start) * 1000


@dataclass
class EmbeddedImage:
    path: Path
    box: ScoredBox | None
    detector_score: float | None
    vectors: list[np.ndarray]
    load_ms: float
    detect_ms: float
    embed_ms: list[float]


def embed_image(models: Models, path: Path, pads: tuple[float, ...]) -> EmbeddedImage:
    """still-pipeline.ts: one vector per pad around the detected item, or the whole image."""
    start = time.perf_counter()
    source = crop_source(path)
    load_ms = (time.perf_counter() - start) * 1000
    box, score, detect_ms = models.detect(source)
    regions = [square_crop(box, pad) for pad in pads] if box else [WHOLE]
    vectors, embed_ms = [], []
    for region in regions:
        vector, ms = models.embed(source, region)
        vectors.append(vector)
        embed_ms.append(ms)
    return EmbeddedImage(path, box, score, vectors, load_ms, detect_ms, embed_ms)


def _js_round(values: np.ndarray) -> np.ndarray:
    """JavaScript Math.round (halves toward +infinity), unlike numpy's banker's rounding."""
    return np.floor(values + 0.5)


class VectorIndex:
    """vector-index.ts: one row per stored view, int8 with a per-row scale; best view per product."""

    def __init__(self, dim: int, quantise: bool = True) -> None:
        self.dim = dim
        self.quantise = quantise
        self.rows: list[np.ndarray] = []
        self.scales: list[float] = []
        self.ids: list[str] = []

    def __len__(self) -> int:
        return len(self.ids)

    def add(self, product_id: str, vector: np.ndarray) -> None:
        vector = np.asarray(vector, dtype=np.float32).reshape(-1)
        if vector.shape[0] != self.dim:
            raise ValueError(f"vector has {vector.shape[0]} values; the index expects {self.dim}")
        if self.quantise:
            scale = float(np.max(np.abs(vector))) / 127
            row = (
                _js_round(vector / scale).astype(np.int8)
                if scale > 0
                else np.zeros(self.dim, np.int8)
            )
            self.rows.append(row.astype(np.float64))
            self.scales.append(scale)
        else:
            self.rows.append(vector.astype(np.float64))
            self.scales.append(1.0)
        self.ids.append(product_id)

    def top_k(self, query: np.ndarray, k: int) -> list[tuple[str, float]]:
        if not self.ids:
            return []
        matrix = np.stack(self.rows)
        scores = (matrix @ np.asarray(query, dtype=np.float64)) * np.asarray(self.scales)
        best: dict[str, float] = {}
        for product_id, score in zip(self.ids, scores, strict=True):
            if product_id not in best or score > best[product_id]:
                best[product_id] = float(score)
        return sorted(best.items(), key=lambda item: -item[1])[:k]


def accepts(ranking: list[tuple[str, float]], threshold: float, margin: float) -> str | None:
    """voter.ts win rule for one view: the top product, if it clears threshold and margin."""
    if not ranking:
        return None
    top_id, top = ranking[0]
    second = ranking[1][1] if len(ranking) > 1 else 0.0
    return top_id if top >= threshold and top - second >= margin else None


def images_in(folder: Path) -> list[Path]:
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
