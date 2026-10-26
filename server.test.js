"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createServer, predictCost } = require("./server");

let temporaryDirectory;
let server;
let baseUrl;
let csrfToken;
let cookie;

async function request(route, { method = "GET", body, token = csrfToken, origin = baseUrl } = {}) {
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token && !["GET", "HEAD", "OPTIONS"].includes(method)) headers["X-CSRF-Token"] = token;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}

before(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "autocare-node-test-"));
  server = createServer({ databasePath: path.join(temporaryDirectory, "test.sqlite3") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.ALLOWED_ORIGINS = `${baseUrl},http://127.0.0.1:5500,http://localhost:5500`;
  const response = await request("/api/auth/csrf");
  assert.equal(response.status, 200);
  csrfToken = response.body.csrfToken;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("serves the sign-in page and reports a ready JavaScript model", async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sign in — AutoCare/u);

  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.runtime, "node");
  assert.equal(health.body.ready, true);
  assert.equal(health.body.model, "vehicle_service_cost");
  assert.equal(health.body.selected_estimator, "RandomForest");
  assert.match(health.body.cost_unit, /currency is not stated/u);
  assert.equal(health.body.source_dataset, "Vehicle Maintenance- Service Records.csv");
  assert.equal((await fetch(`${baseUrl}/autocare.sqlite3`)).status, 404);

  const liveServerRequest = await request("/api/auth/session", { origin: "http://127.0.0.1:5500" });
  assert.equal(liveServerRequest.status, 200);
  assert.equal(liveServerRequest.headers.get("access-control-allow-origin"), "http://127.0.0.1:5500");
  const localhostLiveServerRequest = await request("/api/auth/session", { origin: "http://localhost:5500" });
  assert.equal(localhostLiveServerRequest.status, 200);
  assert.equal(localhostLiveServerRequest.headers.get("access-control-allow-origin"), "http://localhost:5500");
});

test("registers, authenticates, persists account data, and logs out", async () => {
  const unauthenticated = await request("/api/data");
  assert.equal(unauthenticated.status, 401);
  assert.equal((await request("/api/predict-cost", { method: "POST", body: {} })).status, 401);

  const registered = await request("/api/auth/register", {
    method: "POST",
    body: {
      full_name: "Test Driver",
      email: "Driver@Example.Test",
      password: "a-long-test-password",
      confirm_password: "a-long-test-password",
    },
  });
  assert.equal(registered.status, 201);

  const duplicate = await request("/api/auth/register", {
    method: "POST",
    body: {
      full_name: "Test Driver",
      email: "driver@example.test",
      password: "a-long-test-password",
      confirm_password: "a-long-test-password",
    },
  });
  assert.equal(duplicate.status, 409);

  const unknownUser = await request("/api/auth/login", {
    method: "POST",
    body: { email: "unknown@example.test", password: "a-long-test-password" },
  });
  assert.equal(unknownUser.status, 401);
  assert.equal(unknownUser.body.error, "Email or password is incorrect.");

  const wrongPassword = await request("/api/auth/login", {
    method: "POST",
    body: { email: "driver@example.test", password: "incorrect-password" },
  });
  assert.equal(wrongPassword.status, 401);

  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: "driver@example.test", password: "a-long-test-password" },
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/u);
  assert.match(login.headers.get("set-cookie"), /SameSite=Lax/u);
  csrfToken = login.body.csrfToken;

  const session = await request("/api/auth/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.user.name, "Test Driver");

  const estimate = await request("/api/predict-cost", {
    method: "POST",
    body: {
      make: "Honda",
      model: "City",
      fuel: "Petrol",
      year: 2022,
      mileage: 23_000,
      region: "Chennai",
      category: "Oil change",
    },
  });
  assert.equal(estimate.status, 200);
  assert.ok(Number.isFinite(estimate.body.estimated_cost));
  assert.equal(estimate.body.vehicle, "Honda City");
  assert.equal(estimate.body.currency, null);
  assert.match(estimate.body.cost_unit, /currency not stated/u);
  assert.deepEqual(Object.keys(estimate.body).sort(), [
    "category",
    "cost_unit",
    "currency",
    "estimated_cost",
    "model",
    "note",
    "vehicle",
  ]);

  const vehicle = {
    id: "car-a",
    make: "Honda",
    model: "City",
    year: new Date().getFullYear(),
    fuel: "Petrol",
    mileage: 23_000,
    selected: true,
  };
  const saved = await request("/api/data", {
    method: "PUT",
    body: { vehicles: [vehicle], services: [], reminders: [] },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.vehicles[0].id, "car-a");
  assert.equal(saved.headers.get("x-autocare-data-initialized"), null);

  const read = await request("/api/data");
  assert.equal(read.status, 200);
  assert.equal(read.body.vehicles[0].id, "car-a");
  assert.equal(read.headers.get("x-autocare-data-initialized"), "true");

  const logout = await request("/api/auth/logout", { method: "POST", body: {} });
  assert.equal(logout.status, 200);
  assert.equal(logout.headers.get("set-cookie").includes("Max-Age=0"), true);
  assert.equal((await request("/api/data")).status, 401);
});

test("rejects invalid origins, missing CSRF tokens, and invalid dashboard records", async () => {
  const deniedOrigin = await request("/api/auth/session", { origin: "https://attacker.example" });
  assert.equal(deniedOrigin.status, 403);

  const csrf = await request("/api/auth/csrf");
  csrfToken = csrf.body.csrfToken;
  const register = await request("/api/auth/register", {
    method: "POST",
    token: "",
    body: {
      full_name: "Another Driver",
      email: "another@example.test",
      password: "a-long-test-password",
      confirm_password: "a-long-test-password",
    },
  });
  assert.equal(register.status, 403);

  const loggedIn = await request("/api/auth/login", {
    method: "POST",
    body: { email: "driver@example.test", password: "a-long-test-password" },
  });
  csrfToken = loggedIn.body.csrfToken;
  const invalidData = await request("/api/data", {
    method: "PUT",
    body: { vehicles: [], services: [{ vehicleId: "missing" }], reminders: [] },
  });
  assert.equal(invalidData.status, 400);

  const invalidPrediction = await request("/api/predict-cost", {
    method: "POST",
    body: { make: "Unsupported", model: "Vehicle", fuel: "Petrol", year: 2020, mileage: 10, region: "Chennai", category: "Oil change" },
  });
  assert.equal(invalidPrediction.status, 422);
});

test("runs the exported model using supported vehicle and service inputs", () => {
  const prediction = predictCost({
    make: "Toyota",
    model: "Fortuner",
    fuel: "Diesel",
    year: 2020,
    mileage: 43_500,
    region: "Mumbai",
    category: "Regular service",
  });
  assert.equal(prediction.currency, null);
  assert.match(prediction.cost_unit, /currency not stated/u);
  assert.equal(prediction.vehicle, "Toyota Fortuner");
  assert.equal(prediction.category, "regular service");
  assert.ok(Number.isFinite(prediction.estimated_cost));
  assert.ok(prediction.estimated_cost >= 0);
});
