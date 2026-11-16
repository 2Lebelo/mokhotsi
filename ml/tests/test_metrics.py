"""The statistics must match mobile/src/features/evaluation/stats.ts value for value."""

import math

import pytest

from _metrics import confusion, markdown_table, proportion, quantile, summarise


def test_quantile_is_numpy_linear():
    assert quantile([1, 2, 3, 4], 0.5) == 2.5
    assert quantile([10], 0.95) == 10
    assert math.isclose(quantile([1, 2, 3, 4, 5], 0.95), 4.8)
    with pytest.raises(ValueError):
        quantile([], 0.5)


def test_summarise_uses_sample_sd_and_rounds_like_the_app():
    s = summarise([4, 2, 1, 3])
    assert (s.n, s.mean, s.median, s.sd, s.min, s.max) == (4, 2.5, 2.5, 1.29, 1, 4)
    assert summarise([7]).sd == 0
    with pytest.raises(ValueError):
        summarise([])


def test_wilson_interval_matches_reference_values():
    # statsmodels proportion_confint(8, 10, method="wilson") -> (0.4902, 0.9433)
    p = proportion(8, 10)
    assert p.rate == 0.8
    assert math.isclose(p.low, 0.4902, abs_tol=1e-4)
    assert math.isclose(p.high, 0.9433, abs_tol=1e-4)
    assert proportion(0, 5).low == 0
    assert proportion(5, 5).high == 1
    assert proportion(0, 0).rate is None
    assert proportion(0, 0).text() == "–"
    assert proportion(8, 10).text() == "80.0% (49.0–94.3) 8/10"


def test_confusion_counts_pairs_with_every_truth_as_a_column():
    rows, columns, matrix = confusion([("a", "a"), ("a", "b"), ("b", "(none)"), ("a", "a")])
    assert rows == ["a", "b"]
    assert columns == ["(none)", "a", "b"]
    assert matrix == [[0, 2, 1], [1, 0, 0]]


def test_markdown_table_escapes_pipes_and_formats_missing():
    table = markdown_table(["x", "y"], [["a|b", None], ["c", 1.234]])
    assert table.splitlines() == ["| x | y |", "| --- | --- |", "| a\\|b | – |", "| c | 1.23 |"]
