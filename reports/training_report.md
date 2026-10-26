# AutoCare Model Training Report

Generated (UTC): 2026-10-26T12:17:44.088992+00:00

## Dataset findings

Cost values are kept in their source numeric units. Neither CSV identifies a currency.
Exact duplicate rows were counted but retained because repeated service visits can be valid.
Potential IQR outliers are flagged for review and are not automatically removed.

### Vehicle maintenance

- Shape: 1,139 rows x 24 columns
- Numeric columns: slno, make_year, mileage_range, mileage, oil_filter, engine_oil, washer_plug_drain, dust_and_pollen_filter, whell_alignment_and_balancing, air_clean_filter, fuel_filter, spark_plug, brake_fluid, brake_and_clutch_oil, transmission_fluid, brake_pads, clutch, coolant, cost
- Categorical columns: vehicle_type, brand, model, engine_type, region
- Exact duplicate rows: 0
- Columns with missing values: 0
- Potential outlier columns: mileage, washer_plug_drain, spark_plug, brake_fluid, brake_and_clutch_oil, transmission_fluid, brake_pads, clutch, coolant, cost
- EDA plots: `D:\ML_Project\plots\vehicle_service`

Observed target distributions:
- `cost`: count=1,139, missing=0, min=1099.0, median=5199.0, max=14000.0
- `vehicle_type` top categories: car=1,139
- `brand` top categories: honda=979, toyota=160
- `model` top categories: jazz=342, amaze=321, city=316, fortuner=160
- `engine_type` top categories: diesel=659, petrol=480
- `region` top categories: mumbai=659, chennai=480
- Potential IQR outliers in `mileage`: 18 (fences -2.36e+04 to 1.12e+05; retained)
- Potential IQR outliers in `washer_plug_drain`: 135 (fences 1 to 1; retained)
- Potential IQR outliers in `spark_plug`: 72 (fences 0 to 0; retained)
- Potential IQR outliers in `brake_fluid`: 173 (fences 0 to 0; retained)
- Potential IQR outliers in `brake_and_clutch_oil`: 153 (fences 0 to 0; retained)
- Potential IQR outliers in `transmission_fluid`: 162 (fences 0 to 0; retained)
- Potential IQR outliers in `brake_pads`: 161 (fences 0 to 0; retained)
- Potential IQR outliers in `clutch`: 151 (fences 0 to 0; retained)
- Potential IQR outliers in `coolant`: 63 (fences 0 to 0; retained)
- Potential IQR outliers in `cost`: 13 (fences -680 to 1.09e+04; retained)

### Repair and towing

- Shape: 2,000,000 rows x 28 columns
- Numeric columns: Service ID, Total Cost, Customer Feedback, Service Duration Hours, Estimated Cost, Mileage at Service, Technician Rating, Tow Distance Miles
- Categorical columns: Customer Name, Vehicle Type, Make and Model, Service Type, Service Description, Repair Date, Towing Date, Tow Location, Drop-off Location, Mechanic Name, Tow Truck Driver, Parts Used, Payment Method, Warranty Information, Service Status, Follow-up Needed, Urgency Level, Customer Type, Insurance Claim Used, Is Warranty Valid
- Exact duplicate rows: 0
- Columns with missing values: 5
- Potential outlier columns: Total Cost, Service Duration Hours, Estimated Cost, Tow Distance Miles
- EDA plots: `D:\ML_Project\plots\repair_cost`

Observed target distributions:
- `Total Cost`: count=2,000,000, missing=0, min=20.0, median=198.77, max=2797.06
- `Service Type`: Oil Change=286,316, Engine Repair=285,929, Battery Replacement=285,923, Tire Replacement=285,837, Towing=285,738, Transmission Repair=285,692, Brake Service=284,565
- `Vehicle Type` top categories: Van=334,078, SUV=333,522, Bus=333,269, Truck=333,230, Car=332,956, Motorcycle=332,945
- `Service Type` top categories: Oil Change=286,316, Engine Repair=285,929, Battery Replacement=285,923, Tire Replacement=285,837, Towing=285,738, Transmission Repair=285,692, Brake Service=284,565
- `Service Status` top categories: s=1,999,999, In Progress=1
- `Urgency Level` top categories: Standard=667,288, Scheduled=666,450, Emergency=666,262
- `Customer Type` top categories: Business=667,341, Fleet=666,794, Individual=665,865

Potential category inconsistency in `Service Status` (retained):
- Rare values: {'In Progress': 1}
- Single-character values: {'s': 1999999}
- Case/whitespace variants: []

| Column | Missing | Percent |
|---|---:|---:|
| Towing Date | 1,714,262 | 85.71% |
| Tow Location | 1,714,262 | 85.71% |
| Drop-off Location | 1,714,262 | 85.71% |
| Tow Truck Driver | 1,714,262 | 85.71% |
| Customer Feedback | 2,000,000 | 100.00% |
- Potential IQR outliers in `Total Cost`: 193,706 (fences -456 to 1.04e+03; retained)
- Potential IQR outliers in `Service Duration Hours`: 6,951 (fences -1 to 7; retained)
- Potential IQR outliers in `Estimated Cost`: 193,089 (fences -456 to 1.04e+03; retained)
- Potential IQR outliers in `Tow Distance Miles`: 285,738 (fences 0 to 0; retained)

## Features, preprocessing, and split

### vehicle_service_cost

- Source: `Vehicle Maintenance- Service Records.csv`
- Target: `cost`
- Features: vehicle_type, brand, model, engine_type, make_year, region, mileage_range, mileage, oil_filter, engine_oil, washer_plug_drain, dust_and_pollen_filter, whell_alignment_and_balancing, air_clean_filter, fuel_filter, spark_plug, brake_fluid, brake_and_clutch_oil, transmission_fluid, brake_pads, clutch, coolant
- Excluded fields: slno
- Feature-selection rationale: Use the vehicle, engine, mileage, region, and planned service-item fields mapped from the existing AutoCare request. Exclude slno because it is a record identifier.
- Preprocessing: numeric median imputation; categorical most-frequent imputation and one-hot encoding (`handle_unknown='ignore'`); transformations are fitted inside each training pipeline.
- Outliers: inspected with IQR fences, not dropped or capped.
- Split: 911 training / 228 held-out testing rows, random_state=42.
- Selected by training-only CV: **RandomForest**.
- Models saved: `D:\ML_Project\models\vehicle_service_cost_model.joblib`
- Metrics saved: `D:\ML_Project\reports\evaluation\vehicle_service_cost_metrics.json`
- Metadata saved: `D:\ML_Project\reports\evaluation\vehicle_service_cost_metadata.json`
- Plots: `D:\ML_Project\plots\vehicle_service`

Cross-validation on training data:
- DecisionTree: neg_mean_absolute_error mean -378.84947 (std 44.47477; 3 folds; 911 training rows)
- RandomForest: neg_mean_absolute_error mean -344.17499 (std 27.73769; 3 folds; 911 training rows)

Held-out test comparison:
- DecisionTree: mae=401.47716, mse=711978.75502, rmse=843.78834, r2=0.85620
- RandomForest: mae=370.54151, mse=527763.00127, rmse=726.47299, r2=0.89341

Cost unit limitation: Source dataset units; currency is not stated in the CSV.
MAE is average absolute error, MSE squares errors and penalizes large misses, RMSE is in the target's source units, and R² compares against a constant-mean baseline. R² alone does not establish practical accuracy.

Feature importance describes how much the fitted tree relies on transformed features; it does not show causation.
- Plot file: `D:\ML_Project\plots\vehicle_service\actual_vs_predicted.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\category_brand.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\category_engine_type.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\category_model.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\category_region.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\correlation_heatmap.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\feature_importance.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\model_comparison.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\numeric_histograms.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\numerical_boxplots.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\residual_distribution.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\residuals.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\scatter_make_year_vs_cost.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\scatter_mileage_range_vs_cost.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\scatter_mileage_vs_cost.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\target_cost_boxplot.png`
- Plot file: `D:\ML_Project\plots\vehicle_service\target_cost_distribution.png`

### repair_cost

- Source: `enhanced_motor_vehicle_repair_towing_dataset.csv`
- Target: `Total Cost`
- Features: Vehicle Type, Make and Model, Service Type, Urgency Level, Customer Type, Insurance Claim Used, Is Warranty Valid, Mileage at Service
- Excluded fields: Service ID, Customer Name, Service Description, Repair Date, Towing Date, Tow Location, Drop-off Location, Mechanic Name, Tow Truck Driver, Parts Used, Payment Method, Warranty Information, Service Status, Customer Feedback, Follow-up Needed, Service Duration Hours, Estimated Cost, Technician Rating, Tow Distance Miles
- Feature-selection rationale: Use vehicle, service type, urgency, customer/insurance/warranty context, and mileage available at request time. Exclude Service ID and names as identifiers, Estimated Cost as a target proxy, and duration, rating, feedback, status, parts, payment, and other fields that describe or follow completed work.
- Preprocessing: numeric median imputation; categorical most-frequent imputation and one-hot encoding (`handle_unknown='ignore'`); transformations are fitted inside each training pipeline.
- Outliers: inspected with IQR fences, not dropped or capped.
- Split: 1,600,000 training / 400,000 held-out testing rows, random_state=42.
- Selected by training-only CV: **RandomForest**.
- Models saved: `D:\ML_Project\models\repair_cost_model.joblib`
- Metrics saved: `D:\ML_Project\reports\evaluation\repair_cost_metrics.json`
- Metadata saved: `D:\ML_Project\reports\evaluation\repair_cost_metadata.json`
- Plots: `D:\ML_Project\plots\repair_cost`

Cross-validation on training data:
- DecisionTree: neg_mean_absolute_error mean -91.74129 (std 0.60963; 3 folds; 100,000 training rows)
- RandomForest: neg_mean_absolute_error mean -90.30836 (std 0.58018; 3 folds; 100,000 training rows)

Held-out test comparison:
- DecisionTree: mae=89.94147, mse=25534.66610, rmse=159.79570, r2=0.84624
- RandomForest: mae=89.68208, mse=25334.20047, rmse=159.16721, r2=0.84745

Cost unit limitation: Source dataset units; currency is not stated in the CSV.
MAE is average absolute error, MSE squares errors and penalizes large misses, RMSE is in the target's source units, and R² compares against a constant-mean baseline. R² alone does not establish practical accuracy.

Feature importance describes how much the fitted tree relies on transformed features; it does not show causation.
- Plot file: `D:\ML_Project\plots\repair_cost\actual_vs_predicted.png`
- Plot file: `D:\ML_Project\plots\repair_cost\category_customer_name.png`
- Plot file: `D:\ML_Project\plots\repair_cost\category_make_and_model.png`
- Plot file: `D:\ML_Project\plots\repair_cost\category_repair_date.png`
- Plot file: `D:\ML_Project\plots\repair_cost\category_service_description.png`
- Plot file: `D:\ML_Project\plots\repair_cost\category_service_type.png`
- Plot file: `D:\ML_Project\plots\repair_cost\category_vehicle_type.png`
- Plot file: `D:\ML_Project\plots\repair_cost\correlation_heatmap.png`
- Plot file: `D:\ML_Project\plots\repair_cost\feature_importance.png`
- Plot file: `D:\ML_Project\plots\repair_cost\missing_values.png`
- Plot file: `D:\ML_Project\plots\repair_cost\model_comparison.png`
- Plot file: `D:\ML_Project\plots\repair_cost\numeric_histograms.png`
- Plot file: `D:\ML_Project\plots\repair_cost\numerical_boxplots.png`
- Plot file: `D:\ML_Project\plots\repair_cost\residual_distribution.png`
- Plot file: `D:\ML_Project\plots\repair_cost\residuals.png`
- Plot file: `D:\ML_Project\plots\repair_cost\scatter_mileage_at_service_vs_total_cost.png`
- Plot file: `D:\ML_Project\plots\repair_cost\target_service_type_distribution.png`
- Plot file: `D:\ML_Project\plots\repair_cost\target_total_cost_boxplot.png`
- Plot file: `D:\ML_Project\plots\repair_cost\target_total_cost_distribution.png`

### maintenance_category

- Source: `enhanced_motor_vehicle_repair_towing_dataset.csv`
- Target: `Service Type`
- Features: Vehicle Type, Make and Model, Urgency Level, Customer Type, Insurance Claim Used, Is Warranty Valid, Mileage at Service
- Excluded fields: Service ID, Customer Name, Service Description, Repair Date, Towing Date, Tow Location, Drop-off Location, Mechanic Name, Tow Truck Driver, Parts Used, Total Cost, Payment Method, Warranty Information, Service Status, Customer Feedback, Follow-up Needed, Service Duration Hours, Estimated Cost, Technician Rating, Tow Distance Miles
- Feature-selection rationale: Exclude Service Type because it is the classification target. Use request-time vehicle, urgency, customer/insurance/warranty context, and mileage; exclude record identifiers, cost fields, and post-service descriptions, parts, status, duration, ratings, and feedback.
- Preprocessing: numeric median imputation; categorical most-frequent imputation and one-hot encoding (`handle_unknown='ignore'`); transformations are fitted inside each training pipeline.
- Outliers: inspected with IQR fences, not dropped or capped.
- Split: 1,600,000 training / 400,000 held-out testing rows, random_state=42.
- Selected by training-only CV: **RandomForest**.
- Models saved: `D:\ML_Project\models\maintenance_category_model.joblib`
- Metrics saved: `D:\ML_Project\reports\evaluation\maintenance_category_metrics.json`
- Metadata saved: `D:\ML_Project\reports\evaluation\maintenance_category_metadata.json`
- Plots: `D:\ML_Project\plots\maintenance_category`

Cross-validation on training data:
- DecisionTree: f1_macro mean 0.22537 (std 0.02392; 3 folds; 100,000 training rows)
- RandomForest: f1_macro mean 0.28386 (std 0.00040; 3 folds; 100,000 training rows)

Held-out test comparison:
- DecisionTree: accuracy=0.28576, precision_macro=0.28392, recall_macro=0.28561, macro_f1=0.23584, weighted_f1=0.23594
- RandomForest: accuracy=0.28523, precision_macro=0.28515, recall_macro=0.28518, macro_f1=0.28454, weighted_f1=0.28457

Selected classifier report:

```text
                     precision    recall  f1-score   support

Battery Replacement       0.17      0.16      0.17     57185
      Brake Service       0.17      0.13      0.14     56913
      Engine Repair       0.17      0.17      0.17     57186
         Oil Change       0.17      0.20      0.18     57263
   Tire Replacement       0.16      0.17      0.17     57167
             Towing       1.00      1.00      1.00     57148
Transmission Repair       0.16      0.16      0.16     57138

           accuracy                           0.29    400000
          macro avg       0.29      0.29      0.28    400000
       weighted avg       0.29      0.29      0.28    400000

```

Feature importance describes how much the fitted tree relies on transformed features; it does not show causation.
- Plot file: `D:\ML_Project\plots\maintenance_category\confusion_matrix.png`
- Plot file: `D:\ML_Project\plots\maintenance_category\feature_importance.png`
- Plot file: `D:\ML_Project\plots\maintenance_category\model_comparison.png`

## Prediction example

Use the saved feature names in `reports/evaluation/*_example_input.json`; missing values and unseen categories are handled by the saved pipeline.

```powershell
.\.venv\Scripts\python.exe predict_model.py --model models\vehicle_service_cost_model.joblib --input reports\evaluation\vehicle_service_cost_example_input.json
```

The service-cost JSON export is used by the existing Node API. It contains the selected tree model plus fitted imputers and one-hot categories; Node evaluates the same feature representation without attempting to load a joblib file.

## Limitations and recommendations

- Dataset currency is not stated; do not label estimates as INR until the source is verified.
- A random split is used because the source does not document a reliable vehicle/customer group identifier for these prediction requests.
- The maintenance records represent Chennai/Mumbai context; generalization beyond observed inputs is uncertain.
- Repair/towing records have a fully missing feedback column and anomalous Service Status values; verify source quality before deployment.
- Compare MAE/RMSE with the real operational tolerance before using estimates for decisions.
