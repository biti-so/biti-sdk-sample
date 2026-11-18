const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const crypto = require("crypto");
const { BitiClient, BitiError, ENDPOINTS } = require("./index");

const SECRET = "s3cret";

function stub(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      const [status, payload] = handler(req);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ seen, close: () => server.close(), url: `http://127.0.0.1:${server.address().port}` }))
  );
}

const clientFor = (url, extra = {}) => new BitiClient({ baseUrl: url, clientId: "cid", clientSecret: SECRET, ...extra });
const sign = (body, secret = SECRET) => crypto.createHmac("sha256", secret).update(body).digest("hex");

test("sends credentials, and the token only when given", async () => {
  const server = await stub(() => [200, { success: true, data: { ok: 1 } }]);
  const client = clientFor(server.url);
  assert.deepStrictEqual(await client.createOrder({ amount: 5 }), { ok: 1 });
  await client.connectedWallet({}, { token: "tok" });
  server.close();

  const [first, second] = server.seen;
  assert.strictEqual(first.url, "/partner/v1/create-order");
  assert.strictEqual(first.headers["x-biti-client-id"], "cid");
  assert.strictEqual(first.headers["x-biti-client-secret"], SECRET);
  assert.strictEqual(first.headers["content-type"], "application/json");
  assert.strictEqual(first.headers["x-biti-token"], undefined);
  assert.deepStrictEqual(first.body, { amount: 5 });
  assert.strictEqual(second.headers["x-biti-token"], "tok");
});

test("unwraps a nested message envelope", async () => {
  const server = await stub(() => [200, { message: { success: true, data: { id: 7 } } }]);
  assert.deepStrictEqual(await clientFor(server.url).getOrderStatus({}), { id: 7 });
  server.close();
});

test("failure raises BitiError with status and code", async () => {
  const server = await stub(() => [409, { success: false, message: "Nope", data: { code: "needs_linking" } }]);
  await assert.rejects(clientFor(server.url).createTopup({}), (error) => {
    assert.ok(error instanceof BitiError);
    assert.strictEqual(error.message, "Nope");
    assert.strictEqual(error.status, 409);
    assert.strictEqual(error.code, "needs_linking");
    return true;
  });
  server.close();
});

test("network error becomes BitiError 502", async () => {
  await assert.rejects(clientFor("http://127.0.0.1:1").createOrder({}), (error) => error instanceof BitiError && error.status === 502);
});

test("onTrace redacts secrets", async () => {
  const server = await stub(() => [200, { success: true, data: { access_token: "abc", x: 1 } }]);
  const traces = [];
  await clientFor(server.url, { onTrace: (entry) => traces.push(entry) }).exchangeLoginCode({ code: "123" }, { token: "t" });
  server.close();
  assert.strictEqual(traces[0].request.code, "•••");
  assert.strictEqual(traces[0].with_token, true);
  assert.strictEqual(traces[0].name, "exchange-login-code");
});

test("every endpoint has a method", () => {
  const client = clientFor("http://x");
  assert.strictEqual(ENDPOINTS.length, 33);
  for (const { method } of ENDPOINTS) assert.strictEqual(typeof client[method], "function", method);
});

test("verifyWebhook: valid, invalid, stale, case-insensitive", () => {
  const body = '{"event":"x"}';
  const now = 1_700_000_000;
  const headers = { "X-Biti-Signature": sign(body), "X-Biti-Timestamp": String(now) };
  assert.strictEqual(BitiClient.verifyWebhook(body, headers, SECRET, { now }), true);
  assert.strictEqual(BitiClient.verifyLookup(body, headers, SECRET, { now }), true);
  assert.strictEqual(BitiClient.verifyWebhook(body, { "x-biti-signature": sign(body), "X-BITI-TIMESTAMP": String(now) }, SECRET, { now }), true);
  assert.strictEqual(BitiClient.verifyWebhook(body, { ...headers, "X-Biti-Signature": sign(body, "other") }, SECRET, { now }), false);
  assert.strictEqual(BitiClient.verifyWebhook(body + " ", headers, SECRET, { now }), false);
  assert.strictEqual(BitiClient.verifyWebhook(body, headers, SECRET, { now: now + 301 }), false);
  assert.strictEqual(BitiClient.verifyWebhook(body, headers, SECRET, { now: now + 301, tolerance: 600 }), true);
  assert.strictEqual(BitiClient.verifyWebhook(body, {}, SECRET, { now }), false);
});
