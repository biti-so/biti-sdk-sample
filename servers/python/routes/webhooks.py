import json

from flask import Blueprint, current_app, g, jsonify, request

from biti_partner import BitiClient
from http_helpers import settings, to_number
from store import now_iso

KEEP_EVENTS = 100

bp = Blueprint("webhooks", __name__)


def find_booking(store, predicate):
    return next((booking for booking in store.list("booking") if predicate(booking)), None)


def apply_bill_event(store, event, data):
    bill_id = data.get("external_id") or data.get("id")
    if event == "bill.account_connect_requested":
        account = data.get("account_number")
        customer = data.get("customer") or {}
        store.put("bill_account", f"request:{account}", {
            "account_number": account,
            "customer_name": data.get("customer_name") or customer.get("full_name") or customer.get("phone"),
            "requested_at": now_iso(),
        })
        return f"connect request for {account}"

    if not store.get("bill", bill_id):
        return "no bill"

    def apply(current):
        if event == "bill.disputed":
            current["status"] = "Disputed"
        if event == "bill.paid":
            paid = data.get("paid_amount")
            current["paid_amount"] = to_number(current["amount"] if paid is None else paid)
            current["status"] = "Part paid" if current["paid_amount"] < current["amount"] else "Paid"
    store.update("bill", bill_id, apply)
    return f"{bill_id} {store.get('bill', bill_id)['status']}"


def apply_event(store, event, data):
    """Applies one verified Biti event to local state. Returns what it changed, for the log."""
    def by_order():
        return find_booking(store, lambda booking: (booking.get("order") or {}).get("order_id") == data.get("id"))

    def by_hold():
        return find_booking(store, lambda booking: (booking.get("deposit") or {}).get("hold_id") == data.get("id"))

    if event == "payment.paid":
        booking = by_order()
        if not booking or booking["status"] == "cancelled":
            return "no booking for this order"

        def confirm(current):
            current.update(status="confirmed", transaction_id=data.get("transaction_id"))
            current["order"]["status"] = "paid"
        store.update("booking", booking["id"], confirm)
        return f"{booking['id']} confirmed"
    if event == "payment.failed":
        booking = by_order()
        if booking:
            store.update("booking", booking["id"], lambda current: current.update(payment_error=data.get("error")))
        return f"{booking['id']} payment failed" if booking else "no booking"
    if event == "refund.done":
        booking = by_order()
        if booking:
            store.update("booking", booking["id"], lambda current: current.update(
                status="cancelled", refund={**(current.get("refund") or {}), "refunded_amount": data.get("refunded_amount")}))
        return f"{booking['id']} refunded" if booking else "no booking"
    if event.startswith("hold."):
        booking = by_hold()
        status = event[len("hold."):]
        if booking:
            store.update("booking", booking["id"], lambda current: current["deposit"].update(status=status))
        return f"{booking['id']} deposit {status}" if booking else "no booking"
    if event.startswith("mandate."):
        plan = next((item for item in store.list("plan") if item.get("mandate_id") == data.get("id")), None)
        status = event[len("mandate."):]
        if plan and event != "mandate.charged":
            store.update("plan", plan["owner"], lambda current: current.update(status=status))
        return f"plan {status}" if plan else "no plan"
    if event.startswith("topup."):
        topup = store.get("topup", data.get("id"))
        status = "done" if event == "topup.done" else "failed"
        if topup:
            store.update("topup", data["id"], lambda current: current.update(status=status))
        return f"top-up {status}" if topup else "no top-up"
    if event.startswith("bill."):
        return apply_bill_event(store, event, data)
    return "ignored"


@bp.post("/webhooks/biti")
def receive():
    raw = request.get_data()
    if not BitiClient.verify_webhook(raw, request.headers, settings()["client_secret"]):
        current_app.logger.info("webhook rejected: bad signature %s", request.headers.get("X-Biti-Event"))
        return jsonify({"error": "bad signature"}), 401

    try:
        payload = json.loads(raw.decode("utf-8"))
    except ValueError:
        return jsonify({"error": "body is not JSON"}), 400
    if not isinstance(payload, dict) or not payload.get("id") or not payload.get("event"):
        return jsonify({"error": "id and event are required"}), 400

    def process():
        if g.store.get("event", payload["id"]):
            return None
        data = payload.get("data") or {}
        outcome = apply_event(g.store, str(payload["event"]), data)
        g.store.put("event", payload["id"], {
            "id": payload["id"],
            "event": payload["event"],
            "header_event": request.headers.get("X-Biti-Event"),
            "sent_at": request.headers.get("X-Biti-Timestamp"),
            "received_at": now_iso(),
            "result": outcome,
            "data": payload.get("data"),
        })
        g.store.keep_newest("event", KEEP_EVENTS)
        return outcome

    result = g.store.transaction(process)
    if result is None:
        return jsonify({"ok": True, "duplicate": True})
    current_app.logger.info("webhook %s %s: %s", payload["event"], payload["id"], result)
    return jsonify({"ok": True})
