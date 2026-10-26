(() => {
  "use strict";

  const isLiveServer = window.location.port === "5500"
    && ["127.0.0.1", "localhost"].includes(window.location.hostname);
  const API_ORIGIN = window.AUTOCARE_API_ORIGIN
    || (isLiveServer
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : window.location.origin);
  const API_URL = `${API_ORIGIN}/api`;
  const $ = (selector) => document.querySelector(selector);
  let csrfToken = "";

  function showMessage(message, kind = "info") {
    const element = $("#auth-message");
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = false;
  }

  function messageForError(error) {
    return error instanceof TypeError
      ? "Could not connect to AutoCare. Check that the AutoCare server is running and try again."
      : error.message || "The request could not be completed.";
  }

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

  function setMode(mode) {
    const isLogin = mode === "login";
    $("#login-panel").hidden = !isLogin;
    $("#register-panel").hidden = isLogin;
    $("#auth-title").innerHTML = isLogin
      ? 'Welcome back<span class="title-period">.</span>'
      : 'A better ride starts here<span class="title-period">.</span>';
    $("#auth-subtitle").textContent = isLogin
      ? "Sign in to continue to your dashboard."
      : "Create an account to keep your vehicle records together.";
  }

  async function request(path, { method = "GET", body } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      if (!csrfToken) await refreshCsrf();
      headers["X-CSRF-Token"] = csrfToken;
    }
    const response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  }

  async function refreshCsrf() {
    const response = await fetch(`${API_URL}/auth/csrf`, { credentials: "include" });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || "Could not start a secure session.");
    csrfToken = result.csrfToken;
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      const formData = new FormData(form);
      const result = await request("/auth/login", {
        method: "POST",
        body: { email: formData.get("email"), password: formData.get("password") }
      });
      csrfToken = result.csrfToken;
      window.location.replace("index.html");
    } catch (error) {
      showMessage(messageForError(error), "error");
    } finally {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }

  async function handleRegistration(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    if (formData.get("password") !== formData.get("confirm_password")) {
      showMessage("Passwords do not match.", "error");
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.textContent = "Creating account…";
    try {
      const result = await request("/auth/register", {
        method: "POST",
        body: {
          full_name: formData.get("full_name"),
          email: formData.get("email"),
          password: formData.get("password"),
          confirm_password: formData.get("confirm_password")
        }
      });
      form.reset();
      setMode("login");
      showMessage(result.message, "success");
    } catch (error) {
      showMessage(messageForError(error), "error");
    } finally {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }

  async function init() {
    document.querySelectorAll("[data-show-register]").forEach((button) => {
      button.addEventListener("click", () => setMode("register"));
    });
    document.querySelectorAll("[data-show-login]").forEach((button) => {
      button.addEventListener("click", () => setMode("login"));
    });
    $("#login-panel").addEventListener("submit", handleLogin);
    $("#register-panel").addEventListener("submit", handleRegistration);

    const error = new URLSearchParams(window.location.search).get("error");
    if (error) {
      const messages = {
        offline: "Could not connect to AutoCare. Start or restart the AutoCare server, then try again.",
        authentication: "Could not validate your session. Please sign in again.",
        session: "Your session has expired. Please sign in again."
      };
      showMessage(messages[error] || error, "error");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    try {
      const session = await request("/auth/session");
      csrfToken = session.csrfToken;
      if (session.authenticated) window.location.replace("index.html");
    } catch (error) {
      showMessage(messageForError(error), "error");
    }
  }

  init().catch((error) => {
    console.error("Could not initialize account access.", error);
    showMessage("Could not connect to AutoCare. Check that the AutoCare server is running.", "error");
  });
})();
