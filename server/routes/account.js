const express = require("express");

const { CURRENCY } = require("../catalog");
const { signIn, signOut, isSignedIn, requireUser } = require("../session");

const LOGIN_SCOPES = ["profile.read", "wallet.read", "wallet.topup"];
const REFERENCE_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function publicUser(session) {
  if (!isSignedIn(session)) return { signed_in: false };
  return { signed_in: true, via: session.via, user: session.user, scopes: session.scopes, expires_at: session.expires_at };
}

/** Sign-in (mini browser code or Connect by phone), wallet and top-ups. */
function accountRoutes({ biti, store }) {
  const router = express.Router();

  router.get("/me", (req, res) => res.json(publicUser(req.session)));

  // Mini browser: biti.login() gives the page a one-time code; only the server can swap it.
  router.post("/login", async (req, res, next) => {
    try {
      const code = String(req.body.code || "");
      if (!code) return res.status(400).json({ error: "code is required" });
      const data = await biti.call("exchange-login-code", { code });
      signIn(req.session, data, "mini_browser");
      res.json(publicUser(req.session));
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", (req, res) => {
    signOut(req.session);
    res.json({ signed_in: false });
  });

  // Outside the Biti app: ask the customer by phone, then poll.
  router.post("/connect", async (req, res, next) => {
    try {
      const phone = String(req.body.phone || "").replace(/\s+/g, "");
      if (!/^\+?\d{7,15}$/.test(phone)) return res.status(400).json({ error: "Enter a phone number, for example +252615123456" });
      const data = await biti.call("connect-request", { phone, scopes: LOGIN_SCOPES.join(","), device: "Daryeel Stays web" });
      res.json({ request_token: data.request_token, expires_in: data.expires_in, install: data.install });
    } catch (error) {
      next(error);
    }
  });

  router.get("/connect/:token", async (req, res, next) => {
    try {
      const data = await biti.call("connect-status", { request_token: req.params.token });
      if (data.access_token) signIn(req.session, data, "connect");
      res.json({ status: data.status, account_exists: data.account_exists, expires_in: data.expires_in, me: publicUser(req.session) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/wallet", requireUser, async (req, res, next) => {
    try {
      const token = req.session.token;
      const wallet = await biti.call("connected-wallet", {}, { token });
      const methods = await biti.call("get-topup-methods", {}, { token }).catch((error) => ({ error: error.message, methods: [] }));
      res.json({ wallet, topup: methods });
    } catch (error) {
      next(error);
    }
  });

  router.post("/topup", requireUser, async (req, res, next) => {
    try {
      const amount = Number(req.body.amount);
      const methodId = String(req.body.method_id || "");
      const key = req.get("Idempotency-Key");
      const reference = `TU-${String(key || Date.now()).replace(/[^A-Za-z0-9]/g, "").slice(0, 40)}`;
      if (!(amount > 0) || !methodId || !REFERENCE_PATTERN.test(reference)) return res.status(400).json({ error: "method_id and an amount above 0 are required" });

      const data = await biti.call(
        "create-topup",
        { method_id: methodId, amount, currency: req.body.currency || CURRENCY, reference },
        { token: req.session.token }
      );
      store.topups[data.topup_id] = { ...data, reference, created_at: new Date().toISOString() };
      store.save();
      res.json(data);
    } catch (error) {
      if (error.code === "needs_linking") return res.status(409).json({ error: error.message, code: error.code, link_url: error.data?.link_url });
      next(error);
    }
  });

  router.get("/topup/:id", requireUser, async (req, res, next) => {
    try {
      const data = await biti.call("get-topup-status", { topup_id: req.params.id }, { token: req.session.token });
      if (store.topups[req.params.id]) Object.assign(store.topups[req.params.id], data);
      store.save();
      res.json(data);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { accountRoutes, LOGIN_SCOPES };
