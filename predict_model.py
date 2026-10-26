"""Load a saved AutoCare scikit-learn pipeline and predict from a JSON record.

Example:
    python predict_model.py --model models/vehicle_service_cost_model.joblib \
        --input reports/evaluation/vehicle_service_cost_example_input.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import joblib
import pandas as pd
from sklearn.pipeline import Pipeline


PROJECT_DIR = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Predict with a complete saved AutoCare scikit-learn pipeline."
    )
    parser.add_argument("--model", required=True, type=Path, help="Path to a saved .joblib pipeline.")
    parser.add_argument("--input", required=True, type=Path, help="JSON file containing one feature record.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    model_path = args.model if args.model.is_absolute() else PROJECT_DIR / args.model
    input_path = args.input if args.input.is_absolute() else PROJECT_DIR / args.input
    if not model_path.is_file():
        print(f"Model file not found: {model_path}", file=sys.stderr)
        return 1
    if not input_path.is_file():
        print(f"Input JSON file not found: {input_path}", file=sys.stderr)
        return 1
    try:
        payload = json.loads(input_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"Could not read prediction input '{input_path}': {error}", file=sys.stderr)
        return 1
    if not isinstance(payload, dict):
        print("Prediction input must be a JSON object with feature-name keys.", file=sys.stderr)
        return 1

    model = joblib.load(model_path)
    if not isinstance(model, Pipeline) or not hasattr(model, "feature_names_in_"):
        print(f"Saved artifact is not a fitted scikit-learn Pipeline: {model_path}", file=sys.stderr)
        return 1
    feature_names = list(model.feature_names_in_)
    unexpected = sorted(set(payload) - set(feature_names))
    if unexpected:
        print(f"Ignoring unexpected input feature(s): {unexpected}")
    record = {name: payload.get(name) for name in feature_names}
    prediction = model.predict(pd.DataFrame([record], columns=feature_names))[0]
    if hasattr(prediction, "item"):
        prediction = prediction.item()
    if isinstance(prediction, float) and not pd.notna(prediction):
        print("The model returned a non-finite prediction.", file=sys.stderr)
        return 1
    print(json.dumps({"prediction": prediction}, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
