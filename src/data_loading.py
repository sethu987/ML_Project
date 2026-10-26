"""Safe CSV loading for both AutoCare source datasets."""

from pathlib import Path

import pandas as pd


def load_csv(csv_path: Path, label: str) -> pd.DataFrame:
    """Read a CSV, storing repeated text values categorically to save RAM."""
    print(f"\nLoading {label}: {csv_path}")
    if not csv_path.is_file():
        raise FileNotFoundError(
            f"Required CSV was not found: {csv_path}. "
            "Put it in Downloads or pass its path on the command line."
        )
    try:
        sample = pd.read_csv(csv_path, nrows=5_000, low_memory=False)
        text_columns = sample.select_dtypes(include=["object", "string"]).columns
        dtype_map = {column: "category" for column in text_columns}
        frame = pd.read_csv(csv_path, low_memory=False, dtype=dtype_map)
    except (OSError, UnicodeError, pd.errors.ParserError, ValueError) as error:
        raise ValueError(f"Could not read '{csv_path}': {error}") from error
    if frame.empty:
        raise ValueError(f"CSV contains no data rows: {csv_path}")

    print(f"Shape: {frame.shape[0]:,} rows x {frame.shape[1]} columns")
    print("First five rows:\n", frame.head().to_string(index=False))
    print("Last five rows:\n", frame.tail().to_string(index=False))
    print("Columns:", frame.columns.tolist())
    print("Data types:\n", frame.dtypes.to_string())
    print("Descriptive statistics:\n", frame.describe(include="all").transpose().to_string())
    return frame
