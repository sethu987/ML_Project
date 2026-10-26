(() => {
  "use strict";

  const isLiveServer = window.location.port === "5500"
    && ["127.0.0.1", "localhost"].includes(window.location.hostname);
  const API_ORIGIN = window.AUTOCARE_API_ORIGIN
    || (isLiveServer
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : window.location.origin);
  const API_URL = `${API_ORIGIN}/api`;
  const LEGACY_STORAGE_KEY = "autocare-dashboard-v1";
  const LEGACY_MIGRATION_KEY = "autocare-legacy-import-v1";
  const ACTIVE_SECTION_KEY = "autocare-active-section";
  const categories = ["Regular service", "Oil change", "Brake service", "Tyre replacement", "Battery", "Repair", "Other"];
  const categoryColors = ["#20a997", "#5a79d6", "#efaa55", "#a187d4", "#e47a78", "#4c9cc1", "#96a6b1"];
  let state = { vehicles: [], services: [], reminders: [] };
  let persistedState = state;
  let csrfToken = "";
  let saveQueue = Promise.resolve();
  let dataInitialized = false;
  let toastTimer;
  let predictionInProgress = false;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const money = (value) => new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0
  }).format(Number(value) || 0);
  const sourceCost = (value) => new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
  const formatDate = (value) => value ? new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric"
  }).format(new Date(`${value}T00:00:00`)) : "—";
  const dateToISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const todayISO = () => dateToISO(new Date());
  const vehicleName = (vehicleId) => {
    const vehicle = state.vehicles.find((item) => item.id === vehicleId);
    return vehicle ? `${vehicle.make} ${vehicle.model}` : "Vehicle removed";
  };
  const selectedVehicle = () => state.vehicles.find((vehicle) => vehicle.selected) || state.vehicles[0] || null;
  const createId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  async function readJson(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        "AutoCare received a non-JSON response. Start the JavaScript backend on port 8000 and reload this page."
      );
    }
  }

  async function apiRequest(path, options = {}) {
    const method = options.method || "GET";
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers["X-CSRF-Token"] = csrfToken;
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      method,
      headers,
      credentials: "include",
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (path === "/data" && method === "GET") {
      dataInitialized = response.headers.get("X-AutoCare-Data-Initialized") === "true";
    }
    const result = await readJson(response);
    if (response.status === 401 && path !== "/auth/session") {
      const sessionResponse = await fetch(`${API_URL}/auth/session`, { credentials: "include" });
      const session = await readJson(sessionResponse);
      if (!sessionResponse.ok) {
        throw new Error(session.error || `Session check failed (${sessionResponse.status}).`);
      }
      if (!session.authenticated) {
        window.location.replace("auth.html?error=session");
      }
    }
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  }

  async function init() {
    const session = await apiRequest("/auth/session");
    if (!session.authenticated) {
      window.location.replace("auth.html");
      return;
    }
    csrfToken = session.csrfToken;
    $("#current-user-name").textContent = session.user.name;
    $("#current-user-email").textContent = session.user.email;
    const userInitial = session.user.name.trim().charAt(0).toUpperCase();
    $("#top-user-avatar").textContent = userInitial;
    $("#profile-avatar").textContent = userInitial;
    state = await apiRequest("/data");
    await offerLegacyImport(session.user.email);
    persistedState = JSON.parse(JSON.stringify(state));
    $("#today-date").textContent = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(new Date());
    $('#vehicle-form [name="year"]').max = new Date().getFullYear();
    $('#service-form [name="date"]').max = todayISO();
    $('#reminder-form [name="dueDate"]').min = todayISO();
    bindNavigation();
    bindForms();
    bindActions();
    renderAll();
    renderSavedPrediction();
    let initialSection = window.location.hash.slice(1);
    if (!initialSection) {
      try {
        initialSection = sessionStorage.getItem(ACTIVE_SECTION_KEY) || "dashboard";
      } catch (error) {
        console.warn("Could not restore the last open dashboard section.", error);
        initialSection = "dashboard";
      }
    }
    navigateTo(initialSection);
    $("#logout-button").addEventListener("click", logout);
    $("#prediction-vehicle").addEventListener("change", () => updatePredictionMileage(true));
    window.addEventListener("resize", debounce(renderCharts, 150));
    document.body.classList.remove("dashboard-locked");
  }

  async function offerLegacyImport(email) {
    if (dataInitialized) return;
    let legacy;
    try {
      if (localStorage.getItem(LEGACY_MIGRATION_KEY)) return;
      const saved = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!saved) return;
      legacy = JSON.parse(saved);
    } catch (error) {
      console.error("Could not read saved browser dashboard data.", error);
      showToast("Older browser data could not be read. Your saved data has not been changed.");
      return;
    }
    if (!legacy || !["vehicles", "services", "reminders"].every((key) => Array.isArray(legacy[key]))) {
      return;
    }
    if (!legacy.vehicles.length && !legacy.services.length && !legacy.reminders.length) return;

    const importData = {
      vehicles: legacy.vehicles,
      services: legacy.services,
      reminders: legacy.reminders
    };
    const estimate = Number(localStorage.getItem(`${LEGACY_STORAGE_KEY}-last-estimate`));
    const estimateVehicle = localStorage.getItem(`${LEGACY_STORAGE_KEY}-estimate-vehicle`);
    const estimateCategory = localStorage.getItem(`${LEGACY_STORAGE_KEY}-estimate-category`);
    if (Number.isFinite(estimate) && estimate >= 0
        && importData.vehicles.some((vehicle) => vehicle && vehicle.id === estimateVehicle)
        && typeof estimateCategory === "string") {
      importData.lastEstimate = {
        amount: estimate,
        vehicleId: estimateVehicle,
        category: estimateCategory
      };
    }

    const shouldImport = window.confirm(
      `This browser has older AutoCare records. Import them into the account for ${email}? ` +
      "Only continue if these records belong to you. Your existing browser copy will be kept."
    );
    if (!shouldImport) {
      try {
        localStorage.setItem(LEGACY_MIGRATION_KEY, "declined");
      } catch (error) {
        console.warn("Could not save the browser-data migration choice.", error);
      }
      return;
    }
    try {
      state = await apiRequest("/data", { method: "PUT", body: importData });
      dataInitialized = true;
      try {
        localStorage.setItem(LEGACY_MIGRATION_KEY, "imported");
      } catch (error) {
        console.warn("Could not save the browser-data migration status.", error);
      }
      showToast("Your older dashboard records were imported into this account.");
    } catch (error) {
      console.error("Could not import older browser dashboard data.", error);
      showToast(`Older records were not imported: ${error.message}`);
    }
  }

  async function logout() {
    try {
      await apiRequest("/auth/logout", { method: "POST", body: {} });
      try {
        sessionStorage.removeItem(ACTIVE_SECTION_KEY);
      } catch (error) {
        console.warn("Could not clear the last open dashboard section.", error);
      }
      window.location.replace("auth.html");
    } catch (error) {
      showToast(error.message);
    }
  }

  function bindNavigation() {
    $$("[data-section]").forEach((button) => button.addEventListener("click", () => navigateTo(button.dataset.section)));
    $$("[data-go]").forEach((button) => button.addEventListener("click", () => navigateTo(button.dataset.go)));
  }

  function navigateTo(section) {
    const titles = { dashboard: "Dashboard", vehicles: "My Vehicles", predictions: "Predictions", history: "Service History", analytics: "Cost Analytics", reminders: "Reminders" };
    if (!titles[section]) return;
    $$(".page-section").forEach((item) => item.classList.toggle("active", item.id === `section-${section}`));
    $$("[data-section]").forEach((item) => {
      const active = item.dataset.section === section;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    $("#page-title").textContent = titles[section];
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${section}`);
    try {
      sessionStorage.setItem(ACTIVE_SECTION_KEY, section);
    } catch (error) {
      console.warn("Could not save the last open dashboard section.", error);
    }
    window.scrollTo(0, 0);
    if (section === "analytics" || section === "dashboard") requestAnimationFrame(renderCharts);
  }

  function bindActions() {
    document.addEventListener("click", (event) => {
      const openButton = event.target.closest("[data-open]");
      if (openButton) openDialog(openButton.dataset.open);
      const closeButton = event.target.closest("[data-close]");
      if (closeButton) closeButton.closest("dialog").close();

      const editVehicle = event.target.closest("[data-edit-vehicle]");
      if (editVehicle) openVehicleEditor(editVehicle.dataset.editVehicle);
      const deleteVehicle = event.target.closest("[data-delete-vehicle]");
      if (deleteVehicle) deleteVehicleRecord(deleteVehicle.dataset.deleteVehicle);
      const chooseVehicle = event.target.closest("[data-select-vehicle]");
      if (chooseVehicle) selectVehicle(chooseVehicle.dataset.selectVehicle);
      const editService = event.target.closest("[data-edit-service]");
      if (editService) openServiceEditor(editService.dataset.editService);
      const deleteService = event.target.closest("[data-delete-service]");
      if (deleteService) deleteServiceRecord(deleteService.dataset.deleteService);
      const deleteReminder = event.target.closest("[data-delete-reminder]");
      if (deleteReminder) deleteReminderRecord(deleteReminder.dataset.deleteReminder);
      if (event.target.closest("#prediction-reminder")) {
        const predictionForm = $("#prediction-form");
        const vehicleId = predictionForm.elements.vehicleId.value;
        const category = predictionForm.elements.category.value;
        if (vehicleId && category) {
          openDialog("reminder");
          $("#reminder-form").elements.vehicleId.value = vehicleId;
          $("#reminder-form").elements.title.value = category;
          $("#reminder-form").elements.dueDate.focus();
        }
      }
    });
    $("#service-search").addEventListener("input", renderServiceTable);
    $("#service-vehicle-filter").addEventListener("change", renderServiceTable);
    $("#service-category-filter").addEventListener("change", renderServiceTable);
    ["vehicle-dialog", "service-dialog", "reminder-dialog"].forEach((id) => {
      const dialog = $(`#${id}`);
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    });
  }

  function bindForms() {
    $("#vehicle-form").addEventListener("submit", saveVehicle);
    $("#service-form").addEventListener("submit", saveService);
    $("#reminder-form").addEventListener("submit", saveReminder);
    $("#prediction-form").addEventListener("submit", runPrediction);
  }

  function renderAll() {
    renderVehicleOptions();
    renderDashboard();
    renderVehicles();
    renderServiceFilters();
    renderServiceTable();
    renderReminders();
    renderAnalytics();
    updateNavCounts();
  }

  function renderSavedPrediction() {
    const estimate = state.lastEstimate;
    if (!estimate || !Number.isFinite(Number(estimate.amount))) return;

    const category = String(estimate.category);
    const vehicle = vehicleName(estimate.vehicleId);
    $("#result-amount").textContent = money(estimate.amount);
    $("#result-hint").textContent = `${vehicle} · ${category}`;
    $("#result-explanation").textContent =
      `This saved estimate was generated for your ${vehicle}, ${category.toLowerCase()} service. It is a planning estimate, not an itemized quote or vehicle diagnosis.`;
    $("#result-recommendation").textContent = recommendationFor(category);
    $("#prediction-status").textContent = "Showing your latest saved estimate.";
    $("#prediction-reminder").disabled = !state.vehicles.some((item) => item.id === estimate.vehicleId);
  }

  function updateNavCounts() {
    $("#vehicle-nav-count").textContent = state.vehicles.length;
    const today = todayISO();
    $("#reminder-nav-count").textContent = state.reminders.filter((item) => item.dueDate >= today).length;
  }

  function renderDashboard() {
    const vehicle = selectedVehicle();
    const total = state.services.reduce((sum, service) => sum + Number(service.cost || 0), 0);
    $("#total-expenses").textContent = money(total);
    $("#chart-total").textContent = money(total);
    $("#hero-vehicle-name").textContent = vehicle ? `${vehicle.make} ${vehicle.model}` : "Your garage is ready";
    $("#hero-vehicle-meta").textContent = vehicle ? `${vehicle.year} · ${vehicle.fuel} · Your selected vehicle` : "Add a vehicle to start keeping track.";
    $("#hero-vehicle-stats").innerHTML = vehicle ? `<div><strong>${Number(vehicle.mileage).toLocaleString("en-IN")}</strong><span>KM DRIVEN</span></div><i></i><div><strong>${escapeHtml(vehicle.fuel)}</strong><span>FUEL TYPE</span></div><i></i><div><strong>${state.vehicles.length}</strong><span>IN GARAGE</span></div>` : "";
    const recentServices = [...state.services]
      .filter((service) => !vehicle || service.vehicleId === vehicle.id)
      .sort((a, b) => b.date.localeCompare(a.date));
    const last = recentServices[0];
    $("#last-service-content").innerHTML = last ? `<div class="last-service-icon">✓</div><div class="last-service-details"><strong>${escapeHtml(last.category)}</strong><span>${escapeHtml(vehicleName(last.vehicleId))} · ${Number(last.mileage).toLocaleString("en-IN")} km</span></div><div class="last-service-cost"><strong>${money(last.cost)}</strong><span>${formatDate(last.date)}</span></div>` : `<div class="empty-inline">No services recorded yet.</div>`;
    const today = todayISO();
    const orderedReminders = [...state.reminders]
      .filter((reminder) => reminder.dueDate >= today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 3);
    $("#dashboard-reminders").innerHTML = orderedReminders.length ? orderedReminders.map((reminder) => `<div class="mini-reminder"><span class="reminder-date-block"><strong>${new Date(`${reminder.dueDate}T00:00:00`).getDate()}</strong><small>${new Intl.DateTimeFormat("en-IN", { month: "short" }).format(new Date(`${reminder.dueDate}T00:00:00`)).toUpperCase()}</small></span><span class="mini-reminder-copy"><strong>${escapeHtml(reminder.title)}</strong><small>${escapeHtml(vehicleName(reminder.vehicleId))}</small></span><span class="mini-reminder-status ${reminderStatus(reminder.dueDate).className}">${reminderStatus(reminder.dueDate).label}</span></div>`).join("") : `<div class="empty-inline">No upcoming reminders. Enjoy the open road.</div>`;
    renderCharts();
  }

  function renderVehicles() {
    const container = $("#vehicle-grid");
    if (!state.vehicles.length) {
      container.innerHTML = `<article class="card empty-card"><span class="empty-icon">🚘</span><h3>Your garage is empty</h3><p>Add your first vehicle to keep its maintenance details in one place.</p><button class="button button-primary" data-open="vehicle">＋ Add your first vehicle</button></article>`;
      return;
    }
    container.innerHTML = state.vehicles.map((vehicle, index) => {
      const latest = [...state.services].filter((service) => service.vehicleId === vehicle.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      const expense = state.services.filter((service) => service.vehicleId === vehicle.id).reduce((sum, service) => sum + Number(service.cost || 0), 0);
      return `<article class="card vehicle-card ${vehicle.selected ? "selected-vehicle" : ""}"><div class="vehicle-card-top"><span class="vehicle-icon vehicle-tone-${index % 4}"><svg viewBox="0 0 24 24"><path d="m5 11 2-5h10l2 5M4 11h16v7H4zM7 18v2m10-2v2M7 14h.01M17 14h.01"/></svg></span><div class="vehicle-actions"><button class="tiny-icon-button" data-edit-vehicle="${escapeHtml(vehicle.id)}" aria-label="Edit ${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)}">✎</button><button class="tiny-icon-button danger-text" data-delete-vehicle="${escapeHtml(vehicle.id)}" aria-label="Delete ${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)}">×</button></div></div><div class="vehicle-name-row"><div><span class="vehicle-year">${escapeHtml(vehicle.year)} · ${escapeHtml(vehicle.fuel)}</span><h3>${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)}</h3></div>${vehicle.selected ? '<span class="selected-pill">SELECTED</span>' : ""}</div><div class="vehicle-details"><div><span>CURRENT MILEAGE</span><strong>${Number(vehicle.mileage).toLocaleString("en-IN")} <small>km</small></strong></div><div><span>RECORDED SPEND</span><strong>${money(expense)}</strong></div></div><div class="vehicle-card-footer"><span>${latest ? `Last service · ${formatDate(latest.date)}` : "No service records yet"}</span>${vehicle.selected ? '<span class="selected-label">Current vehicle ✓</span>' : `<button class="text-button" data-select-vehicle="${escapeHtml(vehicle.id)}">Select vehicle →</button>`}</div></article>`;
    }).join("");
  }

  function renderVehicleOptions() {
    const optionHtml = state.vehicles.map((vehicle) => `<option value="${escapeHtml(vehicle.id)}">${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)} (${escapeHtml(vehicle.year)})</option>`).join("");
    ["#prediction-vehicle", '#service-form select[name="vehicleId"]', '#reminder-form select[name="vehicleId"]'].forEach((selector) => {
      const select = $(selector);
      const previous = select.value;
      select.innerHTML = state.vehicles.length ? optionHtml : '<option value="">Add a vehicle first</option>';
      select.disabled = !state.vehicles.length;
      if (state.vehicles.some((vehicle) => vehicle.id === previous)) select.value = previous;
      else if (selectedVehicle()) select.value = selectedVehicle().id;
    });
    updatePredictionMileage();
  }

  function updatePredictionMileage(force = false) {
    const vehicle = state.vehicles.find((item) => item.id === $("#prediction-vehicle").value);
    const mileageInput = $('#prediction-form [name="mileage"]');
    if (vehicle && (force || !mileageInput.value)) mileageInput.value = vehicle.mileage;
  }

  function renderServiceFilters() {
    const vehicleFilter = $("#service-vehicle-filter");
    const selectedVehicleId = vehicleFilter.value;
    vehicleFilter.innerHTML = `<option value="">All vehicles</option>${state.vehicles.map((vehicle) => `<option value="${escapeHtml(vehicle.id)}">${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)}</option>`).join("")}`;
    if (state.vehicles.some((vehicle) => vehicle.id === selectedVehicleId)) vehicleFilter.value = selectedVehicleId;
    const categoryFilter = $("#service-category-filter");
    const selectedCategory = categoryFilter.value;
    const usedCategories = [...new Set(state.services.map((service) => service.category))].sort();
    categoryFilter.innerHTML = `<option value="">All categories</option>${usedCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
    if (usedCategories.includes(selectedCategory)) categoryFilter.value = selectedCategory;
  }

  function renderServiceTable() {
    const query = $("#service-search").value.trim().toLowerCase();
    const vehicleId = $("#service-vehicle-filter").value;
    const category = $("#service-category-filter").value;
    const results = [...state.services].filter((service) => {
      const searchable = `${service.category} ${vehicleName(service.vehicleId)} ${service.notes || ""}`.toLowerCase();
      return (!query || searchable.includes(query)) && (!vehicleId || service.vehicleId === vehicleId) && (!category || service.category === category);
    }).sort((a, b) => b.date.localeCompare(a.date));
    $("#service-record-count").textContent = `${results.length} ${results.length === 1 ? "record" : "records"}`;
    $("#service-table-body").innerHTML = results.map((service) => `<tr><td><span class="table-date">${formatDate(service.date)}</span></td><td><span class="table-vehicle"><span class="table-car-dot"></span>${escapeHtml(vehicleName(service.vehicleId))}</span></td><td><span class="category-tag">${escapeHtml(service.category)}</span></td><td>${Number(service.mileage).toLocaleString("en-IN")} km</td><td class="cost-cell">${money(service.cost)}</td><td><div class="row-actions"><button class="row-action" data-edit-service="${escapeHtml(service.id)}" aria-label="Edit service record">✎</button><button class="row-action danger-text" data-delete-service="${escapeHtml(service.id)}" aria-label="Delete service record">×</button></div></td></tr>`).join("");
    $("#service-empty").classList.toggle("hidden", results.length > 0);
    $(".table-scroll").classList.toggle("hidden", results.length === 0);
    if (!results.length) {
      const hasFilters = Boolean(query || vehicleId || category);
      $("#service-empty-title").textContent = hasFilters ? "No matching service records" : "Your service history starts here";
      $("#service-empty-copy").textContent = hasFilters
        ? "Try adjusting or clearing your search and filters."
        : "Log a visit or repair to keep your maintenance costs in one place.";
      $("#service-empty-action").classList.toggle("hidden", hasFilters);
      $("#service-empty-action").dataset.open = state.vehicles.length ? "service" : "vehicle";
      $("#service-empty-action").textContent = state.vehicles.length ? "＋ Log your first service" : "＋ Add a vehicle";
    }
  }

  function renderReminders() {
    const list = $("#reminder-list");
    if (!state.reminders.length) {
      list.innerHTML = `<article class="card empty-card"><span class="empty-icon">◷</span><h3>Nothing on the calendar</h3><p>Add a scheduled reminder when you want to plan a service or renewal.</p><button class="button button-primary" data-open="reminder">＋ Add reminder</button></article>`;
    } else {
      list.innerHTML = [...state.reminders].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((reminder) => {
        const status = reminderStatus(reminder.dueDate);
        const date = new Date(`${reminder.dueDate}T00:00:00`);
        return `<article class="card reminder-card ${status.className}"><div class="reminder-date-block large-date"><strong>${date.getDate()}</strong><small>${new Intl.DateTimeFormat("en-IN", { month: "short" }).format(date).toUpperCase()}</small></div><div class="reminder-main"><div class="reminder-title-row"><h3>${escapeHtml(reminder.title)}</h3><span class="status-pill ${status.className}">${status.label}</span></div><p>${escapeHtml(vehicleName(reminder.vehicleId))} · ${formatDate(reminder.dueDate)}</p>${reminder.notes ? `<span class="reminder-description">${escapeHtml(reminder.notes)}</span>` : ""}</div><button class="row-action danger-text reminder-delete" data-delete-reminder="${escapeHtml(reminder.id)}" aria-label="Delete reminder">×</button></article>`;
      }).join("");
    }
  }

  function reminderStatus(dueDate) {
    const today = todayISO();
    if (dueDate < today) return { label: "Overdue", className: "overdue" };
    if (dueDate === today) return { label: "Due today", className: "due-today" };
    const inAWeek = new Date();
    inAWeek.setDate(inAWeek.getDate() + 7);
    if (dueDate <= dateToISO(inAWeek)) return { label: "Coming up", className: "coming-up" };
    return { label: "Scheduled", className: "scheduled" };
  }

  function renderAnalytics() {
    const total = state.services.reduce((sum, service) => sum + Number(service.cost || 0), 0);
    $("#analytics-total").textContent = money(total);
    $("#analytics-visits").textContent = state.services.length;
    $("#analytics-average").textContent = money(state.services.length ? total / state.services.length : 0);
    const totals = new Map();
    state.services.forEach((service) => totals.set(service.category, (totals.get(service.category) || 0) + Number(service.cost || 0)));
    const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    $("#category-breakdown").innerHTML = entries.length ? entries.map(([category, amount]) => {
      const percent = total ? Math.round(amount / total * 100) : 0;
      const color = categoryColors[categories.indexOf(category)] || categoryColors.at(-1);
      return `<div class="breakdown-item"><div class="breakdown-label"><span><i style="--category-color:${color}"></i>${escapeHtml(category)}</span><strong>${money(amount)}</strong></div><div class="breakdown-track"><span style="width:${percent}%;--category-color:${color}"></span></div><small>${percent}% of recorded spend</small></div>`;
    }).join("") : '<div class="empty-inline">Your category breakdown will appear after you log a service.</div>';

    const latestEstimate = state.lastEstimate;
    const comparison = $("#comparison-content");
    if (latestEstimate && Number.isFinite(Number(latestEstimate.amount)) && Number(latestEstimate.amount) > 0) {
      const vehicleId = latestEstimate.vehicleId;
      const category = latestEstimate.category;
      const match = [...state.services].filter((service) => service.vehicleId === vehicleId && service.category === category).sort((a, b) => b.date.localeCompare(a.date))[0];
      comparison.innerHTML = match ? `<div class="comparison-context">${escapeHtml(vehicleName(vehicleId))} · ${escapeHtml(category)}</div><div class="comparison-row"><span><i class="comparison-dot estimate-dot"></i>Model estimate</span><strong>${money(latestEstimate.amount)}</strong></div><div class="comparison-row"><span><i class="comparison-dot actual-dot"></i>Latest actual</span><strong>${money(match.cost)}</strong></div><p class="comparison-disclaimer">These amounts are shown side by side for context, not as a measure of model accuracy.</p>` : `<div class="comparison-empty"><span class="comparison-graphic">↔</span><strong>No matching actual service yet</strong><p>Your latest model estimate for ${escapeHtml(category)} will appear beside a real cost when you log the same category for this vehicle.</p><span class="comparison-estimate">Latest model estimate · ${money(latestEstimate.amount)}</span></div>`;
    } else {
      comparison.innerHTML = `<div class="comparison-empty"><span class="comparison-graphic">↔</span><strong>No estimates to compare yet</strong><p>Run a model estimate to see it here alongside a matching actual service cost.</p><button class="text-button" data-go="predictions">Go to cost estimator →</button></div>`;
    }
    renderCharts();
  }

  function monthlyTotals() {
    const now = new Date();
    const months = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      months.push({ key, label: new Intl.DateTimeFormat("en-IN", { month: "short" }).format(date), value: 0 });
    }
    const lookup = new Map(months.map((month) => [month.key, month]));
    state.services.forEach((service) => {
      const key = service.date.slice(0, 7);
      if (lookup.has(key)) lookup.get(key).value += Number(service.cost || 0);
    });
    return months;
  }

  function renderCharts() {
    drawBarChart($("#dashboard-chart"), monthlyTotals());
    drawBarChart($("#analytics-chart"), monthlyTotals());
  }

  function drawBarChart(canvas, months) {
    if (!canvas || !canvas.offsetParent) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    const width = bounds.width;
    const height = bounds.height;
    const left = 42;
    const right = 8;
    const top = 12;
    const bottom = 27;
    const plotHeight = height - top - bottom;
    const maxValue = Math.max(...months.map((month) => month.value), 1000);
    const step = Math.pow(10, Math.floor(Math.log10(maxValue)));
    const axisMax = Math.ceil(maxValue / step) * step || 1000;
    const formatter = (value) => value >= 100000 ? `₹${Math.round(value / 100000)}L` : value >= 1000 ? `₹${Math.round(value / 1000)}k` : `₹${value}`;
    context.font = '10px "DM Sans", sans-serif';
    context.textBaseline = "middle";
    for (let tick = 0; tick <= 3; tick += 1) {
      const y = top + plotHeight * tick / 3;
      const value = axisMax * (3 - tick) / 3;
      context.strokeStyle = "#edf1f4";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      context.fillStyle = "#99a5b1";
      context.textAlign = "left";
      context.fillText(formatter(value), 0, y);
    }
    const plotWidth = width - left - right;
    const slot = plotWidth / months.length;
    const barWidth = Math.min(28, slot * 0.46);
    months.forEach((month, index) => {
      const x = left + slot * index + (slot - barWidth) / 2;
      const barHeight = Math.max(month.value ? 3 : 0, plotHeight * month.value / axisMax);
      const gradient = context.createLinearGradient(0, top + plotHeight - barHeight, 0, top + plotHeight);
      gradient.addColorStop(0, "#32bca8");
      gradient.addColorStop(1, "#168f83");
      context.fillStyle = gradient;
      roundedRect(context, x, top + plotHeight - barHeight, barWidth, barHeight, 5);
      context.fill();
      context.fillStyle = "#8794a1";
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(month.label, x + barWidth / 2, height - bottom + 10);
    });
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  async function runPrediction(event) {
    event.preventDefault();
    if (predictionInProgress) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const vehicle = state.vehicles.find((item) => item.id === data.get("vehicleId"));
    if (!vehicle) {
      showToast("Add a vehicle before estimating a maintenance cost.");
      return;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    predictionInProgress = true;
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    $("#prediction-reminder").disabled = true;
    submitButton.innerHTML = '<span class="prediction-spinner" aria-hidden="true"></span> Estimating cost…';
    const status = $("#prediction-status");
    status.setAttribute("role", "status");
    status.textContent = "Contacting the trained model…";
    $("#result-amount").textContent = "—";
    $("#result-hint").textContent = "Getting an estimate for the details you entered…";
    try {
      const result = await apiRequest("/predict-cost", {
        method: "POST",
        body: {
          make: vehicle.make,
          model: vehicle.model,
          fuel: vehicle.fuel,
          year: vehicle.year,
          mileage: Number(data.get("mileage")),
          region: data.get("region"),
          category: data.get("category")
        }
      });
      if (!result || typeof result !== "object") {
        throw new Error("The prediction service returned an invalid response. Please try again.");
      }
      const estimatedCost = Number(result.estimated_cost);
      if (!Number.isFinite(estimatedCost) || estimatedCost < 0
          || typeof result.vehicle !== "string" || !result.vehicle.trim()) {
        throw new Error("The prediction service returned an invalid estimate. Please try again.");
      }
      const category = String(data.get("category"));
      const mileage = Number(data.get("mileage"));
      const region = String(data.get("region"));
      $("#result-amount").textContent = sourceCost(estimatedCost);
      $("#result-hint").textContent = `${result.vehicle} · ${category} · ${mileage.toLocaleString("en-IN")} km · source dataset units (currency not stated)`;
      $("#result-explanation").textContent = `The trained model estimates this cost for your ${result.vehicle} (${vehicle.year}, ${vehicle.fuel}), ${category.toLowerCase()} service, ${mileage.toLocaleString("en-IN")} km and ${region}. It is a planning estimate, not an itemized quote or vehicle diagnosis.`;
      $("#result-recommendation").textContent = recommendationFor(data.get("category"));
      $("#prediction-reminder").disabled = false;
      state.lastEstimate = {
        amount: estimatedCost,
        vehicleId: vehicle.id,
        category
      };
      if (await persistAndRender({ render: false })) {
        renderAnalytics();
        status.setAttribute("role", "status");
        status.textContent = "Estimate ready. Your form details are unchanged; adjust them to estimate again.";
        showToast("Trained model estimate ready. Actual costs may differ.");
      } else {
        status.setAttribute("role", "alert");
        status.textContent = "Estimate generated, but it could not be saved to your account. The result is still shown here.";
      }
    } catch (error) {
      console.error("Could not get a model prediction.", error);
      const message = error instanceof TypeError
        ? "Could not connect to AutoCare. Start the AutoCare server, then try again."
        : error.message || "Could not generate an estimate. Check the details and try again.";
      status.setAttribute("role", "alert");
      status.textContent = message;
      $("#result-hint").textContent = "No estimate was generated. Your form details are unchanged.";
      showToast(message);
    } finally {
      predictionInProgress = false;
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
      submitButton.innerHTML = "<span>✳</span> Estimate maintenance cost";
    }
  }

  function openDialog(type) {
    if (type === "vehicle") {
      $("#vehicle-form").reset();
      $('#vehicle-form [name="id"]').value = "";
      $("#vehicle-dialog-title").textContent = "Add a vehicle";
      $("#vehicle-dialog").showModal();
    } else if (type === "service") {
      if (!state.vehicles.length) {
        showToast("Add a vehicle before logging a service.");
        openDialog("vehicle");
        return;
      }
      $("#service-form").reset();
      $('#service-form [name="id"]').value = "";
      $('#service-form [name="date"]').value = todayISO();
      $("#service-dialog-title").textContent = "Log a service";
      renderVehicleOptions();
      $("#service-dialog").showModal();
    } else if (type === "reminder") {
      if (!state.vehicles.length) {
        showToast("Add a vehicle before setting a reminder.");
        openDialog("vehicle");
        return;
      }
      $("#reminder-form").reset();
      $('#reminder-form [name="dueDate"]').value = todayISO();
      $('#reminder-form [name="dueDate"]').min = todayISO();
      renderVehicleOptions();
      $("#reminder-dialog").showModal();
    }

  }

  function recommendationFor(category) {
    const recommendations = {
      "Regular service": "Check the owner's manual for the next scheduled service and ask the workshop to confirm the included checks.",
      "Oil change": "Confirm the oil grade and replacement interval in the owner's manual or with a qualified workshop.",
      "Brake service": "Have a qualified technician inspect the brakes. If braking feels unsafe, avoid driving and seek professional help.",
      "Tyre replacement": "Confirm tyre size and specification with a tyre professional, and ask them to check alignment and pressure."
    };
    return recommendations[category] || "Compare this estimate with a written workshop quote. Ask a qualified technician to inspect the vehicle before deciding on repairs.";
  }

  function openVehicleEditor(id) {
    const vehicle = state.vehicles.find((item) => item.id === id);
    if (!vehicle) return;
    const form = $("#vehicle-form");
    Object.entries(vehicle).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
    $("#vehicle-dialog-title").textContent = "Edit vehicle";
    $("#vehicle-dialog").showModal();
  }

  async function saveVehicle(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const id = data.get("id");
    const existing = state.vehicles.find((vehicle) => vehicle.id === id);
    const vehicle = {
      id: id || createId("car"), make: data.get("make").trim(), model: data.get("model").trim(),
      year: Number(data.get("year")), fuel: data.get("fuel"), mileage: Number(data.get("mileage")),
      selected: existing ? existing.selected : state.vehicles.length === 0
    };
    if (existing) state.vehicles = state.vehicles.map((item) => item.id === id ? vehicle : item);
    else state.vehicles.push(vehicle);
    if (!(await persistAndRender())) return;
    $("#vehicle-dialog").close();
    showToast(existing ? "Vehicle details updated." : "Vehicle added to your garage.");
  }

  async function deleteVehicleRecord(id) {
    const vehicle = state.vehicles.find((item) => item.id === id);
    if (!vehicle || !window.confirm(`Delete ${vehicle.make} ${vehicle.model}? Its service records and reminders will also be deleted.`)) return;
    state.vehicles = state.vehicles.filter((item) => item.id !== id);
    state.services = state.services.filter((item) => item.vehicleId !== id);
    state.reminders = state.reminders.filter((item) => item.vehicleId !== id);
    if (state.lastEstimate?.vehicleId === id) delete state.lastEstimate;
    if (!state.vehicles.some((item) => item.selected) && state.vehicles.length) state.vehicles[0].selected = true;
    if (!(await persistAndRender())) return;
    showToast("Vehicle and its related records deleted.");
  }

  async function selectVehicle(id) {
    state.vehicles = state.vehicles.map((vehicle) => ({ ...vehicle, selected: vehicle.id === id }));
    if (!(await persistAndRender())) return;
    showToast(`${vehicleName(id)} selected.`);
  }

  function openServiceEditor(id) {
    const service = state.services.find((item) => item.id === id);
    if (!service) return;
    renderVehicleOptions();
    const form = $("#service-form");
    Object.entries(service).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
    $("#service-dialog-title").textContent = "Edit service record";
    $("#service-dialog").showModal();
  }

  async function saveService(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const id = data.get("id");
    const service = {
      id: id || createId("service"), vehicleId: data.get("vehicleId"), date: data.get("date"),
      mileage: Number(data.get("mileage")), category: data.get("category"),
      cost: Number(data.get("cost")), notes: data.get("notes").trim()
    };
    if (id) state.services = state.services.map((item) => item.id === id ? service : item);
    else state.services.push(service);
    if (!(await persistAndRender())) return;
    $("#service-dialog").close();
    showToast(id ? "Service record updated." : "Service record saved.");
  }

  async function deleteServiceRecord(id) {
    if (!state.services.some((item) => item.id === id) || !window.confirm("Delete this service record?")) return;
    state.services = state.services.filter((item) => item.id !== id);
    if (!(await persistAndRender())) return;
    showToast("Service record deleted.");
  }

  async function saveReminder(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    state.reminders.push({
      id: createId("reminder"), vehicleId: data.get("vehicleId"), title: data.get("title").trim(),
      dueDate: data.get("dueDate"), notes: data.get("notes").trim()
    });
    if (!(await persistAndRender())) return;
    $("#reminder-dialog").close();
    showToast("Scheduled reminder added.");
  }

  async function deleteReminderRecord(id) {
    if (!state.reminders.some((item) => item.id === id) || !window.confirm("Delete this reminder?")) return;
    state.reminders = state.reminders.filter((item) => item.id !== id);
    if (!(await persistAndRender())) return;
    showToast("Reminder deleted.");
  }

  async function persistAndRender({ render = true } = {}) {
    try {
      const snapshot = JSON.parse(JSON.stringify(state));
      const pendingWrite = saveQueue.catch(() => {}).then(() =>
        apiRequest("/data", { method: "PUT", body: snapshot })
      );
      saveQueue = pendingWrite;
      state = await pendingWrite;
      dataInitialized = true;
      persistedState = JSON.parse(JSON.stringify(state));
      if (render) renderAll();
      return true;
    } catch (error) {
      console.error("Could not save account dashboard data.", error);
      if (!window.location.pathname.endsWith("auth.html")) {
        showToast(error.message || "Could not save your changes. Try again.");
      }
      state = JSON.parse(JSON.stringify(persistedState));
      if (render) renderAll();
      return false;
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  function debounce(callback, delay) {
    let timer;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    };
  }

  init().catch((error) => {
    console.error("Could not load your AutoCare dashboard.", error);
    const reason = error instanceof TypeError
      ? "offline"
      : error.message || "authentication";
    window.location.replace(`auth.html?error=${encodeURIComponent(reason)}`);
  });
})();
