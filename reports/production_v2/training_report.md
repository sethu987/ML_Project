# AutoCare Model Training Report

Generated (UTC): 2026-10-26T12:47:44.043517+00:00

All cost values remain in their source units; neither CSV documents a currency.
Exact duplicate records are counted and retained because repeated service visits may be valid.
IQR outliers are flagged for review and are not automatically discarded.

## Vehicle maintenance

- Full dataset shape: 1,139 rows x 24 columns
- Numerical columns: slno, make_year, mileage_range, mileage, oil_filter, engine_oil, washer_plug_drain, dust_and_pollen_filter, whell_alignment_and_balancing, air_clean_filter, fuel_filter, spark_plug, brake_fluid, brake_and_clutch_oil, transmission_fluid, brake_pads, clutch, coolant, cost
- Categorical columns: vehicle_type, brand, model, engine_type, region
- Exact duplicate rows: 0
- Missing columns: {}
- Potential outliers: {'mileage': {'count': 18, 'lower_fence': -23599.5, 'upper_fence': 112204.5}, 'washer_plug_drain': {'count': 135, 'lower_fence': 1.0, 'upper_fence': 1.0}, 'spark_plug': {'count': 72, 'lower_fence': 0.0, 'upper_fence': 0.0}, 'brake_fluid': {'count': 173, 'lower_fence': 0.0, 'upper_fence': 0.0}, 'brake_and_clutch_oil': {'count': 153, 'lower_fence': 0.0, 'upper_fence': 0.0}, 'transmission_fluid': {'count': 162, 'lower_fence': 0.0, 'upper_fence': 0.0}, 'brake_pads': {'count': 161, 'lower_fence': 0.0, 'upper_fence': 0.0}, 'clutch': {'count': 151, 'lower_fence': 0.0, 'upper_fence': 0.0}, 'coolant': {'count': 63, 'lower_fence': 0.0, 'upper_fence': 0.0}, 'cost': {'count': 13, 'lower_fence': -679.75, 'upper_fence': 10942.25}}
- Category quality flags: {}
- EDA plots: `D:\ML_Project\plots\production_v2\eda\vehicle_service`
- Plots use a fixed-seed sample; dataset inspection and final model evaluation use all usable rows.
- Target distributions: {'cost': {'count': 1139, 'missing': 0, 'minimum': 1099.0, 'median': 5199.0, 'maximum': 14000.0}}

## Repair and towing

- Full dataset shape: 2,000,000 rows x 28 columns
- Numerical columns: Service ID, Total Cost, Customer Feedback, Service Duration Hours, Estimated Cost, Mileage at Service, Technician Rating, Tow Distance Miles
- Categorical columns: Customer Name, Vehicle Type, Make and Model, Service Type, Service Description, Repair Date, Towing Date, Tow Location, Drop-off Location, Mechanic Name, Tow Truck Driver, Parts Used, Payment Method, Warranty Information, Service Status, Follow-up Needed, Urgency Level, Customer Type, Insurance Claim Used, Is Warranty Valid
- Exact duplicate rows: 0
- Missing columns: {'Towing Date': {'count': 1714262, 'percent': 85.71}, 'Tow Location': {'count': 1714262, 'percent': 85.71}, 'Drop-off Location': {'count': 1714262, 'percent': 85.71}, 'Tow Truck Driver': {'count': 1714262, 'percent': 85.71}, 'Customer Feedback': {'count': 2000000, 'percent': 100.0}}
- Potential outliers: {'Total Cost': {'count': 193706, 'lower_fence': -456.17499999999995, 'upper_fence': 1040.0249999999999}, 'Service Duration Hours': {'count': 6951, 'lower_fence': -1.0, 'upper_fence': 7.0}, 'Estimated Cost': {'count': 193089, 'lower_fence': -455.8550000000001, 'upper_fence': 1038.9850000000001}, 'Tow Distance Miles': {'count': 285738, 'lower_fence': 0.0, 'upper_fence': 0.0}}
- Category quality flags: {'Service Status': {'rare_values': {'In Progress': 1}, 'single_character_values': {'s': 1999999}, 'case_whitespace_variants': []}}
- EDA plots: `D:\ML_Project\plots\production_v2\eda\repair_towing`
- Plots use a fixed-seed sample; dataset inspection and final model evaluation use all usable rows.
- Target distributions: {'Total Cost': {'count': 2000000, 'missing': 0, 'minimum': 20.0, 'median': 198.77, 'maximum': 2797.06}, 'Service Type': {'Oil Change': 286316, 'Engine Repair': 285929, 'Battery Replacement': 285923, 'Tire Replacement': 285837, 'Towing': 285738, 'Transmission Repair': 285692, 'Brake Service': 284565}}

## Task: vehicle_service_cost

- Source: `Vehicle Maintenance- Service Records.csv`
- Target: `cost`
- Input features: ['vehicle_type', 'brand', 'model', 'engine_type', 'make_year', 'region', 'mileage_range', 'mileage', 'oil_filter', 'engine_oil', 'washer_plug_drain', 'dust_and_pollen_filter', 'whell_alignment_and_balancing', 'air_clean_filter', 'fuel_filter', 'spark_plug', 'brake_fluid', 'brake_and_clutch_oil', 'transmission_fluid', 'brake_pads', 'clutch', 'coolant']
- Excluded fields: ['slno']
- Feature-selection rationale: Use vehicle, engine, mileage, region, and planned service-item inputs; exclude slno because it is a record identifier.
- Preprocessing: median numerical imputation; most-frequent categorical imputation; one-hot encoding with unknown-category tolerance. All transformations are fitted inside each training fold.
- Split: 911 train / 228 held-out test; seed=42.
- Selected using training-only CV: **RandomForest**.
- CV results: {'DecisionTree': {'scoring': 'neg_mean_absolute_error', 'folds': 3, 'rows_used': 911, 'training_data_only': True, 'fold_scores': [-382.5139254385965, -322.6395285087719, -431.394970925664], 'mean_score': -378.8494749576775, 'standard_deviation': 44.47476971511536}, 'RandomForest': {'scoring': 'neg_mean_absolute_error', 'folds': 3, 'rows_used': 911, 'training_data_only': True, 'fold_scores': [-340.3460535615244, -312.28009036216895, -379.89883511359375], 'mean_score': -344.174993012429, 'standard_deviation': 27.737690884770313}}
- Test comparison: {'DecisionTree': {'mae': 401.47715643274864, 'mse': 711978.7550248078, 'rmse': 843.7883354401196, 'r2': 0.8562026709339493}, 'RandomForest': {'mae': 370.54151195529727, 'mse': 527763.0012667179, 'rmse': 726.4729872932082, 'r2': 0.8934084627856733}}
- Model artifact: `D:\ML_Project\models\production_v2\vehicle_service_cost_model.joblib`
- Metrics: `D:\ML_Project\reports\production_v2\evaluation\vehicle_service_cost_metrics.json`
- Metadata: `D:\ML_Project\reports\production_v2\evaluation\vehicle_service_cost_metadata.json`
- Evaluation plots: `D:\ML_Project\plots\production_v2\vehicle_service_cost`

MAE is mean absolute error; MSE squares errors; RMSE is in source units; R² compares performance with a mean-prediction baseline. A high R² alone does not show practical accuracy.
- Plot: `D:\ML_Project\plots\production_v2\vehicle_service_cost\actual_vs_predicted.png`
- Plot: `D:\ML_Project\plots\production_v2\vehicle_service_cost\feature_importance.png`
- Plot: `D:\ML_Project\plots\production_v2\vehicle_service_cost\model_comparison.png`
- Plot: `D:\ML_Project\plots\production_v2\vehicle_service_cost\residual_distribution.png`
- Plot: `D:\ML_Project\plots\production_v2\vehicle_service_cost\residuals.png`

Known limitations: ['Random holdout may share vehicle or customer characteristics across partitions.', 'Tree feature importance indicates model reliance, not causation.', 'Cost currency is not documented in either source dataset.', "Repair Service Status is overwhelmingly 's' with one 'In Progress' row; verify source encoding."]

## Task: repair_cost

- Source: `enhanced_motor_vehicle_repair_towing_dataset.csv`
- Target: `Total Cost`
- Input features: ['Vehicle Type', 'Make and Model', 'Service Type', 'Urgency Level', 'Customer Type', 'Insurance Claim Used', 'Is Warranty Valid', 'Mileage at Service']
- Excluded fields: ['Service ID', 'Customer Name', 'Service Description', 'Repair Date', 'Towing Date', 'Tow Location', 'Drop-off Location', 'Mechanic Name', 'Tow Truck Driver', 'Parts Used', 'Payment Method', 'Warranty Information', 'Service Status', 'Customer Feedback', 'Follow-up Needed', 'Service Duration Hours', 'Estimated Cost', 'Technician Rating', 'Tow Distance Miles']
- Feature-selection rationale: Use vehicle, service type, urgency, customer/insurance/warranty context, and mileage available at request time. Exclude identifiers, Estimated Cost as a target proxy, and fields describing completed work.
- Preprocessing: median numerical imputation; most-frequent categorical imputation; one-hot encoding with unknown-category tolerance. All transformations are fitted inside each training fold.
- Split: 1,600,000 train / 400,000 held-out test; seed=42.
- Selected using training-only CV: **RandomForest**.
- CV results: {'DecisionTree': {'scoring': 'neg_mean_absolute_error', 'folds': 3, 'rows_used': 25000, 'training_data_only': True, 'fold_scores': [-90.1900305920357, -91.51768921816961, -94.27740929110585], 'mean_score': -91.99504303377039, 'standard_deviation': 1.7024621692036859}, 'RandomForest': {'scoring': 'neg_mean_absolute_error', 'folds': 3, 'rows_used': 25000, 'training_data_only': True, 'fold_scores': [-88.07395110691027, -89.07341684367218, -90.60262733236033], 'mean_score': -89.2499984276476, 'standard_deviation': 1.0398514814268864}}
- Test comparison: {'DecisionTree': {'mae': 89.94146957592748, 'mse': 25534.666098901263, 'rmse': 159.79570112772515, 'r2': 0.8462437453267582}, 'RandomForest': {'mae': 89.68208197534665, 'mse': 25334.200469961223, 'rmse': 159.16720915427658, 'r2': 0.8474508433235423}}
- Model artifact: `D:\ML_Project\models\production_v2\repair_cost_model.joblib`
- Metrics: `D:\ML_Project\reports\production_v2\evaluation\repair_cost_metrics.json`
- Metadata: `D:\ML_Project\reports\production_v2\evaluation\repair_cost_metadata.json`
- Evaluation plots: `D:\ML_Project\plots\production_v2\repair_cost`

MAE is mean absolute error; MSE squares errors; RMSE is in source units; R² compares performance with a mean-prediction baseline. A high R² alone does not show practical accuracy.
- Plot: `D:\ML_Project\plots\production_v2\repair_cost\actual_vs_predicted.png`
- Plot: `D:\ML_Project\plots\production_v2\repair_cost\feature_importance.png`
- Plot: `D:\ML_Project\plots\production_v2\repair_cost\model_comparison.png`
- Plot: `D:\ML_Project\plots\production_v2\repair_cost\residual_distribution.png`
- Plot: `D:\ML_Project\plots\production_v2\repair_cost\residuals.png`

Known limitations: ['Random holdout may share vehicle or customer characteristics across partitions.', 'Tree feature importance indicates model reliance, not causation.', 'Cost currency is not documented in either source dataset.', "Repair Service Status is overwhelmingly 's' with one 'In Progress' row; verify source encoding."]

## Task: maintenance_category

- Source: `enhanced_motor_vehicle_repair_towing_dataset.csv`
- Target: `Service Type`
- Input features: ['Vehicle Type', 'Make and Model', 'Urgency Level', 'Customer Type', 'Insurance Claim Used', 'Is Warranty Valid', 'Mileage at Service']
- Excluded fields: ['Service ID', 'Customer Name', 'Service Description', 'Repair Date', 'Towing Date', 'Tow Location', 'Drop-off Location', 'Mechanic Name', 'Tow Truck Driver', 'Parts Used', 'Total Cost', 'Payment Method', 'Warranty Information', 'Service Status', 'Customer Feedback', 'Follow-up Needed', 'Service Duration Hours', 'Estimated Cost', 'Technician Rating', 'Tow Distance Miles']
- Feature-selection rationale: Exclude Service Type as the target and exclude identifiers, cost fields, and post-service descriptions, parts, status, duration, ratings, and feedback.
- Preprocessing: median numerical imputation; most-frequent categorical imputation; one-hot encoding with unknown-category tolerance. All transformations are fitted inside each training fold.
- Split: 1,600,000 train / 400,000 held-out test; seed=42.
- Selected using training-only CV: **RandomForest**.
- CV results: {'DecisionTree': {'scoring': 'f1_macro', 'folds': 3, 'rows_used': 25000, 'training_data_only': True, 'fold_scores': [0.24737048438753534, 0.20002189464500506, 0.22873190416831765], 'mean_score': 0.22537476106695267, 'standard_deviation': 0.01947519867256631}, 'RandomForest': {'scoring': 'f1_macro', 'folds': 3, 'rows_used': 25000, 'training_data_only': True, 'fold_scores': [0.29831066931789874, 0.2819249923290395, 0.28603348387433164], 'mean_score': 0.2887563818404233, 'standard_deviation': 0.006960997658196096}}
- Test comparison: {'DecisionTree': {'accuracy': 0.2857625, 'precision_macro': 0.2839244952192686, 'recall_macro': 0.28560714408691873, 'macro_f1': 0.23583869635648452, 'weighted_f1': 0.23593782427951815}, 'RandomForest': {'accuracy': 0.28523, 'precision_macro': 0.28515350868860373, 'recall_macro': 0.28518499261522434, 'macro_f1': 0.28453718005716006, 'weighted_f1': 0.2845663932716358}, 'MajorityBaseline': {'accuracy': 0.1431575, 'precision_macro': 0.020451071428571426, 'recall_macro': 0.14285714285714285, 'macro_f1': 0.03577997157622013, 'weighted_f1': 0.035855198966459126}}
- Model artifact: `D:\ML_Project\models\production_v2\maintenance_category_model.joblib`
- Metrics: `D:\ML_Project\reports\production_v2\evaluation\maintenance_category_metrics.json`
- Metadata: `D:\ML_Project\reports\production_v2\evaluation\maintenance_category_metadata.json`
- Evaluation plots: `D:\ML_Project\plots\production_v2\maintenance_category`
- Majority-class baseline test metrics: {'accuracy': 0.1431575, 'precision_macro': 0.020451071428571426, 'recall_macro': 0.14285714285714285, 'macro_f1': 0.03577997157622013, 'weighted_f1': 0.035855198966459126}

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
- Plot: `D:\ML_Project\plots\production_v2\maintenance_category\confusion_matrix.png`
- Plot: `D:\ML_Project\plots\production_v2\maintenance_category\feature_importance.png`
- Plot: `D:\ML_Project\plots\production_v2\maintenance_category\model_comparison.png`

Known limitations: ['Random holdout may share vehicle or customer characteristics across partitions.', 'Tree feature importance indicates model reliance, not causation.', 'Cost currency is not documented in either source dataset.', "Repair Service Status is overwhelmingly 's' with one 'In Progress' row; verify source encoding."]

## Prediction example

```powershell
.\.venv\Scripts\python.exe predict_model.py --model models\production_v2\vehicle_service_cost_model.joblib --input reports\production_v2\evaluation\vehicle_service_cost_example_input.json
```

The Node application reads `models/production_v2/vehicle_service_cost.json`, which contains the selected tree model and fitted preprocessing, not linear coefficients.
