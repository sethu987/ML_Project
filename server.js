"use strict";

const bcrypt = require("bcryptjs");
const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PROJECT_DIR = __dirname;
loadDotEnv();
const HOST = process.env.AUTOCARE_HOST || "127.0.0.1";
const PORT = Number(process.env.AUTOCARE_PORT || 8000);
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_AUTH_BODY_BYTES = 16_384;
const MAX_DATA_BODY_BYTES = 1_000_000;
const MAX_PREDICTION_BODY_BYTES = 16_384;
const MAX_PASSWORD_BYTES = 72;
const SESSION_COOKIE = "autocare_session";
const PUBLIC_FILES = new Set([
  "/auth.html",
  "/index.html",
  "/auth.js",
  "/script.js",
  "/data.js",
  "/style.css",
]);
const SERVICE_FEATURES = {
  "regular service": {
    oil_filter: 1,
    engine_oil: 1,
    washer_plug_drain: 1,
    dust_and_pollen_filter: 1,
    whell_alignment_and_balancing: 1,
    air_clean_filter: 1,
    fuel_filter: 1,
  },
  "oil change": { oil_filter: 1, engine_oil: 1, washer_plug_drain: 1 },
  "brake service": { brake_fluid: 1, brake_and_clutch_oil: 1, brake_pads: 1 },
  "tyre replacement": { whell_alignment_and_balancing: 1 },
};
const rateBuckets = new Map();
const EMPTY_USER_DATA = { vehicles: [], services: [], reminders: [] };

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function loadDotEnv() {
  const envPath = path.join(PROJECT_DIR, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function databasePath() {
  const configured = process.env.AUTOCARE_DB_PATH;
  return configured ? path.resolve(configured) : path.join(PROJECT_DIR, "autocare.sqlite3");
}

function initializeDatabase(db) {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash BLOB NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_hash TEXT PRIMARY KEY,
      csrf_token TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      expires_at REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS user_data (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function openDatabase(filename = databasePath()) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  initializeDatabase(db);
  return db;
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "+00:00");
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

function constantTimeEqual(expected, supplied) {
  if (typeof supplied !== "string") return false;
  const first = Buffer.from(expected, "utf8");
  const second = Buffer.from(supplied, "utf8");
  return first.length === second.length && timingSafeEqual(first, second);
}

function normalizeEmail(value) {
  if (typeof value !== "string") throw new HttpError(400, "Enter a valid email address.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  return email;
}

function passwordBytes(password) {
  if (typeof password !== "string" || password.length < 12) {
    throw new HttpError(400, "Password must be at least 12 characters long.");
  }
  const byteLength = Buffer.byteLength(password, "utf8");
  if (byteLength > MAX_PASSWORD_BYTES) {
    throw new HttpError(400, "Password must be no more than 72 UTF-8 bytes.");
  }
  return byteLength;
}

function createAnonymousSession(db) {
  const sessionKey = newToken();
  const csrfToken = newToken();
  const now = Date.now() / 1000;
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  db.prepare(
    "INSERT INTO auth_sessions (session_hash, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(digest(sessionKey), csrfToken, now + SESSION_SECONDS, utcNow());
  return { sessionKey, csrfToken };
}

function getSession(db, sessionKey) {
  if (!sessionKey) return null;
  return db.prepare(`
    SELECT s.session_hash, s.csrf_token, s.user_id, s.expires_at,
           u.full_name, u.email
    FROM auth_sessions AS s
    LEFT JOIN users AS u ON u.id = s.user_id
    WHERE s.session_hash = ? AND s.expires_at > ?
  `).get(digest(sessionKey), Date.now() / 1000) || null;
}

function createUser(db, fullName, emailValue, password) {
  if (typeof fullName !== "string" || !fullName.trim() || fullName.trim().length > 80) {
    throw new HttpError(400, "Full name must be between 1 and 80 characters.");
  }
  const email = normalizeEmail(emailValue);
  passwordBytes(password);
  const hash = bcrypt.hashSync(password, 12);
  try {
    const result = db.prepare(
      "INSERT INTO users (full_name, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, 1, ?)",
    ).run(fullName.trim(), email, Buffer.from(hash, "utf8"), utcNow());
    return Number(result.lastInsertRowid);
  } catch (error) {
    if (String(error.message).includes("users.email")) {
      throw new HttpError(409, "An account with this email address already exists.");
    }
    throw error;
  }
}

const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(32).toString("hex"), 12);

function authenticateUser(db, emailValue, password) {
  const email = normalizeEmail(emailValue);
  if (typeof password !== "string") throw new HttpError(400, "Password is required.");
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new HttpError(401, "Email or password is incorrect.");
  }
  const user = db.prepare(
    "SELECT id, full_name, email, password_hash FROM users WHERE email = ?",
  ).get(email);
  const encodedHash = user
    ? Buffer.from(user.password_hash).toString("utf8")
    : DUMMY_PASSWORD_HASH;
  const passwordMatches = bcrypt.compareSync(password, encodedHash);
  if (!user || !passwordMatches) throw new HttpError(401, "Email or password is incorrect.");
  return user;
}

function rotateSession(db, oldSessionHash, userId) {
  const sessionKey = newToken();
  const csrfToken = newToken();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM auth_sessions WHERE session_hash = ?").run(oldSessionHash);
    db.prepare(
      "INSERT INTO auth_sessions (session_hash, csrf_token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(digest(sessionKey), csrfToken, userId, Date.now() / 1000 + SESSION_SECONDS, utcNow());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { sessionKey, csrfToken };
}

function getUserData(db, userId) {
  const row = db.prepare("SELECT data_json FROM user_data WHERE user_id = ?").get(userId);
  return row ? JSON.parse(row.data_json) : { ...EMPTY_USER_DATA };
}

function userDataInitialized(db, userId) {
  return Boolean(db.prepare("SELECT 1 FROM user_data WHERE user_id = ?").get(userId));
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function finiteNumber(value) {
  if (typeof value === "string" && !value.trim()) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateUserData(value) {
  if (!isRecord(value) || !["vehicles", "services", "reminders"].every((key) => Array.isArray(value[key]))) {
    throw new HttpError(400, "Dashboard data must contain vehicles, services, and reminders.");
  }
  const { vehicles, services, reminders } = value;
  if (vehicles.length > 200 || services.length > 5000 || reminders.length > 2000) {
    throw new HttpError(413, "Dashboard data exceeds the allowed record limits.");
  }

  const vehicleIds = new Set();
  const cleanVehicles = vehicles.map((vehicle) => {
    if (!isRecord(vehicle)) throw new HttpError(400, "Each vehicle must be an object.");
    const { id, make, model, fuel } = vehicle;
    if (typeof id !== "string" || !id || id.length > 100 || vehicleIds.has(id)) {
      throw new HttpError(400, "Vehicle identifiers must be unique non-empty strings.");
    }
    vehicleIds.add(id);
    if ([make, model, fuel].some((item) => typeof item !== "string" || !item.trim() || item.length > 80)) {
      throw new HttpError(400, "Vehicle make, model, and fuel must be non-empty text.");
    }
    const yearValue = finiteNumber(vehicle.year);
    const mileage = finiteNumber(vehicle.mileage);
    const year = yearValue === null ? NaN : Math.trunc(yearValue);
    if (
      !Number.isInteger(yearValue)
      || year < 1950
      || year > new Date().getFullYear()
      || mileage === null
      || mileage < 0
      || mileage > 2_000_000
    ) {
      throw new HttpError(400, "Vehicle year or mileage is outside the supported range.");
    }
    return {
      id,
      make: make.trim(),
      model: model.trim(),
      year,
      fuel: fuel.trim(),
      mileage,
      selected: vehicle.selected === true,
    };
  });
  if (cleanVehicles.length && !cleanVehicles.some((item) => item.selected)) {
    cleanVehicles[0].selected = true;
  }
  if (cleanVehicles.filter((item) => item.selected).length > 1) {
    throw new HttpError(400, "Only one vehicle may be selected.");
  }

  const cleanServices = services.map((service) => {
    if (!isRecord(service) || typeof service.vehicleId !== "string" || !vehicleIds.has(service.vehicleId)) {
      throw new HttpError(400, "Each service record must belong to one of your vehicles.");
    }
    const mileage = finiteNumber(service.mileage);
    const cost = finiteNumber(service.cost);
    if (
      !isIsoDate(service.date)
      || service.date > todayIso()
      || mileage === null
      || mileage < 0
      || mileage > 2_000_000
      || cost === null
      || cost < 0
      || cost > 10_000_000
    ) {
      throw new HttpError(400, "Service dates, mileage, and cost must be valid.");
    }
    const { id, category } = service;
    const notes = service.notes === undefined ? "" : service.notes;
    if (
      typeof id !== "string"
      || !id
      || id.length > 100
      || typeof category !== "string"
      || !category.trim()
      || category.length > 80
      || typeof notes !== "string"
      || notes.length > 240
    ) {
      throw new HttpError(400, "Service record values are outside the supported range.");
    }
    return {
      id,
      vehicleId: service.vehicleId,
      date: service.date,
      mileage,
      category: category.trim(),
      cost,
      notes,
    };
  });

  const cleanReminders = reminders.map((reminder) => {
    if (!isRecord(reminder) || typeof reminder.vehicleId !== "string" || !vehicleIds.has(reminder.vehicleId)) {
      throw new HttpError(400, "Each reminder must belong to one of your vehicles.");
    }
    const { id, title, dueDate } = reminder;
    const notes = reminder.notes === undefined ? "" : reminder.notes;
    if (
      typeof id !== "string"
      || !id
      || id.length > 100
      || typeof title !== "string"
      || !title.trim()
      || title.length > 60
      || !isIsoDate(dueDate)
      || typeof notes !== "string"
      || notes.length > 240
    ) {
      throw new HttpError(400, "Reminder fields are outside the supported range.");
    }
    return {
      id,
      vehicleId: reminder.vehicleId,
      title: title.trim(),
      dueDate,
      notes,
    };
  });

  const result = { vehicles: cleanVehicles, services: cleanServices, reminders: cleanReminders };
  if (value.lastEstimate !== undefined && value.lastEstimate !== null) {
    const estimate = value.lastEstimate;
    const amount = isRecord(estimate) ? finiteNumber(estimate.amount) : null;
    if (
      !isRecord(estimate)
      || typeof estimate.vehicleId !== "string"
      || !vehicleIds.has(estimate.vehicleId)
      || typeof estimate.category !== "string"
    ) {
      throw new HttpError(400, "Latest estimate must reference one of your vehicles.");
    }
    if (amount === null || amount < 0 || amount > 100_000_000) {
      throw new HttpError(400, "Latest estimate amount is outside the supported range.");
    }
    result.lastEstimate = {
      amount,
      vehicleId: estimate.vehicleId,
      category: estimate.category.slice(0, 80),
    };
  }
  return result;
}

function saveUserData(db, userId, value) {
  const cleaned = validateUserData(value);
  db.prepare(`
    INSERT INTO user_data (user_id, data_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(cleaned), utcNow());
  return cleaned;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function loadServiceModel() {
  const modelPath = path.join(
    PROJECT_DIR,
    "models",
    "production_v2",
    "vehicle_service_cost.json",
  );
  if (!fs.existsSync(modelPath)) {
    throw new Error("The JavaScript service-cost model was not found. Run train_model.py to export it.");
  }
  const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));
  const preprocessing = model.preprocessing;
  if (
    model.format_version !== 2
    || !Array.isArray(model.trees)
    || model.trees.length === 0
    || !isRecord(model.metadata)
    || !isRecord(preprocessing)
    || !Array.isArray(preprocessing.numeric_features)
    || !Array.isArray(preprocessing.numeric_medians)
    || preprocessing.numeric_features.length !== preprocessing.numeric_medians.length
    || !Array.isArray(preprocessing.categorical_features)
    || !Array.isArray(preprocessing.categorical_fill_values)
    || !Array.isArray(preprocessing.categories)
    || preprocessing.categorical_features.length !== preprocessing.categorical_fill_values.length
    || preprocessing.categorical_features.length !== preprocessing.categories.length
    || !Array.isArray(model.metadata.supported_vehicle_combinations)
  ) {
    throw new Error("The saved JavaScript service-cost model has an unexpected format.");
  }
  for (const tree of model.trees) {
    if (
      !isRecord(tree)
      || !Array.isArray(tree.children_left)
      || !Array.isArray(tree.children_right)
      || !Array.isArray(tree.feature)
      || !Array.isArray(tree.threshold)
      || !Array.isArray(tree.value)
      || tree.children_left.length !== tree.children_right.length
      || tree.children_left.length !== tree.feature.length
      || tree.children_left.length !== tree.threshold.length
      || tree.children_left.length !== tree.value.length
    ) {
      throw new Error("The saved JavaScript tree model has an unexpected structure.");
    }
  }
  return model;
}

function validatePrediction(payload) {
  if (!isRecord(payload)) throw new HttpError(422, "The request body must be a JSON object.");
  const required = ["make", "model", "fuel", "year", "mileage", "region", "category"];
  const missing = required.filter((key) => !Object.hasOwn(payload, key));
  if (missing.length) throw new HttpError(422, `Missing required field(s): ${missing.join(", ")}.`);

  const values = {};
  for (const field of ["make", "model", "fuel", "region", "category"]) {
    const value = payload[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new HttpError(422, `'${field}' must be a non-empty string.`);
    }
    if (value.trim().length > 80) throw new HttpError(422, `'${field}' must not exceed 80 characters.`);
    values[field] = value.trim().toLowerCase();
  }
  const yearValue = finiteNumber(payload.year);
  const mileage = finiteNumber(payload.mileage);
  const year = yearValue === null ? NaN : Math.trunc(yearValue);
  if (!Number.isInteger(yearValue) || mileage === null) {
    throw new HttpError(422, "'year' and 'mileage' must be numbers.");
  }
  if (year < 1950 || year > new Date().getFullYear()) {
    throw new HttpError(422, `'year' must be between 1950 and ${new Date().getFullYear()}.`);
  }
  if (mileage < 0 || mileage > 2_000_000) {
    throw new HttpError(422, "'mileage' must be between 0 and 2,000,000 km.");
  }
  if (!["petrol", "diesel"].includes(values.fuel)) {
    throw new HttpError(422, "This model was trained only on petrol and diesel vehicles.");
  }
  if (!["chennai", "mumbai"].includes(values.region)) {
    throw new HttpError(422, "This model was trained for Chennai and Mumbai service regions.");
  }
  if (!Object.hasOwn(SERVICE_FEATURES, values.category)) {
    throw new HttpError(
      422,
      "This model supports Regular service, Oil change, Brake service, and Tyre replacement categories.",
    );
  }
  return { values, year, mileage };
}

function predictCost(payload, model = loadServiceModel()) {
  const { values, year, mileage } = validatePrediction(payload);
  const combination = [values.make, values.model, values.fuel];
  const supported = model.metadata.supported_vehicle_combinations || [];
  const isSupported = supported.some((item) =>
    Array.isArray(item) && item.length === combination.length
    && item.every((value, index) => value === combination[index]));
  if (!isSupported) {
    const displaySupported = supported.map(([make, modelName, fuel]) =>
      `${titleCase(make)} ${titleCase(modelName)} (${fuel})`).join(", ");
    throw new HttpError(
      422,
      `${titleCase(values.make)} ${titleCase(values.model)} (${values.fuel}) is not represented in this training data. Supported combinations: ${displaySupported}.`,
    );
  }
  const mileageRange = Math.min(
    100_000,
    Math.max(10_000, Math.ceil(mileage / 10_000) * 10_000),
  );
  const rawFeatures = {
    vehicle_type: "car",
    brand: values.make,
    model: values.model,
    engine_type: values.fuel,
    make_year: year,
    region: values.region,
    mileage_range: mileageRange,
    mileage,
  };
  const baseNumericFeatures = new Set(["make_year", "mileage_range", "mileage"]);
  for (const feature of model.preprocessing.numeric_features) {
    if (!baseNumericFeatures.has(feature)) rawFeatures[feature] = 0;
  }
  Object.assign(rawFeatures, SERVICE_FEATURES[values.category]);
  const numericFeatures = model.preprocessing.numeric_features.map((name, index) => {
    const value = rawFeatures[name];
    return Number.isFinite(value) ? value : model.preprocessing.numeric_medians[index];
  });
  const categoricalFeatures = [];
  for (let featureIndex = 0; featureIndex < model.preprocessing.categorical_features.length; featureIndex += 1) {
    const name = model.preprocessing.categorical_features[featureIndex];
    const value = rawFeatures[name] ?? model.preprocessing.categorical_fill_values[featureIndex];
    categoricalFeatures.push({
      value,
      categories: model.preprocessing.categories[featureIndex],
    });
  }
  const transformedFeatures = [
    ...numericFeatures,
    ...categoricalFeatures.flatMap(({ value, categories }) =>
      categories.map((category) => Number(category === value))),
  ];
  let total = 0;
  for (const tree of model.trees) {
    let node = 0;
    let steps = 0;
    while (tree.children_left[node] !== -1) {
      const featureIndex = tree.feature[node];
      const featureValue = transformedFeatures[featureIndex];
      if (
        !Number.isInteger(featureIndex)
        || featureIndex < 0
        || featureIndex >= transformedFeatures.length
        || !Number.isFinite(featureValue)
      ) {
        throw new Error("The saved tree model references an invalid transformed feature.");
      }
      node = featureValue <= tree.threshold[node]
        ? tree.children_left[node]
        : tree.children_right[node];
      steps += 1;
      if (node < 0 || node >= tree.children_left.length || steps > tree.children_left.length) {
        throw new Error("The saved tree model contains an invalid traversal path.");
      }
    }
    total += tree.value[node];
  }
  let estimate = total / model.trees.length;
  if (!Number.isFinite(estimate)) throw new HttpError(422, "The trained model returned an invalid estimate.");
  estimate = Math.max(0, estimate);
  return {
    estimated_cost: Math.round((estimate + Number.EPSILON) * 100) / 100,
    currency: null,
    cost_unit: "Source dataset units; currency not stated.",
    model: model.metadata.model_name,
    category: values.category,
    vehicle: `${titleCase(values.make)} ${titleCase(values.model)}`,
    note: "Model estimate from the supplied Chennai/Mumbai service dataset. The source currency is not stated; actual service costs vary.",
  };
}

function titleCase(value) {
  return value.replace(/\b\p{L}/gu, (character) => character.toUpperCase());
}

function requestSessionKey(req) {
  const cookieHeader = req.headers.cookie || "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === SESSION_COOKIE) {
      return item.slice(separator + 1).trim();
    }
  }
  return null;
}

function isAllowedOrigin(origin) {
  const allowed = (process.env.ALLOWED_ORIGINS
    || "http://localhost:8000,http://127.0.0.1:8000,http://localhost:5500,http://127.0.0.1:5500")
    .split(",").map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin);
}

function requestOriginAllowed(req, origin) {
  if (isAllowedOrigin(origin)) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",", 1)[0].trim();
  const scheme = (req.headers["x-forwarded-proto"] || "http").split(",", 1)[0].trim();
  return parsed.protocol === `${scheme}:` && parsed.host.toLowerCase() === host.toLowerCase();
}

function originAccepted(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (requestOriginAllowed(req, origin)) return true;
  sendJson(req, res, 403, { error: "Request origin is not allowed." });
  return false;
}

function commonHeaders(req) {
  const headers = {
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
    "Access-Control-Expose-Headers": "X-AutoCare-Data-Initialized",
  };
  const origin = req.headers.origin;
  if (origin && requestOriginAllowed(req, origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers.Vary = "Origin";
  }
  return headers;
}

function sendJson(req, res, status, payload, extraHeaders = {}, cookie = null) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const headers = {
    ...commonHeaders(req),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    ...extraHeaders,
  };
  if (cookie) headers["Set-Cookie"] = cookie;
  res.writeHead(status, headers);
  res.end(body);
}

function cookieValue(req, value, maxAge) {
  let cookie = `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  const forwardedProto = (req.headers["x-forwarded-proto"] || "").split(",", 1)[0].trim();
  if (String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true" || forwardedProto === "https") {
    cookie += "; Secure";
  }
  return cookie;
}

function currentSession(db, req) {
  return getSession(db, requestSessionKey(req));
}

function requireAuthenticated(req, res, session) {
  if (!session || !session.user_id) {
    sendJson(req, res, 401, { error: "Sign in to access this resource." });
    return false;
  }
  return true;
}

function requireCsrf(req, res, session) {
  if (!req.headers["x-csrf-token"] || !constantTimeEqual(session.csrf_token, req.headers["x-csrf-token"])) {
    sendJson(req, res, 403, { error: "CSRF token is missing or invalid. Reload the page and try again." });
    return false;
  }
  return true;
}

function rateLimit(req, route, limit, windowSeconds) {
  const client = req.socket.remoteAddress || "unknown";
  const key = `${client}:${route}`;
  const now = Date.now() / 1000;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.started >= windowSeconds) bucket = { started: now, count: 0 };
  if (bucket.count >= limit) return Math.max(1, Math.floor(windowSeconds - (now - bucket.started)));
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 2048) {
    for (const [oldKey, oldBucket] of rateBuckets) {
      if (now - oldBucket.started >= windowSeconds) rateBuckets.delete(oldKey);
    }
  }
  return null;
}

async function readJson(req, limit) {
  const rawLength = req.headers["content-length"];
  if (rawLength !== undefined && !/^\d+$/u.test(rawLength)) {
    throw new HttpError(400, "Invalid content length.");
  }
  const expectedLength = rawLength === undefined ? 0 : Number(rawLength);
  if (expectedLength > limit) throw new HttpError(400, "Request body is empty or too large.");
  if (req.headers["content-type"]?.toLowerCase().includes("application/json") !== true) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new HttpError(400, "Request body is empty or too large.");
    chunks.push(chunk);
  }
  if (length < 1) throw new HttpError(400, "Request body is empty or too large.");
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must contain valid JSON.");
  }
  if (!isRecord(value) && !Array.isArray(value)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  return value;
}

function requireObject(payload) {
  if (!isRecord(payload)) throw new HttpError(400, "Request body must be a JSON object.");
  return payload;
}

function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, "Invalid URL path.");
  }
  if (pathname === "/") pathname = "/auth.html";
  if (!PUBLIC_FILES.has(pathname)) throw new HttpError(404, "File not found.");
  const filename = path.resolve(PROJECT_DIR, `.${pathname}`);
  if (filename !== PROJECT_DIR && !filename.startsWith(`${PROJECT_DIR}${path.sep}`)) {
    throw new HttpError(404, "File not found.");
  }
  let stat;
  try {
    stat = fs.statSync(filename);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new HttpError(404, "File not found.");
    throw error;
  }
  if (!stat.isFile()) throw new HttpError(404, "File not found.");
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  res.writeHead(200, {
    ...commonHeaders(req),
    "Content-Type": contentTypes[path.extname(filename).toLowerCase()] || "application/octet-stream",
    "Content-Length": stat.size,
  });
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(filename).pipe(res);
}

function healthPayload() {
  const model = loadServiceModel();
  return {
    ready: true,
    runtime: "node",
    model: model.metadata.model_name,
    selected_estimator: model.metadata.selected_estimator,
    source_dataset: model.metadata.source_dataset,
    validation_metrics: model.metadata.selected_test_metrics,
    cost_unit: model.metadata.cost_units,
  };
}

function sendError(req, res, error) {
  if (res.headersSent) {
    res.destroy(error);
    return;
  }
  if (error instanceof HttpError) {
    sendJson(req, res, error.status, { error: error.message }, error.headers);
    return;
  }
  console.error("AutoCare request failed:", error);
  sendJson(req, res, 500, { error: "An unexpected server error occurred." });
}

function createServer(options = {}) {
  const db = openDatabase(options.databasePath || databasePath());
  const server = http.createServer((req, res) => {
    void handleRequest(db, req, res).catch((error) => sendError(req, res, error));
  });
  server.on("close", () => db.close());
  return server;
}

async function handleRequest(db, req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    throw new HttpError(400, "Invalid request URL.");
  }
  const pathname = url.pathname;
  if (req.method === "OPTIONS") {
    if (!req.headers.origin || !requestOriginAllowed(req, req.headers.origin)) {
      sendJson(req, res, 403, { error: "Request origin is not allowed." });
      return;
    }
    res.writeHead(204, commonHeaders(req));
    res.end();
    return;
  }
  if (!pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(404, "Route not found.");
    serveStatic(req, res, url);
    return;
  }
  if (!originAccepted(req, res)) return;

  if (req.method === "GET" && pathname === "/api/auth/csrf") {
    let session = currentSession(db, req);
    let cookie = null;
    if (!session) {
      const created = createAnonymousSession(db);
      session = getSession(db, created.sessionKey);
      cookie = cookieValue(req, created.sessionKey, SESSION_SECONDS);
    }
    sendJson(req, res, 200, { csrfToken: session.csrf_token }, {}, cookie);
    return;
  }
  if (req.method === "GET" && pathname === "/api/auth/session") {
    let session = currentSession(db, req);
    let cookie = null;
    if (!session) {
      const created = createAnonymousSession(db);
      session = getSession(db, created.sessionKey);
      cookie = cookieValue(req, created.sessionKey, SESSION_SECONDS);
    }
    const result = {
      authenticated: Boolean(session.user_id),
      csrfToken: session.csrf_token,
    };
    if (session.user_id) {
      result.user = {
        id: session.user_id,
        name: session.full_name,
        email: session.email,
      };
    }
    sendJson(req, res, 200, result, {}, cookie);
    return;
  }
  if (req.method === "GET" && pathname === "/api/health") {
    try {
      sendJson(req, res, 200, healthPayload());
    } catch (error) {
      sendJson(req, res, 503, { ready: false, error: error.message });
    }
    return;
  }
  if (req.method === "GET" && pathname === "/api/data") {
    const session = currentSession(db, req);
    if (!requireAuthenticated(req, res, session)) return;
    const initialized = userDataInitialized(db, session.user_id);
    sendJson(req, res, 200, getUserData(db, session.user_id), {
      "X-AutoCare-Data-Initialized": String(initialized),
    });
    return;
  }
  if (req.method === "PUT" && pathname === "/api/data") {
    const session = currentSession(db, req);
    if (!requireAuthenticated(req, res, session) || !requireCsrf(req, res, session)) return;
    const body = await readJson(req, MAX_DATA_BODY_BYTES);
    sendJson(req, res, 200, saveUserData(db, session.user_id, body));
    return;
  }
  if (req.method === "POST" && pathname === "/api/auth/register") {
    await handleRegister(db, req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/auth/login") {
    await handleLogin(db, req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const session = currentSession(db, req);
    if (session && !requireCsrf(req, res, session)) return;
    if (session) db.prepare("DELETE FROM auth_sessions WHERE session_hash = ?").run(session.session_hash);
    sendJson(req, res, 200, { message: "Signed out." }, {}, cookieValue(req, "", 0));
    return;
  }
  if (req.method === "POST" && pathname === "/api/predict-cost") {
    const session = currentSession(db, req);
    if (!requireAuthenticated(req, res, session) || !requireCsrf(req, res, session)) return;
    const body = await readJson(req, MAX_PREDICTION_BODY_BYTES);
    sendJson(req, res, 200, predictCost(body));
    return;
  }
  throw new HttpError(404, "Route not found.");
}

async function authenticateRequest(db, req, route, limit, windowSeconds) {
  const retryAfter = rateLimit(req, route, limit, windowSeconds);
  if (retryAfter !== null) {
    throw new HttpError(429, "Too many requests. Wait before trying again.", { "Retry-After": String(retryAfter) });
  }
  const session = currentSession(db, req);
  if (!session) throw new HttpError(403, "Session expired. Reload the page and try again.");
  if (!constantTimeEqual(session.csrf_token, req.headers["x-csrf-token"])) {
    throw new HttpError(403, "CSRF token is missing or invalid. Reload the page and try again.");
  }
  return { session, payload: requireObject(await readJson(req, MAX_AUTH_BODY_BYTES)) };
}

async function handleRegister(db, req, res) {
  const { payload } = await authenticateRequest(db, req, "/api/auth/register", 5, 3600);
  if (payload.password !== payload.confirm_password) throw new HttpError(400, "Passwords do not match.");
  createUser(db, payload.full_name, payload.email, payload.password);
  sendJson(req, res, 201, { message: "Account created. You can now sign in." });
}

async function handleLogin(db, req, res) {
  const { session, payload } = await authenticateRequest(db, req, "/api/auth/login", 10, 900);
  const user = authenticateUser(db, payload.email, payload.password);
  const nextSession = rotateSession(db, session.session_hash, user.id);
  sendJson(req, res, 200, {
    message: "Signed in.",
    csrfToken: nextSession.csrfToken,
    user: { id: user.id, name: user.full_name, email: user.email },
  }, {}, cookieValue(req, nextSession.sessionKey, SESSION_SECONDS));
}

function main() {
  let server;
  try {
    server = createServer();
    server.listen(PORT, HOST, () => {
      console.log(`AutoCare JavaScript server listening at http://${HOST}:${PORT}`);
      console.log(`Health check: http://${HOST}:${PORT}/api/health`);
    });
  } catch (error) {
    console.error(`Could not start AutoCare on ${HOST}:${PORT}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  server.on("error", (error) => {
    console.error(`Could not start AutoCare on ${HOST}:${PORT}: ${error.message}`);
    process.exitCode = 1;
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) main();

module.exports = {
  createServer,
  initializeDatabase,
  predictCost,
  validatePrediction,
  validateUserData,
};
