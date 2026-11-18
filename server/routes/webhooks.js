const express = require("express");

const { isValidSignature } = require("../biti");

/** Applies one verified Biti event to local state. Returns what it changed, for the log. */
function applyEvent(store, { event, data }) {
  const byOrder = () => store.findBooking((booking) => booking.order?.order_id === data.id);
  const byHold = () => store.findBooking((booking) => booking.deposit?.hold_id === data.id);

  if (event === "payment.paid") {
    const booking = byOrder();
    if (!booking || booking.status === "cancelled") return "no booking for this order";
    Object.assign(booking, { status: "confirmed", transaction_id: data.transaction_id });
    booking.order.status = "paid";
    return `${booking.id} confirmed`;
  }
  if (event === "payment.failed") {
    const booking = byOrder();
    if (booking) booking.payment_error = data.error;
    return booking ? `${booking.id} payment failed` : "no booking";
  }
  if (event === "refund.done") {
    const booking = byOrder();
    if (booking) Object.assign(booking, { status: "cancelled", refund: { ...booking.refund, refunded_amount: data.refunded_amount } });
    return booking ? `${booking.id} refunded` : "no booking";
  }
  if (event.startsWith("hold.")) {
    const booking = byHold();
    if (booking) booking.deposit.status = event.slice("hold.".length);
    return booking ? `${booking.id} deposit ${booking.deposit.status}` : "no booking";
  }
  if (event.startsWith("mandate.")) {
    const plan = Object.values(store.plans).find((item) => item.mandate_id === data.id);
    if (plan && event !== "mandate.charged") plan.status = event.slice("mandate.".length);
    return plan ? `plan ${plan.status}` : "no plan";
  }
  if (event.startsWith("topup.")) {
    const topup = store.topups[data.id];
    if (topup) topup.status = event === "topup.done" ? "done" : "failed";
    return topup ? `top-up ${topup.status}` : "no top-up";
  }
  return "ignored";
}

function webhookRoutes({ store, clientSecret, log }) {
  const router = express.Router();

  // Verify on the raw bytes, before any JSON parsing.
  router.post("/webhooks/biti", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!isValidSignature(raw, req.get("X-Biti-Signature"), clientSecret)) {
      log("webhook rejected: bad signature", req.get("X-Biti-Event"));
      return res.status(401).json({ error: "bad signature" });
    }

    const payload = JSON.parse(raw.toString("utf8"));
    if (store.hasSeenEvent(payload.id)) return res.json({ ok: true, duplicate: true });

    const result = applyEvent(store, payload);
    store.recordEvent({
      id: payload.id,
      event: payload.event,
      header_event: req.get("X-Biti-Event"),
      sent_at: req.get("X-Biti-Timestamp"),
      received_at: new Date().toISOString(),
      result,
      data: payload.data,
    });
    store.save();
    log(`webhook ${payload.event} ${payload.id}: ${result}`);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { webhookRoutes, applyEvent };
