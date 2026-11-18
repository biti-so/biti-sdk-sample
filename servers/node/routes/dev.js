const express = require("express");

const { ENDPOINTS } = require("../../../sdk/node");

/** Playground and call log. Only mounted when DEV_TOOLS=1. */
function devRoutes({ biti, store, serverCalls }) {
  const router = express.Router();

  router.get("/dev/log", (req, res) => res.json({ server_calls: serverCalls, webhooks: store.list("event").slice(0, 20) }));

  router.get("/playground", (req, res) => res.json({ endpoints: ENDPOINTS }));

  router.post("/playground/:endpoint", async (req, res) => {
    const entry = ENDPOINTS.find((item) => item.endpoint === req.params.endpoint);
    if (!entry) return res.json({ ok: false, status: 404, error: "Unknown endpoint" });
    if (entry.token && !req.session.token) return res.json({ ok: false, status: 401, error: "Sign in with Biti first", code: "sign_in_required" });

    try {
      const data = await biti.call(entry.endpoint, req.body.body || {}, { token: entry.token ? req.session.token : undefined });
      res.json({ ok: true, status: 200, data });
    } catch (error) {
      res.json({ ok: false, status: error.status || 500, error: error.message, code: error.code, data: error.data });
    }
  });

  return router;
}

module.exports = { devRoutes };
