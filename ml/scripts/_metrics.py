"""Descriptive statistics shared by the evaluation scripts.

Defined exactly as mobile/src/features/evaluation/stats.ts defines them (numpy-linear
quantiles, sample standard deviation, Wilson score 95% intervals), so the numbers on the phone
and in the thesis tables agree.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass

Z95 = 1.959963984540054


@dataclass(frozen=True)
class LatencySummary:
    n: int
    mean: float
    sd: float
    min: float
    median: float
    p90: float
    p95: float
    max: float

    def as_dict(self) -> dict[str, float | int]:
        return asdict(self)


@dataclass(frozen=True)
class Proportion:
    k: int
    n: int
    rate: float | None
    low: float | None
    high: float | None

    def as_dict(self) -> dict[str, float | int | None]:
        return asdict(self)

    def text(self) -> str:
        """'87.5% (64.0–96.5) 14/16', or '–' without trials."""
        if self.rate is None or self.low is None or self.high is None:
            return "–"
        return (
            f"{self.rate * 100:.1f}% ({self.low * 100:.1f}–{self.high * 100:.1f}) {self.k}/{self.n}"
        )


def quantile(sorted_values: Sequence[float], q: float) -> float:
    """Linear-interpolated quantile of already sorted values (numpy's default method)."""
    if not sorted_values:
        raise ValueError("quantile of no values")
    position = (len(sorted_values) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    weight = position - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * weight


def _round(value: float) -> float:
    return round(value, 2)


def summarise(values: Iterable[float]) -> LatencySummary:
    ordered = sorted(float(v) for v in values)
    if not ordered:
        raise ValueError("summarise of no values")
    n = len(ordered)
    mean = sum(ordered) / n
    variance = sum((v - mean) ** 2 for v in ordered) / (n - 1) if n > 1 else 0.0
    return LatencySummary(
        n=n,
        mean=_round(mean),
        sd=_round(math.sqrt(variance)),
        min=_round(ordered[0]),
        median=_round(quantile(ordered, 0.5)),
        p90=_round(quantile(ordered, 0.9)),
        p95=_round(quantile(ordered, 0.95)),
        max=_round(ordered[-1]),
    )


def summarise_or_none(values: Iterable[float]) -> LatencySummary | None:
    values = list(values)
    return summarise(values) if values else None


def proportion(k: int, n: int) -> Proportion:
    """k of n with a Wilson score 95% interval (sound for small n and rates near 0 or 1)."""
    if n == 0:
        return Proportion(k, n, None, None, None)
    p = k / n
    z2 = Z95 * Z95
    denominator = 1 + z2 / n
    centre = (p + z2 / (2 * n)) / denominator
    half = Z95 * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator
    return Proportion(k, n, p, max(0.0, centre - half), min(1.0, centre + half))


def confusion(pairs: Iterable[tuple[str, str]]) -> tuple[list[str], list[str], list[list[int]]]:
    """Counts of (truth, predicted) pairs as (row labels, column labels, matrix)."""
    pairs = list(pairs)
    rows = sorted({t for t, _ in pairs})
    columns = sorted({p for _, p in pairs} | set(rows))
    index_row = {label: i for i, label in enumerate(rows)}
    index_col = {label: i for i, label in enumerate(columns)}
    matrix = [[0] * len(columns) for _ in rows]
    for truth, predicted in pairs:
        matrix[index_row[truth]][index_col[predicted]] += 1
    return rows, columns, matrix


def markdown_table(header: Sequence[str], rows: Iterable[Sequence[object]]) -> str:
    """A GitHub-flavoured Markdown table (pastes into Word via most Markdown converters)."""

    def cell(value: object) -> str:
        if value is None:
            return "–"
        if isinstance(value, float):
            return f"{value:.2f}"
        return str(value).replace("|", "\\|")

    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    lines += ["| " + " | ".join(cell(v) for v in row) + " |" for row in rows]
    return "\n".join(lines)


def latency_row(name: str, summary: LatencySummary | None) -> list[object]:
    if summary is None:
        return [name, 0, None, None, None, None, None]
    return [
        name,
        summary.n,
        f"{summary.mean:.1f} ± {summary.sd:.1f}",
        summary.median,
        summary.p90,
        summary.p95,
        summary.max,
    ]


LATENCY_HEADER = ["Measure", "n", "Mean ± SD (ms)", "Median", "P90", "P95", "Max"]
