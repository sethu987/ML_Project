"""Dataset summaries and sampled visualizations for exploratory analysis."""

import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns


def safe_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.casefold()).strip("_")


def analyze_dataset(
    frame: pd.DataFrame,
    label: str,
    output_dir: Path,
    target_columns: list[str],
    sample_size: int = 20_000,
) -> dict:
    """Summarize the full dataset; sample rows only for plots."""
    output_dir.mkdir(parents=True, exist_ok=True)
    sample = frame.sample(n=min(sample_size, len(frame)), random_state=42)
    numeric = frame.select_dtypes(include=np.number).columns.tolist()
    categorical = [
        column for column in frame.columns
        if column not in numeric and not pd.api.types.is_datetime64_any_dtype(frame[column])
    ]
    missing = frame.isna().sum()
    missing_percent = (missing / len(frame) * 100).round(2)
    duplicate_rows = int(frame.duplicated().sum())
    summary = {
        "rows": int(len(frame)),
        "columns": int(frame.shape[1]),
        "numeric_columns": numeric,
        "categorical_columns": categorical,
        "exact_duplicate_rows": duplicate_rows,
        "missing_values": {
            column: {"count": int(missing[column]), "percent": float(missing_percent[column])}
            for column in frame.columns if missing[column] > 0
        },
        "categorical_values": {},
        "category_quality_flags": {},
        "target_summaries": {},
        "potential_outliers": {},
    }
    print(f"\nEDA: {label} — {len(frame):,} rows x {frame.shape[1]} columns")
    print("Numerical columns:", numeric)
    print("Categorical columns:", categorical)
    print(f"Exact duplicate rows: {duplicate_rows:,}; retained for review.")
    if summary["missing_values"]:
        print("Missing values:\n", pd.DataFrame(summary["missing_values"]).T.to_string())
    else:
        print("Missing values: none")

    for column in categorical:
        counts = frame[column].astype("string").value_counts(dropna=False)
        summary["categorical_values"][column] = {
            str(value): int(count) for value, count in counts.head(20).items()
        }
        if frame[column].nunique(dropna=True) <= 50:
            rare = {
                str(value): int(count) for value, count in counts.items()
                if pd.notna(value) and count < max(2, len(frame) * 0.001)
            }
            short = {
                str(value): int(count) for value, count in counts.items()
                if pd.notna(value) and len(str(value).strip()) == 1
            }
            normalized: dict[str, list[str]] = {}
            for value in counts.index:
                if pd.notna(value):
                    normalized.setdefault(str(value).strip().casefold(), []).append(str(value))
            variants = [values for values in normalized.values() if len(set(values)) > 1]
            if rare or short or variants:
                summary["category_quality_flags"][column] = {
                    "rare_values": rare,
                    "single_character_values": short,
                    "case_whitespace_variants": variants,
                }
        print(f"Top categories for {column}:\n{counts.head(10).to_string()}")

    for target in target_columns:
        if target not in frame:
            continue
        if pd.api.types.is_numeric_dtype(frame[target]):
            values = pd.to_numeric(frame[target], errors="coerce")
            summary["target_summaries"][target] = {
                "count": int(values.count()),
                "missing": int(values.isna().sum()),
                "minimum": float(values.min()),
                "median": float(values.median()),
                "maximum": float(values.max()),
            }
            print(f"Target {target}:\n{values.describe().to_string()}")
        else:
            counts = frame[target].astype("string").value_counts(dropna=False)
            summary["target_summaries"][target] = {
                str(value): int(count) for value, count in counts.items()
            }
            print(f"Target {target}:\n{counts.to_string()}")

    for column in numeric:
        values = pd.to_numeric(frame[column], errors="coerce").dropna()
        if len(values) < 4:
            continue
        q1, q3 = values.quantile([0.25, 0.75])
        spread = q3 - q1
        low, high = q1 - 1.5 * spread, q3 + 1.5 * spread
        outlier_count = int(((values < low) | (values > high)).sum())
        if outlier_count:
            summary["potential_outliers"][column] = {
                "count": outlier_count,
                "lower_fence": float(low),
                "upper_fence": float(high),
            }
    print("Potential IQR outliers are flagged, not automatically removed:",
          summary["potential_outliers"])

    # Sample rows for plots only; all row counts and model evaluation use full data.
    plottable_numeric = [
        column for column in numeric
        if column.strip().casefold() not in {"slno", "service id", "id"}
        and sample[column].notna().any()
    ]
    if plottable_numeric:
        selected = plottable_numeric[:12]
        sample[selected].hist(figsize=(14, 9), bins=30)
        plt.suptitle(f"{label}: numerical feature histograms")
        plt.tight_layout()
        plt.savefig(output_dir / "numeric_histograms.png", dpi=130)
        plt.close("all")

    if summary["missing_values"]:
        missing_columns = list(summary["missing_values"])[:30]
        plt.figure(figsize=(max(8, len(missing_columns) * 0.35), 5))
        sns.heatmap(sample[missing_columns].isna().head(500), cbar=False, yticklabels=False)
        plt.title(f"{label}: missing-value pattern (plot sample)")
        plt.tight_layout()
        plt.savefig(output_dir / "missing_values.png", dpi=130)
        plt.close()

    correlations = [column for column in plottable_numeric if sample[column].nunique() > 1][:20]
    if len(correlations) >= 2:
        plt.figure(figsize=(max(8, len(correlations) * 0.55), 7))
        sns.heatmap(sample[correlations].corr(numeric_only=True), cmap="coolwarm", center=0)
        plt.title(f"{label}: numerical feature correlation (plot sample)")
        plt.tight_layout()
        plt.savefig(output_dir / "correlation_heatmap.png", dpi=130)
        plt.close()

    if plottable_numeric:
        box_features = plottable_numeric[:8]
        fig, axes = plt.subplots(1, len(box_features), figsize=(max(8, 2.4 * len(box_features)), 5))
        for axis, column in zip(np.atleast_1d(axes), box_features):
            sns.boxplot(y=sample[column].dropna(), ax=axis)
            axis.set_title(column, fontsize=8)
        fig.suptitle(f"{label}: numerical feature boxplots")
        fig.tight_layout()
        fig.savefig(output_dir / "numerical_boxplots.png", dpi=130)
        plt.close(fig)

    for target in target_columns:
        if target not in frame:
            continue
        if pd.api.types.is_numeric_dtype(frame[target]):
            values = pd.to_numeric(sample[target], errors="coerce").dropna()
            if not len(values):
                continue
            fig, axis = plt.subplots(figsize=(8, 5))
            sns.histplot(values, bins=35, ax=axis)
            axis.set(title=f"{label}: {target} distribution",
                     xlabel=f"{target} (source dataset units; currency unverified)")
            fig.tight_layout()
            fig.savefig(output_dir / f"target_{safe_name(target)}_histogram.png", dpi=130)
            plt.close(fig)
            fig, axis = plt.subplots(figsize=(6, 5))
            sns.boxplot(y=values, ax=axis)
            axis.set(title=f"{label}: {target} boxplot", ylabel="Source dataset units")
            fig.tight_layout()
            fig.savefig(output_dir / f"target_{safe_name(target)}_boxplot.png", dpi=130)
            plt.close(fig)
            predictors = {
                "cost": ["make_year", "mileage_range", "mileage"],
                "total cost": ["Mileage at Service"],
            }.get(target.casefold(), [])
            for predictor in predictors:
                if predictor not in sample or sample[predictor].nunique(dropna=True) < 2:
                    continue
                points = sample[[predictor, target]].apply(pd.to_numeric, errors="coerce").dropna()
                fig, axis = plt.subplots(figsize=(7, 5))
                sns.scatterplot(data=points, x=predictor, y=target, alpha=0.35, s=18, ax=axis)
                axis.set_title(f"{label}: {target} versus {predictor}")
                fig.tight_layout()
                fig.savefig(
                    output_dir / f"scatter_{safe_name(predictor)}_vs_{safe_name(target)}.png",
                    dpi=130,
                )
                plt.close(fig)
        else:
            counts = frame[target].astype("string").value_counts().head(15)
            fig, axis = plt.subplots(figsize=(9, 5))
            sns.barplot(x=counts.values, y=counts.index, ax=axis)
            axis.set(title=f"{label}: {target} distribution", xlabel="Records", ylabel=target)
            fig.tight_layout()
            fig.savefig(output_dir / f"target_{safe_name(target)}_categories.png", dpi=130)
            plt.close(fig)

    for column in categorical:
        if frame[column].nunique(dropna=True) <= 1:
            continue
        counts = frame[column].astype("string").value_counts().head(15)
        fig, axis = plt.subplots(figsize=(9, 5))
        sns.barplot(x=counts.values, y=counts.index, ax=axis)
        axis.set(title=f"{label}: most frequent {column}", xlabel="Records", ylabel=column)
        fig.tight_layout()
        plt.savefig(output_dir / f"category_{safe_name(column)}.png", dpi=130)
        plt.close(fig)

    summary["plots_directory"] = str(output_dir)
    print(f"EDA plots saved in {output_dir}")
    return summary
