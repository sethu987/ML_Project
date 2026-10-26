"""Dataset schemas and paths shared by the training code and tutorial."""

from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
DOWNLOADS_DIR = Path.home() / "Downloads"
DEFAULT_SERVICE_CSV = DOWNLOADS_DIR / "Vehicle Maintenance- Service Records.csv"
DEFAULT_REPAIR_CSV = DOWNLOADS_DIR / "enhanced_motor_vehicle_repair_towing_dataset.csv"
DEFAULT_MODEL_DIR = PROJECT_DIR / "models" / "production_v2"
DEFAULT_PLOT_DIR = PROJECT_DIR / "plots" / "production_v2"
DEFAULT_REPORT_DIR = PROJECT_DIR / "reports" / "production_v2"
RANDOM_SEED = 42

SERVICE_FEATURES = [
    "vehicle_type", "brand", "model", "engine_type", "make_year", "region",
    "mileage_range", "mileage", "oil_filter", "engine_oil", "washer_plug_drain",
    "dust_and_pollen_filter", "whell_alignment_and_balancing", "air_clean_filter",
    "fuel_filter", "spark_plug", "brake_fluid", "brake_and_clutch_oil",
    "transmission_fluid", "brake_pads", "clutch", "coolant",
]
SERVICE_NUMERIC_FEATURES = [
    "make_year", "mileage_range", "mileage", "oil_filter", "engine_oil",
    "washer_plug_drain", "dust_and_pollen_filter", "whell_alignment_and_balancing",
    "air_clean_filter", "fuel_filter", "spark_plug", "brake_fluid",
    "brake_and_clutch_oil", "transmission_fluid", "brake_pads", "clutch", "coolant",
]
SERVICE_CATEGORICAL_FEATURES = [
    "vehicle_type", "brand", "model", "engine_type", "region",
]

REPAIR_COST_FEATURES = [
    "Vehicle Type", "Make and Model", "Service Type", "Urgency Level",
    "Customer Type", "Insurance Claim Used", "Is Warranty Valid",
    "Mileage at Service",
]
REPAIR_CATEGORY_FEATURES = [
    "Vehicle Type", "Make and Model", "Urgency Level", "Customer Type",
    "Insurance Claim Used", "Is Warranty Valid", "Mileage at Service",
]
REPAIR_NUMERIC_FEATURES = ["Mileage at Service"]
REPAIR_COST_CATEGORICAL_FEATURES = [
    "Vehicle Type", "Make and Model", "Service Type", "Urgency Level",
    "Customer Type", "Insurance Claim Used", "Is Warranty Valid",
]
REPAIR_CATEGORY_CATEGORICAL_FEATURES = [
    "Vehicle Type", "Make and Model", "Urgency Level", "Customer Type",
    "Insurance Claim Used", "Is Warranty Valid",
]

TASKS = {
    "service": {
        "name": "vehicle_service_cost",
        "target": "cost",
        "kind": "regression",
        "features": SERVICE_FEATURES,
        "numeric": SERVICE_NUMERIC_FEATURES,
        "categorical": SERVICE_CATEGORICAL_FEATURES,
        "source_name": "Vehicle Maintenance- Service Records.csv",
        "model_file": "vehicle_service_cost_model.joblib",
        "units": "Source dataset units; currency is not stated in the CSV.",
        "feature_selection_notes": (
            "Use vehicle, engine, mileage, region, and planned service-item inputs; "
            "exclude slno because it is a record identifier."
        ),
    },
    "repair": {
        "name": "repair_cost",
        "target": "Total Cost",
        "kind": "regression",
        "features": REPAIR_COST_FEATURES,
        "numeric": REPAIR_NUMERIC_FEATURES,
        "categorical": REPAIR_COST_CATEGORICAL_FEATURES,
        "source_name": "enhanced_motor_vehicle_repair_towing_dataset.csv",
        "model_file": "repair_cost_model.joblib",
        "units": "Source dataset units; currency is not stated in the CSV.",
        "feature_selection_notes": (
            "Use vehicle, service type, urgency, customer/insurance/warranty context, "
            "and mileage available at request time. Exclude identifiers, Estimated Cost "
            "as a target proxy, and fields describing completed work."
        ),
    },
    "category": {
        "name": "maintenance_category",
        "target": "Service Type",
        "kind": "classification",
        "features": REPAIR_CATEGORY_FEATURES,
        "numeric": REPAIR_NUMERIC_FEATURES,
        "categorical": REPAIR_CATEGORY_CATEGORICAL_FEATURES,
        "source_name": "enhanced_motor_vehicle_repair_towing_dataset.csv",
        "model_file": "maintenance_category_model.joblib",
        "units": None,
        "feature_selection_notes": (
            "Exclude Service Type as the target and exclude identifiers, cost fields, "
            "and post-service descriptions, parts, status, duration, ratings, and feedback."
        ),
    },
}
