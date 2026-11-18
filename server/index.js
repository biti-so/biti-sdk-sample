const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const cookieParser = require("cookie-parser");
const express = require("express");

const { BitiError, createBitiClient } = require("./biti");
const catalog = require("./catalog");
const { accountRoutes, LOGIN_SCOPES } = require("./routes/account");
const { bookingRoutes } = require("./routes/bookings");
const { planRoutes } = require("./routes/plan");
const { webhookRoutes } = require("./routes/webhooks");
const { sessionMiddleware } = require("./session");
const { Store } = require("./store");

const config = {
  bitiBaseUrl: (process.env.BITI_BASE_URL || "http://192.168.100.200:8004").replace(/\/+$/, ""),
  bitiWalletUrl: (process.env.BITI_WALLET_URL || "http://192.168.100.200:8052").replace(/\/+$/, ""),
  clientId: process.env.BITI_CLIENT_ID,
  clientSecret: process.env.BITI_CLIENT_SECRET,
  appOrigins: (process.env.APP_ORIGINS || "").split(",").map((origin) => origin.trim().replace(/\/+$/, "")).filter(Boolean),
  port: Number(process.env.PORT || 8090),
  sessionSecret: process.env.SESSION_SECRET,
};

for (const key of ["clientId", "clientSecret", "sessionSecret"]) {
  if (!config[key]) throw new Error(`Missing ${key} in .env. Copy .env.example to .env and fill it in.`);
}

const PAGE_ROUTES = ["/", "/hotel/:id", "/checkout/:id", "/booking/:id", "/bookings", "/plan", "/deposit/:id", "/wallet", "/connect"];
const serverCalls = [];

function log(...parts) {
  console.log(new Date().toISOString(), ...parts);
}

function trace(entry) {
  serverCalls.unshift({ at: new Date().toISOString(), ...entry });
  serverCalls.length = Math.min(serverCalls.length, 50);
  log(`biti ${entry.name} -> ${entry.status ?? "network error"} ${entry.ms}ms`);
}

/** A return URL for Biti's web pages, only when this request came from an allowed origin. */
function returnUrl(req, pagePath) {
  const origin = `${req.protocol}://${req.get("host")}`;
  return config.appOrigins.includes(origin) ? `${origin}${pagePath}` : undefined;
}

const store = new Store();
const biti = createBitiClient({ baseUrl: config.bitiBaseUrl, clientId: config.clientId, clientSecret: config.clientSecret, trace });
const app = express();

app.disable("x-powered-by");
app.use(webhookRoutes({ store, clientSecret: config.clientSecret, log }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser(config.sessionSecret));

app.get("/config.js", (req, res) => {
  const pageConfig = {
    sdkUrl: `${config.bitiBaseUrl}/assets/biti_wallet/js/biti-sdk.js`,
    bitiOrigin: config.bitiWalletUrl,
    loginScopes: LOGIN_SCOPES,
    currency: catalog.CURRENCY,
    cityTaxPerNight: catalog.CITY_TAX_PER_NIGHT,
    depositAmount: catalog.DEPOSIT_AMOUNT,
    planLimit: catalog.PLAN_LIMIT,
  };
  res.type("application/javascript").set("Cache-Control", "no-store").send(`window.APP_CONFIG = ${JSON.stringify(pageConfig)};`);
});

app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));
app.use(sessionMiddleware);

const api = express.Router();
api.get("/health", async (req, res) => {
  const started = Date.now();
  const ping = await fetch(`${config.bitiBaseUrl}/api/method/ping`, { signal: AbortSignal.timeout(5000) })
    .then((response) => response.ok)
    .catch(() => false);
  res.json({ ok: true, biti_reachable: ping, biti_base_url: config.bitiBaseUrl, ms: Date.now() - started });
});
api.get("/hotels", (req, res) => res.json(catalog.HOTELS));
api.get("/dev/log", (req, res) => res.json({ server_calls: serverCalls, webhooks: store.data.events.slice(0, 20) }));
api.use(accountRoutes({ biti, store }));
api.use(bookingRoutes({ biti, store, returnUrl }));
api.use(planRoutes({ biti, store, returnUrl }));
app.use("/api", api);

app.get(PAGE_ROUTES, (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

app.use((error, req, res, next) => {
  if (error instanceof BitiError) {
    const status = error.status >= 500 || !error.status ? 502 : error.status;
    return res.status(status).json({ error: error.message, code: error.code, data: error.data, source: "biti" });
  }
  log("error", error);
  res.status(500).json({ error: error.message || "Something went wrong" });
});

app.listen(config.port, "0.0.0.0", () => {
  log(`Daryeel Stays on http://localhost:${config.port} (Biti: ${config.bitiBaseUrl})`);
});
