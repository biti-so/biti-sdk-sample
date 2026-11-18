const crypto = require("crypto");

const TOKEN_ENDPOINTS = new Set([
  "connected-wallet", "get-topup-methods", "create-topup", "get-topup-status", "create-payment-request",
]);

const ENDPOINTS = [
  "connect-request", "connect-status", "exchange-login-code", "connected-wallet", "get-topup-methods",
  "create-topup", "get-topup-status", "create-payment-request", "get-order-status", "create-order",
  "release-splits", "get-payout-methods", "quote-bulk-send", "create-bulk-send", "get-bulk-send-status",
  "create-mandate", "charge-mandate", "get-mandate-status", "create-hold", "capture-hold", "release-hold",
  "get-hold-status", "refund-order", "create-payout", "get-payout-status", "get-statement",
  "onboard-customer", "onboard-verify", "onboard-status", "billpay-push-bill", "billpay-cancel-bill",
  "billpay-bill-status", "billpay-confirm-account",
].map((endpoint) => ({ method: camelCase(endpoint), endpoint, token: TOKEN_ENDPOINTS.has(endpoint) }));

const HIDDEN_IN_REQUEST = new Set(["access_token", "client_secret", "code"]);
const HIDDEN_IN_RESPONSE = new Set(["access_token", "client_secret"]);

function camelCase(name) {
  return name.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
}

class BitiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "BitiError";
    this.status = status;
    this.code = body?.code || body?.data?.code || null;
    this.data = body?.data ?? null;
  }
}

function redact(value, hidden) {
  if (Array.isArray(value)) return value.map((item) => redact(item, hidden));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, hidden.has(key) ? "•••" : redact(inner, hidden)])
  );
}

// Frappe puts the envelope at the top level; older handlers nest it under "message".
function unwrap(json) {
  if (json && json.success === undefined && json.message && typeof json.message === "object") return json.message;
  return json;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

class BitiClient {
  constructor({ baseUrl, clientId, clientSecret, timeoutSeconds = 20, onTrace = null }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.timeoutSeconds = timeoutSeconds;
    this.onTrace = onTrace;
  }

  async call(endpoint, body = {}, { token } = {}) {
    const headers = {
      "Content-Type": "application/json",
      "X-Biti-Client-Id": this.clientId,
      "X-Biti-Client-Secret": this.clientSecret,
    };
    if (token) headers["X-Biti-Token"] = token;

    const started = Date.now();
    const trace = (entry) => this.onTrace?.({ name: endpoint, ms: Date.now() - started, request: redact(body, HIDDEN_IN_REQUEST), ...entry });
    let response;
    let json;
    try {
      response = await fetch(`${this.baseUrl}/partner/v1/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutSeconds * 1000),
      });
      json = unwrap(await response.json().catch(() => ({ success: false, message: `Biti answered ${response.status} without JSON` })));
    } catch (error) {
      trace({ error: error.message });
      throw new BitiError(`Can't reach Biti: ${error.message}`, 502);
    }

    const answer = { success: json.success, message: json.message, code: json.code, data: json.data };
    trace({ status: response.status, with_token: Boolean(token), response: redact(answer, HIDDEN_IN_RESPONSE) });
    if (!response.ok || json.success === false) {
      throw new BitiError(json.message || `Biti answered ${response.status}`, response.status, json);
    }
    return json.data;
  }

  static verifyWebhook(rawBody, headers, clientSecret, { now = Date.now() / 1000, tolerance = 300 } = {}) {
    const signature = String(headerValue(headers, "x-biti-signature") || "");
    const timestamp = Number(headerValue(headers, "x-biti-timestamp"));
    if (!signature || !Number.isFinite(timestamp) || Math.abs(now - timestamp) > tolerance) return false;

    const expected = Buffer.from(crypto.createHmac("sha256", clientSecret).update(rawBody).digest("hex"));
    const given = Buffer.from(signature);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }

  static verifyLookup(...args) {
    return BitiClient.verifyWebhook(...args);
  }
}

for (const { method, endpoint } of ENDPOINTS) {
  BitiClient.prototype[method] = function (body = {}, { token } = {}) {
    return this.call(endpoint, body, { token });
  };
}

module.exports = { BitiClient, BitiError, ENDPOINTS };
