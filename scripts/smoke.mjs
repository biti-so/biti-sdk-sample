import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "http://localhost:8090").replace(/\/+$/, "");
const secret = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env"), "utf8").split("\n").filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()])
).BITI_CLIENT_SECRET;

const rows = [];
const check = (name, ok, detail = "") => rows.push({ name, result: ok ? "PASS" : "FAIL", detail });

async function request(method, url, { body, headers = {}, raw } = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const response = await fetch(BASE + url, { method, headers: { ...(payload ? { "Content-Type": "application/json" } : {}), ...headers }, body: payload });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text };
}

function signed(raw, { secretKey = secret, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  return { "X-Biti-Signature": crypto.createHmac("sha256", secretKey).update(raw).digest("hex"), "X-Biti-Timestamp": String(timestamp) };
}

async function run(name, fn) {
  try {
    const [ok, detail] = await fn();
    check(name, ok, detail);
  } catch (error) {
    check(name, false, error.message);
  }
}

await run("GET /api/health", async () => {
  const { status, json } = await request("GET", "/api/health");
  return [status === 200 && json.ok === true && json.server, `server=${json?.server} biti_reachable=${json?.biti_reachable}`];
});
await run("GET /config.js", async () => {
  const { status, text } = await request("GET", "/config.js");
  return [status === 200 && text.includes("window.APP_CONFIG") && text.includes("devTools"), ""];
});
await run("GET /api/hotels", async () => {
  const { status, json } = await request("GET", "/api/hotels");
  return [status === 200 && json.length > 0, `${json?.length} hotels`];
});
await run("GET /api/me", async () => {
  const { status, json } = await request("GET", "/api/me");
  return [status === 200 && json.signed_in === false, ""];
});
for (const url of ["/api/wallet", "/api/bookings", "/api/plan"]) {
  await run(`GET ${url} (signed out)`, async () => {
    const { status, json } = await request("GET", url);
    return [status === 401 && json.code === "sign_in_required", "401 sign_in_required expected"];
  });
}
await run("POST /api/topup (signed out)", async () => {
  const { status, json } = await request("POST", "/api/topup", { body: {} });
  return [status === 401 && json.code === "sign_in_required", "401 sign_in_required expected"];
});

let billId;
await run("GET /api/bills", async () => {
  const { status, json } = await request("GET", "/api/bills");
  return [status === 200 && json.accounts.length >= 3 && Array.isArray(json.bills) && Array.isArray(json.connect_requests), `${json?.accounts?.length} accounts`];
});
await run("POST /api/bills + status", async () => {
  const pushed = await request("POST", "/api/bills", { body: { account_number: "DS-1001", title: "Smoke test invoice", amount: 5 } });
  if (pushed.status !== 201) return [false, `push ${pushed.status} ${pushed.json?.error}`];
  billId = pushed.json.external_id;
  const state = await request("GET", `/api/bills/${billId}`);
  return [state.status === 200 && state.json.external_id === billId, `${billId} ${state.json?.status}`];
});
await run("POST /api/bills/:id/cancel", async () => {
  const { status, json } = await request("POST", `/api/bills/${billId}/cancel`);
  return [status === 200 && json.status === "Cancelled", json?.error || ""];
});
await run("POST /api/bills (unknown account)", async () => {
  const { status } = await request("POST", "/api/bills", { body: { account_number: "NOPE", title: "x", amount: 1 } });
  return [status === 404, ""];
});

await run("GET /api/playground", async () => {
  const { status, json } = await request("GET", "/api/playground");
  return [status === 200 && json.endpoints?.length > 20, `${json?.endpoints?.length ?? json?.error} endpoints (needs DEV_TOOLS=1)`];
});
await run("POST /api/playground/connected-wallet", async () => {
  const { status, json } = await request("POST", "/api/playground/connected-wallet", { body: { body: {} } });
  return [status === 200 && json.ok === false && json.code === "sign_in_required", "signed out answer expected"];
});
await run("GET /api/dev/log", async () => {
  const { status, json } = await request("GET", "/api/dev/log");
  return [status === 200 && Array.isArray(json.server_calls) && Array.isArray(json.webhooks), ""];
});

const event = { id: `evt-smoke-${Date.now()}`, event: "bill.disputed", data: { external_id: "INV-NONE" } };
const hook = JSON.stringify(event);
await run("POST /webhooks/biti (valid)", async () => {
  const { status, json } = await request("POST", "/webhooks/biti", { raw: hook, headers: signed(hook) });
  return [status === 200 && json.ok === true && !json.duplicate, ""];
});
await run("POST /webhooks/biti (duplicate)", async () => {
  const { status, json } = await request("POST", "/webhooks/biti", { raw: hook, headers: signed(hook) });
  return [status === 200 && json.duplicate === true, ""];
});
await run("POST /webhooks/biti (bad signature)", async () => {
  const { status } = await request("POST", "/webhooks/biti", { raw: hook, headers: signed(hook, { secretKey: "wrong" }) });
  return [status === 401, ""];
});
await run("POST /webhooks/biti (old timestamp)", async () => {
  const { status } = await request("POST", "/webhooks/biti", { raw: hook, headers: signed(hook, { timestamp: 1000 }) });
  return [status === 401, ""];
});

const lookup = JSON.stringify({ account_number: "DS-1001" });
await run("POST /biller/lookup DS-1001", async () => {
  const { status, json } = await request("POST", "/biller/lookup", { raw: lookup, headers: signed(lookup) });
  return [status === 200 && json.customer_name === "Ahmed Ali" && Array.isArray(json.invoices), `${json?.invoices?.length} invoices`];
});
const unknown = JSON.stringify({ account_number: "DS-9999" });
await run("POST /biller/lookup unknown", async () => {
  const { status, json } = await request("POST", "/biller/lookup", { raw: unknown, headers: signed(unknown) });
  return [status === 404 && json.error === "unknown_account", ""];
});
await run("POST /biller/lookup bad signature", async () => {
  const { status } = await request("POST", "/biller/lookup", { raw: lookup, headers: signed(lookup, { secretKey: "wrong" }) });
  return [status === 401, ""];
});

for (const page of ["/", "/dev", "/dev/bills", "/dev/webhooks"]) {
  await run(`GET ${page} (page)`, async () => [(await request("GET", page)).status === 200, ""]);
}

console.table(rows.map(({ name, result, detail }) => ({ name, result, detail })));
const failed = rows.filter((row) => row.result === "FAIL").length;
console.log(failed ? `${failed} FAIL` : "all PASS");
process.exit(failed ? 1 : 0);
