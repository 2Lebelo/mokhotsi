"""The desktop pipeline must behave like the app's (mobile/src/ml/*.ts)."""

import numpy as np
import pytest
from PIL import Image

from _pipeline import (
    WHOLE,
    Box,
    ScoredBox,
    VectorIndex,
    accepts,
    crop_source,
    decode_best_box,
    hold_box,
    l2_normalize,
    sample_to_tensor,
    square_crop,
)


def test_square_crop_is_square_padded_and_shifted_inside():
    crop = square_crop(Box(0.8, 0.1, 0.3, 0.2), 0.1)
    assert crop.width == crop.height == pytest.approx(0.36)
    assert crop.x + crop.width == pytest.approx(1.0)  # shifted, not clipped
    assert square_crop(Box(0, 0, 1, 1), 0.25) == Box(0, 0, 1, 1)


def test_sample_to_tensor_identity_ranges_and_layouts():
    rng = np.random.default_rng(0)
    pixels = rng.integers(0, 256, (8, 8, 3), dtype=np.uint8)
    nhwc = sample_to_tensor(pixels, WHOLE, 8, "nhwc", (0, 255))
    assert nhwc.shape == (1, 8, 8, 3)
    assert np.array_equal(nhwc[0], pixels.astype(np.float32))  # same size: exact copy
    nchw = sample_to_tensor(pixels, WHOLE, 8, "nchw", (-1, 1))
    assert nchw.shape == (1, 3, 8, 8)
    assert nchw.min() >= -1 and nchw.max() <= 1
    assert np.allclose(nchw[0, 0], pixels[:, :, 0] / 127.5 - 1, atol=1e-6)


def test_sample_to_tensor_bilinear_halves():
    pixels = np.zeros((2, 2, 3), np.uint8)
    pixels[:, 1] = 200
    out = sample_to_tensor(pixels, WHOLE, 4, "nhwc", (0, 255))[0, 0, :, 0]
    # Edges clamp to the source pixels; the middle is interpolated.
    assert out.tolist() == pytest.approx([0, 50, 150, 200])


def test_decode_best_box_and_hold_box():
    out = np.zeros((5, 10), np.float32)
    out[4, 3] = 0.9
    out[:4, 3] = [0.5, 0.5, 0.4, 0.2]
    out[4, 7] = 0.9  # tie: the first wins, as in the app's loop
    best = decode_best_box(out)
    # Float32 model output: compare field by field.
    assert isinstance(best, ScoredBox)
    assert (best.x, best.y, best.width, best.height, best.score) == pytest.approx(
        (0.3, 0.4, 0.4, 0.2, 0.9)
    )
    assert decode_best_box(np.zeros((5, 10), np.float32)) is None
    assert hold_box(best, False, 0.95, 0.4) is None
    assert hold_box(best, True, 0.95, 0.4) is best


def test_vector_index_best_view_per_product_and_int8_is_close():
    rng = np.random.default_rng(3)
    a, b = l2_normalize(rng.normal(size=16)), l2_normalize(rng.normal(size=16))
    exact, quantised = VectorIndex(16, quantise=False), VectorIndex(16)
    for index in (exact, quantised):
        index.add("a", a)
        index.add("b", b)
        index.add("a", l2_normalize(a + 0.5 * b))
    top = exact.top_k(a, 3)
    assert [p for p, _ in top] == ["a", "b"]
    assert top[0][1] == pytest.approx(1.0, abs=1e-6)
    for (p1, s1), (p2, s2) in zip(top, quantised.top_k(a, 3), strict=True):
        assert p1 == p2 and s1 == pytest.approx(s2, abs=2e-2)
    with pytest.raises(ValueError):
        exact.add("c", np.ones(3))


def test_accepts_needs_threshold_and_margin():
    assert accepts([("a", 0.8), ("b", 0.7)], 0.6, 0.03) == "a"
    assert accepts([("a", 0.8), ("b", 0.79)], 0.6, 0.03) is None
    assert accepts([("a", 0.5)], 0.6, 0.03) is None
    assert accepts([("a", 0.61)], 0.6, 0.03) == "a"
    assert accepts([], 0.6, 0.03) is None


def test_crop_source_is_the_centre_square(tmp_path):
    image = Image.new("RGB", (300, 100), (255, 0, 0))
    image.paste((0, 0, 255), (100, 0, 200, 100))  # blue centre square
    path = tmp_path / "wide.png"
    image.save(path)
    source = crop_source(path, size=50)
    assert source.shape == (50, 50, 3)
    assert source[25, 25].tolist() == [0, 0, 255]
