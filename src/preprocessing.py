"""Feature selection, data cleaning, splitting, and leakage-safe preprocessing."""

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


def select_features(frame: pd.DataFrame, task: dict) -> tuple[list[str], list[str], list[str]]:
    target = task["target"]
    if target not in frame.columns:
        raise ValueError(
            f"Task '{task['name']}' requires target column {target!r}, which is absent."
        )
    missing = [column for column in task["features"] if column not in frame.columns]
    if missing:
        raise ValueError(f"Task '{task['name']}' is missing input columns: {missing}")
    numeric = list(task["numeric"])
    categorical = list(task["categorical"])
    features = list(task["features"])
    print(f"\n{task['name']} target: {target}")
    print("Selected features:", features)
    print("Excluded columns:", [
        column for column in frame.columns if column not in features and column != target
    ])
    print("Feature-selection rationale:", task["feature_selection_notes"])
    return features, numeric, categorical


def prepare_xy(
    frame: pd.DataFrame,
    task: dict,
    features: list[str],
    numeric_features: list[str],
) -> tuple[pd.DataFrame, pd.Series]:
    """Coerce numeric fields and remove only rows with invalid targets."""
    selected = frame[features + [task["target"]]].copy()
    for column in numeric_features:
        selected[column] = pd.to_numeric(selected[column], errors="coerce")

    if task["kind"] == "regression":
        target = pd.to_numeric(selected[task["target"]], errors="coerce")
        valid = target.notna() & np.isfinite(target) & target.ge(0)
    else:
        target = selected[task["target"]].astype("string").str.strip()
        valid = target.notna() & target.ne("")
        target = target.astype(object)

    dropped = int((~valid).sum())
    print(f"Rows excluded for invalid/missing target: {dropped:,}")
    selected = selected.loc[valid]
    target = target.loc[valid]
    if len(target) < 2:
        raise ValueError(f"Task '{task['name']}' has fewer than two usable target rows.")
    if task["kind"] == "classification" and target.nunique() < 2:
        raise ValueError(f"Task '{task['name']}' requires at least two target classes.")

    X = selected[features].copy()
    for column in X.columns:
        if column in numeric_features:
            X[column] = X[column].replace([np.inf, -np.inf], np.nan)
        elif isinstance(X[column].dtype, pd.CategoricalDtype):
            empty = [value for value in X[column].cat.categories if not str(value).strip()]
            if empty:
                X[column] = X[column].cat.remove_categories(empty)
        else:
            values = X[column].astype("string").str.strip()
            X[column] = values.mask(values.eq(""), pd.NA).astype(object)
    return X, target


def split_dataset(
    X: pd.DataFrame,
    y: pd.Series,
    kind: str,
    random_seed: int = 42,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series, str | None]:
    """Split before fitting any imputer or encoder; stratify when feasible."""
    stratify = None
    note = None
    if kind == "classification":
        counts = y.value_counts()
        test_rows = int(np.ceil(len(y) * 0.2))
        train_rows = len(y) - test_rows
        if counts.min() >= 2 and test_rows >= len(counts) and train_rows >= len(counts):
            stratify = y
        else:
            note = "Class counts were too small to stratify; used a random split."

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=random_seed, stratify=stratify
    )
    print(
        f"Original usable rows: {len(X):,}; training: {len(X_train):,}; "
        f"testing: {len(X_test):,}"
    )
    if note:
        print(note)
    if kind == "classification":
        print("Class distribution before split:\n", y.value_counts().to_string())
        print("Training class distribution:\n", y_train.value_counts().to_string())
        print("Test class distribution:\n", y_test.value_counts().to_string())
    return X_train, X_test, y_train, y_test, note


def make_preprocessor(
    numeric_features: list[str],
    categorical_features: list[str],
) -> ColumnTransformer:
    """Impute missing data and one-hot encode categories inside the model pipeline."""
    transformers = []
    if numeric_features:
        numeric = Pipeline([("imputer", SimpleImputer(strategy="median"))])
        transformers.append(("numeric", numeric, numeric_features))
    if categorical_features:
        categorical = Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ])
        transformers.append(("categorical", categorical, categorical_features))
    return ColumnTransformer(transformers, remainder="drop")
