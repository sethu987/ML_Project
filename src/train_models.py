"""End-to-end training orchestration and auditable report generation."""

import gc
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import classification_report
from sklearn.pipeline import Pipeline

from .config import (
    DEFAULT_MODEL_DIR,
    DEFAULT_PLOT_DIR,
    DEFAULT_REPAIR_CSV,
    DEFAULT_REPORT_DIR,
    DEFAULT_SERVICE_CSV,
    RANDOM_SEED,
    TASKS,
)
from .data_loading import load_csv
from .eda import analyze_dataset
from .evaluate_models import (
    build_candidates,
    cross_validate_candidates,
    fit_and_evaluate,
    make_evaluation_plots,
)
from .model_export import export_tree_json
from .preprocessing import prepare_xy, select_features, split_dataset


def json_safe(value):
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if pd.isna(value):
        return None
    return value


def save_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(json_safe(value), indent=2, ensure_ascii=False, allow_nan=False),
        encoding="utf-8",
    )


def verify_saved_model(
    task: dict,
    model_path: Path,
    X_test: pd.DataFrame,
    classes: list[str] | None,
) -> None:
    loaded = joblib.load(model_path)
    if not isinstance(loaded, Pipeline) or "preprocessor" not in loaded.named_steps:
        raise RuntimeError(f"Artifact is not a complete scikit-learn Pipeline: {model_path}")
    predictions = loaded.predict(X_test.iloc[: min(5, len(X_test))])
    if task["kind"] == "regression":
        if not np.isfinite(np.asarray(predictions, dtype=float)).all():
            raise RuntimeError(f"Non-finite sample prediction from {model_path}")
    elif not set(map(str, predictions)).issubset(set(classes or [])):
        raise RuntimeError(f"Classifier returned a class outside its learned classes: {model_path}")

    sample = X_test.iloc[:1].copy().astype(object)
    missing = sample.copy()
    for column in missing.columns:
        missing.loc[:, column] = np.nan
    unseen = sample.copy()
    for column in unseen.columns:
        if column not in task["numeric"]:
            unseen.loc[:, column] = "__unseen_category__"
    edge_predictions = loaded.predict(pd.concat([missing, unseen], ignore_index=True))
    if task["kind"] == "regression":
        if not np.isfinite(np.asarray(edge_predictions, dtype=float)).all():
            raise RuntimeError(f"Missing/unseen-value predictions failed for {model_path}")
    elif not set(map(str, edge_predictions)).issubset(set(classes or [])):
        raise RuntimeError(f"Missing/unseen-value predictions failed for {model_path}")
    print(f"Reloaded model and input-edge checks passed: {model_path}")


def train_task(
    frame: pd.DataFrame,
    task_key: str,
    model_dir: Path,
    plot_dir: Path,
    report_dir: Path,
    cv_folds: int,
    cv_sample_size: int,
) -> dict:
    task = TASKS[task_key]
    features, numeric, categorical = select_features(frame, task)
    X, y = prepare_xy(frame, task, features, numeric)
    X_train, X_test, y_train, y_test, split_note = split_dataset(
        X, y, task["kind"], RANDOM_SEED
    )
    candidates = build_candidates(task, numeric, categorical, RANDOM_SEED)
    cv_results, selected_name = cross_validate_candidates(
        candidates, X_train, y_train, task, cv_folds, cv_sample_size, RANDOM_SEED
    )
    fitted = fit_and_evaluate(
        candidates, selected_name, X_train, X_test, y_train, y_test, task, RANDOM_SEED
    )
    task_plot_dir = plot_dir / task["name"]
    make_evaluation_plots(task, y_test, fitted, task_plot_dir)

    selected_pipeline = fitted["selected_pipeline"]
    selected_model = selected_pipeline.named_steps["model"]
    supported_combinations = []
    if task_key == "service":
        combos = X_train[["brand", "model", "engine_type"]].drop_duplicates()
        supported_combinations = [
            [str(value).strip().casefold() for value in row]
            for row in combos.itertuples(index=False, name=None)
            if all(pd.notna(value) for value in row)
        ]

    classification_reports = {}
    if task["kind"] == "classification":
        for name in ("DecisionTree", "RandomForest", "MajorityBaseline"):
            classification_reports[name] = classification_report(
                y_test,
                fitted["predictions"][name],
                zero_division=0,
                output_dict=True,
            )

    metadata = {
        "model_name": task["name"],
        "selected_estimator": selected_name,
        "model_type": type(selected_model).__name__,
        "source_dataset": task["source_name"],
        "target_column": task["target"],
        "cost_units": task["units"],
        "input_features": features,
        "numeric_features": numeric,
        "categorical_features": categorical,
        "feature_selection_notes": task["feature_selection_notes"],
        "excluded_features": [
            column for column in frame.columns
            if column not in features and column != task["target"]
        ],
        "training_samples": int(len(X_train)),
        "testing_samples": int(len(X_test)),
        "usable_samples": int(len(X)),
        "random_seed": RANDOM_SEED,
        "training_date_utc": datetime.now(timezone.utc).isoformat(),
        "selected_hyperparameters": selected_model.get_params(deep=True),
        "cross_validation": cv_results,
        "test_metrics_by_model": fitted["comparison"],
        "selected_test_metrics": fitted["comparison"][selected_name],
        "classification_report": fitted["classification_report"],
        "classification_reports_by_model": classification_reports,
        "majority_baseline_metrics": fitted["comparison"].get("MajorityBaseline"),
        "class_names": fitted["classes"],
        "split_note": split_note,
        "cost_unit_limitation": (
            "The CSV does not document currency; results remain in source dataset units."
            if task["units"] else None
        ),
        "limitations": [
            "Random holdout may share vehicle or customer characteristics across partitions.",
            "Tree feature importance indicates model reliance, not causation.",
            "Cost currency is not documented in either source dataset.",
            "Repair Service Status is overwhelmingly 's' with one 'In Progress' row; verify source encoding.",
        ],
        "supported_vehicle_combinations": supported_combinations,
    }

    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / task["model_file"]
    joblib.dump(selected_pipeline, model_path)
    verify_saved_model(task, model_path, X_test, fitted["classes"])

    if task_key == "service":
        export = export_tree_json(selected_pipeline, metadata)
        save_json(model_dir / "vehicle_service_cost.json", export)

    evaluation_dir = report_dir / "evaluation"
    metrics_path = evaluation_dir / f"{task['name']}_metrics.json"
    metrics = {
        "model_name": task["name"],
        "selected_estimator": selected_name,
        "cross_validation": cv_results,
        "test_metrics_by_model": fitted["comparison"],
        "selected_test_metrics": fitted["comparison"][selected_name],
        "classification_reports_by_model": classification_reports,
    }
    save_json(metrics_path, metrics)
    metadata_path = evaluation_dir / f"{task['name']}_metadata.json"
    save_json(metadata_path, metadata)
    example_path = evaluation_dir / f"{task['name']}_example_input.json"
    save_json(example_path, X_test.iloc[0].to_dict())
    if fitted["classification_report"]:
        (evaluation_dir / f"{task['name']}_classification_report.txt").write_text(
            fitted["classification_report"], encoding="utf-8"
        )

    return {
        "metadata": metadata,
        "comparison": fitted["comparison"],
        "cv": cv_results,
        "selected_name": selected_name,
        "model_path": model_path,
        "metrics_path": metrics_path,
        "metadata_path": metadata_path,
        "example_path": example_path,
        "plot_dir": task_plot_dir,
        "classification_report": fitted["classification_report"],
    }


def build_training_report(
    output_path: Path,
    summaries: dict[str, dict],
    results: dict[str, dict],
) -> None:
    lines = [
        "# AutoCare Model Training Report",
        "",
        f"Generated (UTC): {datetime.now(timezone.utc).isoformat()}",
        "",
        "All cost values remain in their source units; neither CSV documents a currency.",
        "Exact duplicate records are counted and retained because repeated service visits may be valid.",
        "IQR outliers are flagged for review and are not automatically discarded.",
    ]
    for label, summary in summaries.items():
        lines.extend([
            "",
            f"## {label}",
            "",
            f"- Full dataset shape: {summary['rows']:,} rows x {summary['columns']} columns",
            f"- Numerical columns: {', '.join(summary['numeric_columns']) or 'none'}",
            f"- Categorical columns: {', '.join(summary['categorical_columns']) or 'none'}",
            f"- Exact duplicate rows: {summary['exact_duplicate_rows']:,}",
            f"- Missing columns: {summary['missing_values']}",
            f"- Potential outliers: {summary['potential_outliers']}",
            f"- Category quality flags: {summary['category_quality_flags']}",
            f"- EDA plots: `{summary['plots_directory']}`",
            "- Plots use a fixed-seed sample; dataset inspection and final model evaluation use all usable rows.",
            f"- Target distributions: {summary['target_summaries']}",
        ])

    for name, result in results.items():
        metadata = result["metadata"]
        lines.extend([
            "",
            f"## Task: {name}",
            "",
            f"- Source: `{metadata['source_dataset']}`",
            f"- Target: `{metadata['target_column']}`",
            f"- Input features: {metadata['input_features']}",
            f"- Excluded fields: {metadata['excluded_features']}",
            f"- Feature-selection rationale: {metadata['feature_selection_notes']}",
            "- Preprocessing: median numerical imputation; most-frequent categorical imputation; one-hot encoding with unknown-category tolerance. All transformations are fitted inside each training fold.",
            f"- Split: {metadata['training_samples']:,} train / {metadata['testing_samples']:,} held-out test; seed={RANDOM_SEED}.",
            f"- Selected using training-only CV: **{result['selected_name']}**.",
            f"- CV results: {result['cv']}",
            f"- Test comparison: {result['comparison']}",
            f"- Model artifact: `{result['model_path']}`",
            f"- Metrics: `{result['metrics_path']}`",
            f"- Metadata: `{result['metadata_path']}`",
            f"- Evaluation plots: `{result['plot_dir']}`",
        ])
        if metadata["cost_units"]:
            lines.extend([
                "",
                "MAE is mean absolute error; MSE squares errors; RMSE is in source units; R² compares performance with a mean-prediction baseline. A high R² alone does not show practical accuracy.",
            ])
        if metadata.get("majority_baseline_metrics"):
            lines.append(
                f"- Majority-class baseline test metrics: {metadata['majority_baseline_metrics']}"
            )
        if result["classification_report"]:
            lines.extend(["", "Selected classifier report:", "", "```text",
                          result["classification_report"], "```"])
        for plot in sorted(result["plot_dir"].glob("*.png")):
            lines.append(f"- Plot: `{plot}`")
        lines.extend(["", f"Known limitations: {metadata['limitations']}"])

    lines.extend([
        "",
        "## Prediction example",
        "",
        "```powershell",
        ".\\.venv\\Scripts\\python.exe predict_model.py --model models\\production_v2\\vehicle_service_cost_model.joblib --input reports\\production_v2\\evaluation\\vehicle_service_cost_example_input.json",
        "```",
        "",
        "The Node application reads `models/production_v2/vehicle_service_cost.json`, which contains the selected tree model and fitted preprocessing, not linear coefficients.",
        "",
    ])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


def train_all(
    service_csv: Path = DEFAULT_SERVICE_CSV,
    repair_csv: Path = DEFAULT_REPAIR_CSV,
    model_dir: Path = DEFAULT_MODEL_DIR,
    plot_dir: Path = DEFAULT_PLOT_DIR,
    report_dir: Path = DEFAULT_REPORT_DIR,
    dataset: str = "all",
    cv_folds: int = 3,
    cv_sample_size: int = 100_000,
    eda_sample_size: int = 20_000,
) -> dict:
    """Run requested task(s), leaving legacy models and reports untouched."""
    for directory in (model_dir, plot_dir, report_dir / "eda", report_dir / "evaluation"):
        directory.mkdir(parents=True, exist_ok=True)
    requested = (
        ["service", "repair", "category"] if dataset == "all"
        else ["repair", "category"] if dataset == "repair"
        else [dataset]
    )
    summaries = {}
    results = {}
    if "service" in requested:
        service_frame = load_csv(service_csv, "vehicle maintenance dataset")
        service_summary = analyze_dataset(
            service_frame, "Vehicle maintenance", plot_dir / "eda" / "vehicle_service",
            ["cost"], eda_sample_size,
        )
        save_json(report_dir / "eda" / "vehicle_service_summary.json", service_summary)
        summaries["Vehicle maintenance"] = service_summary
        results["vehicle_service_cost"] = train_task(
            service_frame, "service", model_dir, plot_dir, report_dir,
            cv_folds, cv_sample_size,
        )
        del service_frame
        gc.collect()

    if "repair" in requested or "category" in requested:
        repair_frame = load_csv(repair_csv, "repair and towing dataset")
        repair_summary = analyze_dataset(
            repair_frame, "Repair and towing", plot_dir / "eda" / "repair_towing",
            ["Total Cost", "Service Type"], eda_sample_size,
        )
        save_json(report_dir / "eda" / "repair_towing_summary.json", repair_summary)
        summaries["Repair and towing"] = repair_summary
        if "repair" in requested:
            results["repair_cost"] = train_task(
                repair_frame, "repair", model_dir, plot_dir, report_dir,
                cv_folds, cv_sample_size,
            )
        if "category" in requested:
            results["maintenance_category"] = train_task(
                repair_frame, "category", model_dir, plot_dir, report_dir,
                cv_folds, cv_sample_size,
            )
        del repair_frame
        gc.collect()

    save_json(model_dir / "metrics.json", {
        name: result["comparison"] for name, result in results.items()
    })
    save_json(model_dir / "metadata.json", {
        name: result["metadata"] for name, result in results.items()
    })
    build_training_report(report_dir / "training_report.md", summaries, results)
    print(f"\nTraining report: {report_dir / 'training_report.md'}")
    print(f"Metrics: {model_dir / 'metrics.json'}")
    print(f"Metadata: {model_dir / 'metadata.json'}")
    return results
