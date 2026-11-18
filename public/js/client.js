const config = window.APP_CONFIG;
const listeners = new Set();
export const devLog = [];

export function onLog(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function record(entry) {
  devLog.unshift({ at: new Date().toLocaleTimeString(), ...entry });
  devLog.length = Math.min(devLog.length, 80);
  listeners.forEach((listener) => listener());
}

export function newKey(prefix = "k") {
  const random = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`;
  return `${prefix}-${random.replace(/-/g, "").slice(0, 20)}`;
}

/** Calls this app's own server. Throws an Error with .code, .status and .body on a refusal. */
export async function api(method, path, body, { idempotencyKey } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let response;
  let json = null;
  try {
    response = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
    json = await response.json().catch(() => null);
  } catch (error) {
    record({ kind: "api", label: `${method} /api${path}`, request: body, error: error.message });
    throw Object.assign(new Error("Can't reach the Daryeel server. Check your connection."), { code: "network" });
  }

  record({ kind: "api", label: `${method} /api${path} → ${response.status}`, request: body, response: json, ok: response.ok });
  if (!response.ok) {
    const error = new Error(json?.error || `Request failed (${response.status})`);
    return Promise.reject(Object.assign(error, { code: json?.code, status: response.status, body: json }));
  }
  return json;
}

let sdkPromise = null;

/** Loads biti-sdk.js from the Biti server, with data-biti-origin for the web fallback. */
export function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = config.sdkUrl;
    script.setAttribute("data-biti-origin", config.bitiOrigin);
    script.onload = () => {
      record({ kind: "sdk", label: `SDK loaded (v${window.biti?.version})`, response: { src: config.sdkUrl, biti_origin: config.bitiOrigin, in_biti_app: window.biti?.isInBitiApp() }, ok: true });
      resolve(window.biti || null);
    };
    script.onerror = () => {
      record({ kind: "sdk", label: "SDK failed to load", error: `Could not load ${config.sdkUrl}` });
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** Runs one SDK method and logs the call and its result. */
export async function sdk(method, params) {
  const biti = await loadSdk();
  if (!biti) throw Object.assign(new Error("The Biti SDK did not load. Check BITI_BASE_URL."), { code: "sdk_missing" });
  const label = `biti.${method}(${params ? JSON.stringify(params) : ""})`;
  try {
    const result = await biti[method](params);
    record({ kind: "sdk", label, request: params, response: result ?? null, ok: true });
    return result;
  } catch (error) {
    record({ kind: "sdk", label, request: params, error: error.code || error.message });
    throw error;
  }
}

export function isInBiti() {
  return Boolean(window.biti && window.biti.isInBitiApp());
}

export const SDK_ERRORS = {
  cancelled: "You closed the Biti sheet. Nothing was paid.",
  timeout: "Biti did not answer in time. Check the booking before you try again.",
  busy: "Biti is showing another sheet. Finish it first.",
  not_in_biti_app: "Open this app inside Biti to sign in this way.",
  missing_biti_origin: "The SDK has no data-biti-origin, so it can't open the Biti web page.",
  not_supported: "This browser can't share. The link was copied instead.",
  invalid_scopes: "This app asked for scopes that are not on its Mini App record.",
};

export function explain(error) {
  return SDK_ERRORS[error?.code] || SDK_ERRORS[error?.message] || error?.message || "Something went wrong";
}
