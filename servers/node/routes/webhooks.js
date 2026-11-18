const express = require("express");

const { BitiClient } = require("../../../sdk/node");

const KEEP_EVENTS = 100;

function findBooking(store, predicate) {
  return store.list("booking").find(predicate) || null;
}

function applyBillEvent(store, event, data) {
  const id = data.external_id || data.id;
  if (event === "bill.account_connect_requested") {
    const account = data.account_number;
    store.put("bill_account", `request:${account}`, {
      account_number: account,
      customer_name: data.customer_name || data.customer?.full_name || data.customer?.phone || null,
      requested_at: new Date().toISOString(),
    });
    return `connect request for ${account}`;
  }

  const bill = store.get("bill", id);
  if (!bill) return "no bill";
  store.update("bill", id, (current) => {
    if (event === "bill.disputed") current.status = "Disputed";
    if (event === "bill.paid") {
      current.paid_amount = Number(data.paid_amount ?? current.amount);
      current.status = current.paid_amount < current.amount ? "Part paid" : "Paid";
    }
  });
  return `${id} ${store.get("bill", id).status}`;
}

/** Applies one verified Biti event to local state. Returns what it changed, for the log. */
function applyEvent(store, { event, data }) {
  const byOrder = () => findBooking(store, (booking) => booking.order?.order_id === data.id);
  const byHold = () => findBooking(store, (booking) => booking.deposit?.hold_id === data.id);

  if (event === "payment.paid") {
    const booking = byOrder();
    if (!booking || booking.status === "cancelled") return "no booking for this order";
    store.update("booking", booking.id, (current) => {
      Object.assign(current, { status: "confirmed", transaction_id: data.transaction_id });
      current.order.status = "paid";
    });
    return `${booking.id} confirmed`;
  }
  if (event === "payment.failed") {
    const booking = byOrder();
    if (booking) store.update("booking", booking.id, (current) => { current.payment_error = data.error; });
    return booking ? `${booking.id} payment failed` : "no booking";
  }
  if (event === "refund.done") {
    const booking = byOrder();
    if (booking) {
      store.update("booking", booking.id, (current) => {
        Object.assign(current, { status: "cancelled", refund: { ...current.refund, refunded_amount: data.refunded_amount } });
      });
    }
    return booking ? `${booking.id} refunded` : "no booking";
  }
  if (event.startsWith("hold.")) {
    const booking = byHold();
    if (booking) store.update("booking", booking.id, (current) => { current.deposit.status = event.slice("hold.".length); });
    return booking ? `${booking.id} deposit ${event.slice("hold.".length)}` : "no booking";
  }
  if (event.startsWith("mandate.")) {
    const plan = store.list("plan").find((item) => item.mandate_id === data.id);
    if (plan && event !== "mandate.charged") store.update("plan", plan.owner, (current) => { current.status = event.slice("mandate.".length); });
    return plan ? `plan ${event.slice("mandate.".length)}` : "no plan";
  }
  if (event.startsWith("topup.")) {
    const topup = store.get("topup", data.id);
    const status = event === "topup.done" ? "done" : "failed";
    if (topup) store.update("topup", data.id, (current) => { current.status = status; });
    return topup ? `top-up ${status}` : "no top-up";
  }
  if (event.startsWith("bill.")) return applyBillEvent(store, event, data);
  return "ignored";
}

function webhookRoutes({ store, clientSecret, log }) {
  const router = express.Router();

  // Verify on the raw bytes, before any JSON parsing.
  router.post("/webhooks/biti", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!BitiClient.verifyWebhook(raw, req.headers, clientSecret)) {
      log("webhook rejected: bad signature", req.get("X-Biti-Event"));
      return res.status(401).json({ error: "bad signature" });
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "body is not JSON" });
    }
    if (!payload.id || !payload.event) return res.status(400).json({ error: "id and event are required" });

    const result = store.transaction(() => {
      if (store.get("event", payload.id)) return null;
      const outcome = applyEvent(store, { event: payload.event, data: payload.data || {} });
      store.put("event", payload.id, {
        id: payload.id,
        event: payload.event,
        header_event: req.get("X-Biti-Event"),
        sent_at: req.get("X-Biti-Timestamp"),
        received_at: new Date().toISOString(),
        result: outcome,
        data: payload.data,
      });
      store.keepNewest("event", KEEP_EVENTS);
      return outcome;
    });

    if (result === null) return res.json({ ok: true, duplicate: true });
    log(`webhook ${payload.event} ${payload.id}: ${result}`);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { webhookRoutes, applyEvent };
