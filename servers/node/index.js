const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
require("dotenv").config({ path: path.join(ROOT, ".env") });

const cookieParser = require("cookie-parser");
const express = require("express");

const { BitiClient, BitiError } = require("../../sdk/node");
const catalog = require("./catalog");
const { accountRoutes, LOGIN_SCOPES } = require("./routes/account");
const { billRoutes, lookupRoutes, seedAccounts } = require("./routes/bills");
const { bookingRoutes } = require("./routes/bookings");
const { devRoutes } = require("./routes/dev");
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
  runMode: process.env.RUN_MODE === "biti_only" ? "biti_only" : "anywhere",
  appId: process.env.BITI_APP_ID || "daryeel-stays",
  sessionSecret: process.env.SESSION_SECRET,
  devTools: process.env.DEV_TOOLS === "1",
  cookieSecure: process.env.COOKIE_SECURE === "1",
  dbPath: path.resolve(ROOT, process.env.DB_PATH || "data/daryeel.sqlite"),
  trustProxy: process.env.TRUST_PROXY === "1",
  isProduction: process.env.NODE_ENV === "production",
};

for (const key of ["clientId", "clientSecret", "sessionSecret"]) {
  if (!config[key]) throw new Error(`Missing ${key} in .env. Copy .env.example to .env and fill it in.`);
}

/** `npm run production` refuses to start with settings that are only safe on a developer machine. */
function productionProblems() {
  const isHttps = (url) => url.startsWith("https://");
  return [
    config.devTools && "DEV_TOOLS must be off",
    !config.cookieSecure && "COOKIE_SECURE must be 1",
    !isHttps(config.bitiBaseUrl) && "BITI_BASE_URL must be https",
    !isHttps(config.bitiWalletUrl) && "BITI_WALLET_URL must be https",
    (!config.appOrigins.length || !config.appOrigins.every(isHttps)) && "APP_ORIGINS must list only https origins",
    config.sessionSecret.length < 32 && "SESSION_SECRET must be at least 32 characters",
  ].filter(Boolean);
}

if (config.isProduction && productionProblems().length) {
  throw new Error(`Not safe for production:\n- ${productionProblems().join("\n- ")}\nFix .env, or use npm run dev on a developer machine.`);
}

const PAGE_ROUTES = ["/", "/hotel/:id", "/checkout/:id", "/booking/:id", "/bookings", "/plan", "/deposit/:id", "/wallet", "/connect", "/dev", "/dev/bills", "/dev/webhooks"];
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

const store = new Store(config.dbPath);
if (store.importLegacy(path.join(ROOT, "data", "store.json"))) log("imported data/store.json into SQLite");
seedAccounts(store);

const biti = new BitiClient({ baseUrl: config.bitiBaseUrl, clientId: config.clientId, clientSecret: config.clientSecret, onTrace: trace });
const app = express();

app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", 1);
app.use(webhookRoutes({ store, clientSecret: config.clientSecret, log }));
app.use(lookupRoutes({ store, clientSecret: config.clientSecret }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser(config.sessionSecret));

app.get("/config.js", (req, res) => {
  const pageConfig = {
    sdkUrl: `${config.bitiBaseUrl}/assets/biti_wallet/js/biti-sdk.js`,
    bitiOrigin: config.bitiWalletUrl,
    runMode: config.runMode,
    appId: config.appId,
    loginScopes: LOGIN_SCOPES,
    currency: catalog.CURRENCY,
    cityTaxPerNight: catalog.CITY_TAX_PER_NIGHT,
    depositAmount: catalog.DEPOSIT_AMOUNT,
    planLimit: catalog.PLAN_LIMIT,
    devTools: config.devTools,
  };
  res.type("application/javascript").set("Cache-Control", "no-store").send(`window.APP_CONFIG = ${JSON.stringify(pageConfig)};`);
});

app.use(express.static(path.join(ROOT, "public"), { index: false }));
app.use(sessionMiddleware({ store, secure: config.cookieSecure }));

const api = express.Router();
api.get("/health", async (req, res) => {
  const started = Date.now();
  const ping = await fetch(`${config.bitiBaseUrl}/api/method/ping`, { signal: AbortSignal.timeout(5000) })
    .then((response) => response.ok)
    .catch(() => false);
  res.json({ ok: true, biti_reachable: ping, biti_base_url: config.bitiBaseUrl, ms: Date.now() - started, server: "node" });
});
api.get("/hotels", (req, res) => res.json(catalog.HOTELS));
if (config.devTools) api.use(devRoutes({ biti, store, serverCalls }));
else api.all(["/dev/*", "/playground", "/playground/*"], (req, res) => res.status(404).json({ error: "Dev tools are off", code: "dev_tools_off" }));
api.use(accountRoutes({ biti, store }));
api.use(bookingRoutes({ biti, store, returnUrl }));
api.use(planRoutes({ biti, store, returnUrl }));
api.use(billRoutes({ biti, store }));
app.use("/api", api);

app.get(PAGE_ROUTES, (req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));

app.use((error, req, res, next) => {
  if (error instanceof BitiError) {
    const status = error.status >= 500 || !error.status ? 502 : error.status;
    return res.status(status).json({ error: error.message, code: error.code, data: error.data, source: "biti" });
  }
  log("error", error);
  res.status(500).json({ error: error.message || "Something went wrong" });
});

app.listen(config.port, "0.0.0.0", () => {
  log(`Daryeel Stays (node) on http://localhost:${config.port} (Biti: ${config.bitiBaseUrl})`);
});
