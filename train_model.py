"""Command-line entry point for the modular AutoCare ML training pipeline."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from src.config import (
    DEFAULT_MODEL_DIR,
    DEFAULT_PLOT_DIR,
    DEFAULT_REPAIR_CSV,
    DEFAULT_REPORT_DIR,
    DEFAULT_SERVICE_CSV,
)
from src.train_models import train_all


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Explore data, compare tree models, and save AutoCare pipelines."
    )
    parser.add_argument(
        "--dataset",
        choices=("all", "service", "repair", "category"),
        default="all",
        help="Train all tasks (default), or choose service, repair, or category.",
    )
    parser.add_argument("--service-csv", type=Path, default=DEFAULT_SERVICE_CSV)
    parser.add_argument("--repair-csv", type=Path, default=DEFAULT_REPAIR_CSV)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--plot-dir", type=Path, default=DEFAULT_PLOT_DIR)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--cv-folds", type=int, default=3)
    parser.add_argument(
        "--cv-sample-size",
        type=int,
        default=100_000,
        help="Maximum training rows for CV on large data; 0 uses all training rows.",
    )
    parser.add_argument(
        "--eda-sample-size",
        type=int,
        default=20_000,
        help="Maximum rows sampled for plots only; all rows remain in model evaluation.",
    )
    args = parser.parse_args()
    if args.cv_folds < 2:
        parser.error("--cv-folds must be at least 2.")
    if args.cv_sample_size < 0 or args.eda_sample_size < 1:
        parser.error("--cv-sample-size must be nonnegative and --eda-sample-size positive.")
    return args


def main() -> int:
    args = parse_args()
    try:
        train_all(
            service_csv=args.service_csv,
            repair_csv=args.repair_csv,
            model_dir=args.model_dir,
            plot_dir=args.plot_dir,
            report_dir=args.report_dir,
            dataset=args.dataset,
            cv_folds=args.cv_folds,
            cv_sample_size=args.cv_sample_size,
            eda_sample_size=args.eda_sample_size,
        )
    except (FileNotFoundError, OSError, ValueError, RuntimeError) as error:
        print(f"Training stopped: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
