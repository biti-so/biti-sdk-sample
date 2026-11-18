import { api, devLog, explain, isInBiti, loadSdk, onLog, sdk } from "./client.js";
import { alertBox, app, closeSheet, esc, nextFriday } from "./ui.js";
import { views } from "./views.js";

const ROUTES = [
  ["/", "home"],
  ["/hotel/:id", "hotel"],
  ["/checkout/:id", "checkout"],
  ["/booking/:id", "booking"],
  ["/deposit/:id", "deposit"],
  ["/bookings", "bookings"],
  ["/plan", "plan"],
  ["/wallet", "wallet"],
  ["/connect", "connect"],
];

function match(pathname) {
  for (const [pattern, name] of ROUTES) {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, key) => { keys.push(key); return "([^/]+)"; })}/?$`);
    const found = pathname.match(regex);
    if (found) return { name, params: Object.fromEntries(keys.map((key, index) => [key, decodeURIComponent(found[index + 1])])) };
  }
  return { name: "home", params: {} };
}

const SEARCH_KEY = "daryeel.search";

function loadSearch() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SEARCH_KEY) || "null");
    if (saved && saved.checkIn >= new Date().toISOString().slice(0, 10)) return saved;
  } catch {
    // Private mode or blocked storage: use the defaults.
  }
  return { city: "Mogadishu", checkIn: nextFriday(), nights: 2, guests: 2 };
}

function saveSearch() {
  try {
    sessionStorage.setItem(SEARCH_KEY, JSON.stringify(app.search));
  } catch {
    // Not important enough to fail on.
  }
}

let renderId = 0;

async function render() {
  const id = ++renderId;
  saveSearch();
  closeSheet();
  const root = document.getElementById("view");
  const { name, params } = match(location.pathname);
  root.setAttribute("aria-busy", "true");
  try {
    const view = await views[name](params, new URLSearchParams(location.search));
    if (id !== renderId) return;
    root.innerHTML = view.html;
    view.mount?.(root);
  } catch (error) {
    if (id !== renderId) return;
    root.innerHTML = `${alertBox(explain(error))}<button class="btn sec" data-go="/">Back to hotels</button>`;
  } finally {
    root.removeAttribute("aria-busy");
  }
}

function navigate(path) {
  if (path !== location.pathname + location.search) history.pushState(null, "", path);
  window.scrollTo(0, 0);
  render();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-go]");
  if (!target || target.disabled) return;
  event.preventDefault();
  navigate(target.dataset.go);
});
window.addEventListener("popstate", render);

function renderDevLog() {
  const page = devLog.map((entry) => `<details class="entry ${entry.error ? "bad" : entry.ok ? "good" : ""}"><summary><span class="k">${esc(entry.kind)}</span> ${esc(entry.label)} <em>${esc(entry.at)}</em></summary>${entry.request !== undefined ? `<pre>→ ${esc(JSON.stringify(entry.request, null, 2))}</pre>` : ""}<pre>← ${esc(JSON.stringify(entry.error ?? entry.response, null, 2))}</pre></details>`);
  document.getElementById("dev-page").innerHTML = page.join("") || `<p class="muted small">No calls yet.</p>`;
}

async function renderServerLog() {
  const box = document.getElementById("dev-server");
  box.innerHTML = `<p class="muted small">Loading…</p>`;
  const data = await fetch("/api/dev/log").then((response) => response.json()).catch(() => null);
  if (!data) {
    box.innerHTML = alertBox("Could not load the server log");
    return;
  }
  const calls = data.server_calls.map((call) => `<details class="entry ${call.status >= 400 || call.error ? "bad" : "good"}"><summary><span class="k">biti</span> ${esc(call.name)} → ${esc(call.status ?? "network error")} ${call.withToken ? "· token" : ""} <em>${esc(call.ms)}ms</em></summary><pre>→ ${esc(JSON.stringify(call.request, null, 2))}</pre><pre>← ${esc(JSON.stringify(call.response ?? call.error, null, 2))}</pre></details>`);
  const hooks = data.webhooks.map((event) => `<details class="entry good"><summary><span class="k">hook</span> ${esc(event.event)} · ${esc(event.result)} <em>${esc(new Date(event.received_at).toLocaleTimeString())}</em></summary><pre>${esc(JSON.stringify(event, null, 2))}</pre></details>`);
  box.innerHTML = `<p class="sec-t">Server → Biti</p>${calls.join("") || `<p class="muted small">No calls yet.</p>`}<p class="sec-t">Webhooks received</p>${hooks.join("") || `<p class="muted small">No webhooks yet.</p>`}`;
}

function setupDevPanel() {
  const panel = document.getElementById("dev");
  document.getElementById("dev-toggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderDevLog();
  });
  document.getElementById("dev-close").addEventListener("click", () => { panel.hidden = true; });
  panel.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
    panel.querySelectorAll("[data-tab]").forEach((other) => other.classList.toggle("on", other === tab));
    document.getElementById("dev-page").hidden = tab.dataset.tab !== "page";
    document.getElementById("dev-server").hidden = tab.dataset.tab !== "server";
    if (tab.dataset.tab === "server") renderServerLog();
  }));
  document.getElementById("dev-context").addEventListener("click", () => sdk("getContext").catch(() => null));
  onLog(() => { if (!panel.hidden) renderDevLog(); });
}

async function boot() {
  app.navigate = navigate;
  app.render = render;
  app.search = loadSearch();
  setupDevPanel();

  const [hotels, me] = await Promise.all([api("GET", "/hotels"), api("GET", "/me"), loadSdk()]);
  app.hotels = hotels;
  app.me = me;
  document.documentElement.dataset.env = isInBiti() ? "biti" : "web";
  document.getElementById("env").textContent = isInBiti() ? "In Biti" : "Web";
  if (window.biti) sdk("getContext").catch(() => null);
  render();
}

boot().catch((error) => {
  document.getElementById("view").innerHTML = alertBox(`The app could not start: ${explain(error)}`);
});
