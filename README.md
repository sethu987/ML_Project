# AutoCare

AutoCare is a responsive vehicle-maintenance dashboard for phones, tablets, and computers, with vehicle records, service history, reminders, analytics, and an ML-based maintenance-cost estimate. The JavaScript server serves the web app and API from one origin and provides account registration, cookie-based sessions, and account-scoped dashboard storage.

## Requirements

- Windows with Node.js 22.13 or newer.
- The exported tree-model file at `models/vehicle_service_cost.json`.

Install the JavaScript dependencies from the project folder:

```powershell
npm install
```

Python is optional at runtime. It is only needed if you want to retrain the machine-learning models from the source CSV files. To do that, set up the Python training dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

For the educational notebook, install its separate Jupyter dependencies too:

```powershell
python -m pip install -r notebooks\requirements.txt
jupyter lab notebooks\AutoCare_ML_Tutorial.ipynb
```

Place these source datasets in the current Windows user's Downloads folder:

- `Vehicle Maintenance- Service Records.csv`
- `enhanced_motor_vehicle_repair_towing_dataset.csv`

Train all three tasks (maintenance cost, repair/towing cost, and service category) with:

```powershell
python train_model.py
```

Train one task at a time if desired:

```powershell
python train_model.py --dataset service
python train_model.py --dataset repair
python train_model.py --dataset category
```

Alternate dataset paths can be supplied without editing the script:

```powershell
python train_model.py --service-csv "D:\data\Vehicle Maintenance- Service Records.csv" --repair-csv "D:\data\enhanced_motor_vehicle_repair_towing_dataset.csv"
```

The `--cv-folds` option defaults to 3 and applies cross-validation only to training data. On large datasets, `--cv-sample-size` (default 100,000) bounds the deterministic sample used for model comparison; the final models are still fitted on the complete training split. `--eda-sample-size` limits only visual samples. Trained scikit-learn pipelines and their metadata are saved under `models\production_v2\`; EDA, evaluation, plots, and the final report are saved under `reports\production_v2\` and `plots\production_v2\`.

For a standalone prediction with a saved pipeline, use an input JSON object whose keys match that model's features. The trainer writes a held-out example input for each task:

```powershell
python predict_model.py --model models\production_v2\vehicle_service_cost_model.joblib --input reports\production_v2\evaluation\vehicle_service_cost_example_input.json
```

The service-cost artifact is also exported to `models\production_v2\vehicle_service_cost.json` for the existing Node API. The Node backend reads this versioned file and keeps its existing prediction request and response fields. The JSON stores the selected tree(s) and fitted preprocessing data; a Random Forest is never represented as linear coefficients. Older artifacts in `models\` remain untouched. The source maintenance CSV does not document a currency, so predictions and the UI are labeled in source dataset units rather than INR.

The production training code is organized into reusable modules under `src\`, with `train_model.py` remaining the command-line entry point. The educational notebook explains the same workflow step by step and saves separate tutorial artifacts.

The training command reads the CSV datasets from the current user's Downloads folder by default. The JavaScript API only needs Node.js and the versioned JSON tree-model export at runtime; Python and `.joblib` files are not loaded by Node. Run backend regression tests with `npm test`.

## Run locally

AutoCare's frontend is plain HTML, CSS, and JavaScript. Its Node.js backend handles the API, authentication, and SQLite database. The backend must stay running while you use the app.

In the first Windows Command Prompt or VS Code terminal, install dependencies and start the backend:

```bat
cd /d "C:\Users\venka\OneDrive\Desktop\Documents\ML Project"
npm install
npm run dev
```

In a second terminal, start a static frontend server if you want to use port 5500:

```bat
cd /d "C:\Users\venka\OneDrive\Desktop\Documents\ML Project"
py -m http.server 5500 --bind 127.0.0.1
```

Alternatively, use VS Code Live Server on port 5500. Open <http://127.0.0.1:5500/auth.html>. Keep both terminals running. Live Server serves the frontend only; the Node backend on port 8000 is still required for login, registration, and dashboard API requests.

To confirm the backend is ready, open <http://127.0.0.1:8000/api/health> or run `curl.exe http://127.0.0.1:8000/api/health`. It should return JSON with `"ready": true` and `"runtime": "node"`.

Do not open `index.html` directly: the browser needs an HTTP origin for API requests and cookies.

For normal (non-watch) startup, run `npm start` in the project folder. The backend also serves the complete app itself at <http://127.0.0.1:8000/> if you do not need a separate frontend server.

The health check is at `/api/health` and reports `runtime: "node"` when the JavaScript backend is serving the app. The SQLite database is created as `autocare.sqlite3` in the project folder by default; set `AUTOCARE_DB_PATH` in `.env` to place it elsewhere. Existing account and dashboard data in this SQLite database remains usable. Account data is stored separately by user, and the database is excluded from version control.

If you prefer to view the frontend through VS Code Live Server at `http://127.0.0.1:5500` or `http://localhost:5500`, start the Node backend first and keep it running on port 8000. The frontend automatically sends API requests to that backend. If an older Python server is still running on port 8000, stop it before starting the JavaScript server.

## Test account and dashboard flow

1. Open the AutoCare sign-in page, choose **Create account**, and submit a name, valid email address, and matching password of at least 12 characters.
2. After the account is created, sign in with that email and password. The password is stored as a bcrypt hash; email delivery is not required. The existing dashboard opens with a private garage (new accounts start empty unless you import older browser data). Add vehicles and use the existing history, reminders, analytics, and prediction features.
3. Select **Sign out** to invalidate the server session. Protected API requests require an authenticated account; browser sessions expire after 8 hours.

If this browser has dashboard records saved by the previous local-only version, the app offers a one-time import only when the signed-in account has no saved dashboard yet. Confirm only if those records belong to you. The old browser copy is kept; declining leaves it untouched and suppresses further import prompts in that browser.

Run the automated JavaScript tests with:

```powershell
npm test
```

The tests use an isolated temporary SQLite database and do not require email or SMTP configuration.

## Security notes

Passwords use bcrypt hashes. Session identifiers are random, and only hashed session identifiers are stored. Mutating requests require a session-bound CSRF token. Session cookies are HttpOnly, SameSite=Lax, and expire after eight hours. Auth endpoints have basic in-memory per-IP rate limits. The server is intended for local development; do not expose it directly to the public internet. Use a production deployment with HTTPS, a production-grade HTTP server, and managed database storage before making the app publicly available.
