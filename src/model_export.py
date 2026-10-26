"""Export the selected service-cost pipeline for the existing Node.js API."""

from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline


def export_tree_json(pipeline: Pipeline, metadata: dict) -> dict:
    """Represent fitted tree arrays and preprocessing, never as linear weights."""
    preprocessor: ColumnTransformer = pipeline.named_steps["preprocessor"]
    model = pipeline.named_steps["model"]
    numeric_pipe = preprocessor.named_transformers_.get("numeric")
    categorical_pipe = preprocessor.named_transformers_.get("categorical")

    numeric_features = []
    numeric_medians = []
    categorical_features = []
    categorical_fill_values = []
    categories = []
    if numeric_pipe is not None:
        numeric_features = list(numeric_pipe.feature_names_in_)
        numeric_medians = [
            float(value) for value in numeric_pipe.named_steps["imputer"].statistics_
        ]
    if categorical_pipe is not None:
        categorical_features = list(categorical_pipe.feature_names_in_)
        categorical_fill_values = [
            str(value) for value in categorical_pipe.named_steps["imputer"].statistics_
        ]
        categories = [
            [str(value) for value in feature_categories]
            for feature_categories in categorical_pipe.named_steps["onehot"].categories_
        ]

    estimators = list(model.estimators_) if hasattr(model, "estimators_") else [model]
    trees = []
    for estimator in estimators:
        tree = estimator.tree_
        trees.append({
            "children_left": tree.children_left.tolist(),
            "children_right": tree.children_right.tolist(),
            "feature": tree.feature.tolist(),
            "threshold": tree.threshold.tolist(),
            "value": tree.value[:, 0, 0].tolist(),
        })
    return {
        "format_version": 2,
        "model_type": type(model).__name__,
        "metadata": metadata,
        "preprocessing": {
            "numeric_features": numeric_features,
            "numeric_medians": numeric_medians,
            "categorical_features": categorical_features,
            "categorical_fill_values": categorical_fill_values,
            "categories": categories,
        },
        "trees": trees,
        "supported_vehicle_combinations": metadata.get("supported_vehicle_combinations", []),
    }
