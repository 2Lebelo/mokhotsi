"""Charts for the evaluation reports (PNG, 200 dpi, sized for an A4 thesis page)."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # Files only; never opens a window.
import matplotlib.pyplot as plt

ACCENT = "#1F5F4E"
SECOND = "#C0362C"
GREY = "#6B7280"


def _save(fig, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(path, dpi=200)
    plt.close(fig)


def plot_sweep(sweep: Sequence[dict], operating: float, path: Path) -> None:
    """Top-1 accuracy, false-accept and reject rate against the accept threshold."""
    thresholds = [row["threshold"] for row in sweep]

    def series(key: str) -> list[float]:
        return [(row[key]["rate"] or 0.0) * 100 for row in sweep]

    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    ax.plot(thresholds, series("top1"), marker="o", color=ACCENT, label="Top-1 accuracy")
    ax.plot(thresholds, series("reject"), marker="s", color=GREY, label="Known items rejected")
    if any(row["false_accept"]["n"] for row in sweep):
        ax.plot(thresholds, series("false_accept"), marker="^", color=SECOND, label="False accepts")
    ax.axvline(operating, color="black", linestyle="--", linewidth=1, label="App threshold")
    ax.set_xlabel("Cosine accept threshold")
    ax.set_ylabel("Share of queries (%)")
    ax.set_ylim(-2, 102)
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    _save(fig, path)


def plot_confusion(
    rows: Sequence[str], columns: Sequence[str], matrix: Sequence[Sequence[int]], path: Path
) -> None:
    size = max(4.0, 0.45 * max(len(rows), len(columns)) + 2)
    fig, ax = plt.subplots(figsize=(size, size * 0.85))
    image = ax.imshow(matrix, cmap="Greens")
    ax.set_xticks(range(len(columns)), columns, rotation=60, ha="right", fontsize=7)
    ax.set_yticks(range(len(rows)), rows, fontsize=7)
    ax.set_xlabel("Predicted (locked) product")
    ax.set_ylabel("True product")
    peak = max((max(r) for r in matrix), default=0)
    for i, row in enumerate(matrix):
        for j, count in enumerate(row):
            if count:
                colour = "white" if count > peak / 2 else "black"
                ax.text(j, i, str(count), ha="center", va="center", fontsize=7, color=colour)
    fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04)
    _save(fig, path)


def plot_latency_boxes(stages: dict[str, Sequence[float]], path: Path, title: str) -> None:
    names = [name for name, values in stages.items() if values]
    if not names:
        return
    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    ax.boxplot(
        [stages[n] for n in names],
        tick_labels=names,
        showfliers=True,
        flierprops={"markersize": 2, "markerfacecolor": GREY, "markeredgecolor": GREY},
        medianprops={"color": ACCENT},
    )
    ax.set_ylabel("Milliseconds")
    ax.set_title(title, fontsize=10)
    ax.grid(axis="y", alpha=0.3)
    _save(fig, path)


def plot_cdf(series: dict[str, Sequence[float]], path: Path, xlabel: str) -> None:
    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    colours = [ACCENT, SECOND, GREY]
    for (label, values), colour in zip(series.items(), colours * 3, strict=False):
        ordered = sorted(values)
        if not ordered:
            continue
        ys = [(i + 1) / len(ordered) * 100 for i in range(len(ordered))]
        ax.step(ordered, ys, where="post", color=colour, label=f"{label} (n = {len(ordered)})")
    ax.set_xlabel(xlabel)
    ax.set_ylabel("Trials (%)")
    ax.set_ylim(0, 102)
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    _save(fig, path)


def plot_product_accuracy(
    products: Sequence[str], top1: Sequence[float], top3: Sequence[float], path: Path
) -> None:
    if not products:
        return
    height = max(3.0, 0.32 * len(products) + 1.2)
    fig, ax = plt.subplots(figsize=(6.4, height))
    positions = range(len(products))
    ax.barh([p + 0.2 for p in positions], [v * 100 for v in top3], 0.4, color=GREY, label="Top-3")
    ax.barh([p - 0.2 for p in positions], [v * 100 for v in top1], 0.4, color=ACCENT, label="Top-1")
    ax.set_yticks(list(positions), products, fontsize=7)
    ax.invert_yaxis()
    ax.set_xlim(0, 100)
    ax.set_xlabel("Trials recognised (%)")
    ax.grid(axis="x", alpha=0.3)
    ax.legend(fontsize=8, loc="lower right")
    _save(fig, path)
