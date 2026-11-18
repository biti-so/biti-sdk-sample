const crypto = require("crypto");

const HIDDEN_IN_REQUEST = new Set(["access_token", "client_secret", "code"]);
const HIDDEN_IN_RESPONSE = new Set(["access_token", "client_secret"]);

class BitiError extends Error {
  constructor(message, status, body) {
    super(message);
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

/** Calls /partner/v1/<name> with the client credentials, and the customer token when given. */
function createBitiClient({ baseUrl, clientId, clientSecret, trace }) {
  async function call(name, body = {}, { token, method = "POST" } = {}) {
    const headers = {
      "Content-Type": "application/json",
      "X-Biti-Client-Id": clientId,
      "X-Biti-Client-Secret": clientSecret,
    };
    if (token) headers["X-Biti-Token"] = token;

    const started = Date.now();
    let response;
    let json;
    try {
      response = await fetch(`${baseUrl}/partner/v1/${name}`, {
        method,
        headers,
        body: method === "GET" ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      json = unwrap(await response.json().catch(() => ({ success: false, message: `Biti answered ${response.status} without JSON` })));
    } catch (error) {
      trace({ name, ms: Date.now() - started, request: redact(body, HIDDEN_IN_REQUEST), error: error.message });
      throw new BitiError(`Can't reach Biti: ${error.message}`, 502);
    }

    const answer = { success: json.success, message: json.message, code: json.code, data: json.data };
    trace({ name, status: response.status, ms: Date.now() - started, withToken: Boolean(token), request: redact(body, HIDDEN_IN_REQUEST), response: redact(answer, HIDDEN_IN_RESPONSE) });
    if (!response.ok || json.success === false) {
      throw new BitiError(json.message || `Biti answered ${response.status}`, response.status, json);
    }
    return json.data;
  }

  return { call };
}

function isValidSignature(rawBody, signature, clientSecret) {
  const expected = Buffer.from(crypto.createHmac("sha256", clientSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(String(signature || ""));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

module.exports = { BitiError, createBitiClient, isValidSignature };
