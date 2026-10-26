"""Training-only model comparison, held-out metrics, and evaluation plots."""

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.base import clone
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from sklearn.model_selection import (
    KFold,
    StratifiedKFold,
    StratifiedShuffleSplit,
    cross_val_score,
)
from sklearn.pipeline import Pipeline
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

from .preprocessing import make_preprocessor


def build_candidates(
    task: dict,
    numeric_features: list[str],
    categorical_features: list[str],
    random_seed: int = 42,
) -> dict[str, Pipeline]:
    if task["kind"] == "regression":
        estimators = {
            "DecisionTree": DecisionTreeRegressor(
                max_depth=14, min_samples_split=5, min_samples_leaf=2,
                random_state=random_seed,
            ),
            "RandomForest": RandomForestRegressor(
                n_estimators=80, max_depth=16, min_samples_split=5,
                min_samples_leaf=2, n_jobs=-1, random_state=random_seed,
            ),
        }
    else:
        estimators = {
            "DecisionTree": DecisionTreeClassifier(
                max_depth=14, min_samples_split=5, min_samples_leaf=2,
                random_state=random_seed,
            ),
            "RandomForest": RandomForestClassifier(
                n_estimators=80, max_depth=16, min_samples_split=5,
                min_samples_leaf=2, n_jobs=-1, random_state=random_seed,
            ),
        }
    return {
        name: Pipeline([
            ("preprocessor", make_preprocessor(numeric_features, categorical_features)),
            ("model", estimator),
        ])
        for name, estimator in estimators.items()
    }


def _cv_sample(
    X: pd.DataFrame,
    y: pd.Series,
    task_kind: str,
    sample_size: int,
    random_seed: int,
) -> tuple[pd.DataFrame, pd.Series]:
    if not sample_size or len(X) <= sample_size:
        return X, y
    if task_kind == "classification":
        splitter = StratifiedShuffleSplit(
            n_splits=1, train_size=sample_size, random_state=random_seed
        )
        positions, _ = next(splitter.split(np.zeros(len(y)), y))
    else:
        positions = np.random.default_rng(random_seed).choice(
            len(y), size=sample_size, replace=False
        )
    return X.iloc[positions], y.iloc[positions]


def cross_validate_candidates(
    candidates: dict[str, Pipeline],
    X_train: pd.DataFrame,
    y_train: pd.Series,
    task: dict,
    folds: int = 3,
    sample_size: int = 100_000,
    random_seed: int = 42,
) -> tuple[dict[str, dict], str]:
    """Choose from Decision Tree/Random Forest using training data only."""
    X_cv, y_cv = _cv_sample(
        X_train, y_train, task["kind"], sample_size, random_seed
    )
    if len(X_cv) != len(X_train):
        print(
            f"CV uses a deterministic {len(X_cv):,}-row sample from the training split; "
            "the held-out test split is not used."
        )
    if task["kind"] == "classification":
        folds = min(folds, int(y_cv.value_counts().min()))
        splitter = (
            StratifiedKFold(n_splits=folds, shuffle=True, random_state=random_seed)
            if folds >= 2 else None
        )
        scoring = "f1_macro"
    else:
        folds = min(folds, len(X_cv))
        splitter = KFold(n_splits=folds, shuffle=True, random_state=random_seed) if folds >= 2 else None
        scoring = "neg_mean_absolute_error"
    if splitter is None:
        raise ValueError(
            f"Not enough training rows/classes for cross-validation of {task['name']}."
        )

    results = {}
    for name, pipeline in candidates.items():
        scores = cross_val_score(
            pipeline, X_cv, y_cv, cv=splitter, scoring=scoring, n_jobs=1,
            error_score="raise",
        )
        results[name] = {
            "scoring": scoring,
            "folds": int(folds),
            "rows_used": int(len(X_cv)),
            "training_data_only": True,
            "fold_scores": [float(value) for value in scores],
            "mean_score": float(np.mean(scores)),
            "standard_deviation": float(np.std(scores)),
        }
        print(
            f"{name} training CV: {scoring} mean={np.mean(scores):.5f}, "
            f"std={np.std(scores):.5f}"
        )
    selected = max(results, key=lambda name: results[name]["mean_score"])
    print(f"Selected by training CV: {selected}")
    return results, selected


def regression_metrics(actual: pd.Series, predicted: np.ndarray) -> dict[str, float]:
    mse = mean_squared_error(actual, predicted)
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "mse": float(mse),
        "rmse": float(math.sqrt(mse)),
        "r2": float(r2_score(actual, predicted)),
    }


def classification_metrics(actual: pd.Series, predicted: np.ndarray) -> dict[str, float]:
    return {
        "accuracy": float(accuracy_score(actual, predicted)),
        "precision_macro": float(precision_score(actual, predicted, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(actual, predicted, average="macro", zero_division=0)),
        "macro_f1": float(f1_score(actual, predicted, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(actual, predicted, average="weighted", zero_division=0)),
    }


def fit_and_evaluate(
    candidates: dict[str, Pipeline],
    selected_name: str,
    X_train: pd.DataFrame,
    X_test: pd.DataFrame,
    y_train: pd.Series,
    y_test: pd.Series,
    task: dict,
    random_seed: int = 42,
) -> dict:
    """Fit final candidates on all training data and evaluate once on test data."""
    comparisons = {}
    predictions = {}
    for name, pipeline in candidates.items():
        print(f"Fitting {name} on {len(X_train):,} training rows.")
        pipeline.fit(X_train, y_train)
        prediction = pipeline.predict(X_test)
        predictions[name] = prediction
        comparisons[name] = (
            regression_metrics(y_test, prediction)
            if task["kind"] == "regression"
            else classification_metrics(y_test, prediction)
        )
        print(f"{name} held-out metrics: {comparisons[name]}")

    baseline_metrics = None
    baseline_report = None
    if task["kind"] == "classification":
        # Majority-class prediction is a useful reference, not a candidate model.
        baseline = Pipeline([
            ("preprocessor", clone(candidates[selected_name].named_steps["preprocessor"])),
            ("model", DummyClassifier(strategy="most_frequent", random_state=random_seed)),
        ])
        baseline.fit(X_train, y_train)
        baseline_prediction = baseline.predict(X_test)
        baseline_metrics = classification_metrics(y_test, baseline_prediction)
        baseline_report = classification_report(y_test, baseline_prediction, zero_division=0)
        comparisons["MajorityBaseline"] = baseline_metrics
        predictions["MajorityBaseline"] = baseline_prediction
        print("Majority-class baseline held-out metrics:", baseline_metrics)

    selected_pipeline = candidates[selected_name]
    selected_prediction = predictions[selected_name]
    classes = None
    report = None
    if task["kind"] == "classification":
        classes = [str(value) for value in selected_pipeline.named_steps["model"].classes_]
        report = classification_report(
            y_test, selected_prediction, labels=classes, zero_division=0
        )
    return {
        "candidates": candidates,
        "comparison": comparisons,
        "predictions": predictions,
        "selected_name": selected_name,
        "selected_pipeline": selected_pipeline,
        "selected_prediction": selected_prediction,
        "classes": classes,
        "classification_report": report,
        "baseline_report": baseline_report,
    }


def _plot_feature_importance(pipeline: Pipeline, path: Path) -> None:
    model = pipeline.named_steps["model"]
    importance = getattr(model, "feature_importances_", None)
    if importance is None:
        return
    names = pipeline.named_steps["preprocessor"].get_feature_names_out()
    if len(names) != len(importance) or not len(names):
        return
    selected = np.argsort(importance)[-20:]
    fig, axis = plt.subplots(figsize=(10, max(5, len(selected) * 0.32)))
    axis.barh(names[selected], importance[selected])
    axis.set_title("Tree feature importance (model reliance, not causation)")
    axis.set_xlabel("Importance")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def make_evaluation_plots(
    task: dict,
    actual: pd.Series,
    result: dict,
    plot_dir: Path,
) -> None:
    plot_dir.mkdir(parents=True, exist_ok=True)
    comparison = result["comparison"]
    selected_name = result["selected_name"]
    selected_prediction = result["selected_prediction"]
    if task["kind"] == "regression":
        residual = np.asarray(actual, dtype=float) - selected_prediction
        fig, axis = plt.subplots(figsize=(7, 6))
        axis.scatter(actual, selected_prediction, alpha=0.4, s=14)
        low = min(float(np.min(actual)), float(np.min(selected_prediction)))
        high = max(float(np.max(actual)), float(np.max(selected_prediction)))
        axis.plot([low, high], [low, high], "--", color="red")
        axis.set(title=f"{task['name']}: actual vs predicted",
                 xlabel="Actual target (source units)", ylabel="Predicted target (source units)")
        fig.tight_layout()
        fig.savefig(plot_dir / "actual_vs_predicted.png", dpi=130)
        plt.close(fig)

        fig, axis = plt.subplots(figsize=(7, 5))
        axis.scatter(selected_prediction, residual, alpha=0.4, s=14)
        axis.axhline(0, color="red", linestyle="--")
        axis.set(title=f"{task['name']}: residuals",
                 xlabel="Predicted target (source units)", ylabel="Actual - predicted")
        fig.tight_layout()
        fig.savefig(plot_dir / "residuals.png", dpi=130)
        plt.close(fig)

        fig, axis = plt.subplots(figsize=(7, 5))
        sns.histplot(residual, bins=35, ax=axis)
        axis.set(title=f"{task['name']}: residual distribution", xlabel="Residual (source units)")
        fig.tight_layout()
        fig.savefig(plot_dir / "residual_distribution.png", dpi=130)
        plt.close(fig)

        regression_models = [name for name in comparison if name != "MajorityBaseline"]
        positions = np.arange(len(regression_models))
        width = 0.36
        fig, axis = plt.subplots(figsize=(8, 5))
        axis.bar(positions - width / 2,
                 [comparison[name]["mae"] for name in regression_models],
                 width, label="MAE")
        axis.bar(positions + width / 2,
                 [comparison[name]["rmse"] for name in regression_models],
                 width, label="RMSE")
        axis.set_xticks(positions, regression_models)
        axis.set_ylabel("Error (source units)")
        axis.set_title(f"{task['name']}: held-out comparison; selected by training CV")
        axis.legend()
        fig.tight_layout()
        fig.savefig(plot_dir / "model_comparison.png", dpi=130)
        plt.close(fig)
    else:
        classes = result["classes"]
        matrix = confusion_matrix(actual, selected_prediction, labels=classes)
        fig, axis = plt.subplots(figsize=(9, 7))
        sns.heatmap(matrix, annot=True, fmt="d", cmap="Blues",
                    xticklabels=classes, yticklabels=classes, ax=axis)
        axis.set(title=f"{task['name']}: selected classifier confusion matrix",
                 xlabel="Predicted", ylabel="Actual")
        fig.tight_layout()
        fig.savefig(plot_dir / "confusion_matrix.png", dpi=130)
        plt.close(fig)

        model_names = ["DecisionTree", "RandomForest", "MajorityBaseline"]
        metrics = ["accuracy", "macro_f1", "weighted_f1"]
        positions = np.arange(len(model_names))
        width = 0.24
        fig, axis = plt.subplots(figsize=(9, 5))
        for index, metric in enumerate(metrics):
            axis.bar(
                positions + (index - 1) * width,
                [comparison[name][metric] for name in model_names],
                width, label=metric.replace("_", " ").title(),
            )
        axis.set_xticks(positions, model_names)
        axis.set_ylim(0, 1)
        axis.set_title(f"{task['name']}: model and majority-baseline comparison")
        axis.legend()
        fig.tight_layout()
        fig.savefig(plot_dir / "model_comparison.png", dpi=130)
        plt.close(fig)
    _plot_feature_importance(result["selected_pipeline"], plot_dir / "feature_importance.png")
