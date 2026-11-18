import re
from datetime import datetime, timedelta, timezone

from flask import Blueprint, g, jsonify, request

from catalog import CURRENCY, DEPOSIT_AMOUNT, MAX_NIGHTS, get_hotel, quote_stay
from http_helpers import biti, json_body, return_url, to_number
from session import is_signed_in, owner_of
from store import now_iso

RETRYABLE_ORDER = {"expired", "cancelled", "failed"}
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

bp = Blueprint("bookings", __name__)


def iso_utc(moment):
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def to_local_datetime(moment):
    return moment.astimezone().strftime("%Y-%m-%d %H:%M:00")


def add_days(iso_date, days):
    return (datetime.strptime(iso_date, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")


def cancel_deadline(booking):
    """Free cancellation ends 24 hours before check-in at 12:00 (server local time)."""
    return datetime.strptime(booking["check_in"], "%Y-%m-%d").replace(hour=12).astimezone() - timedelta(days=1)


def parse_stay(body):
    hotel = get_hotel(body.get("hotel_id"))
    nights = to_number(body.get("nights"))
    guests = to_number(body.get("guests"))
    check_in = str(body.get("check_in") or "")
    if not hotel:
        return {"error": "Unknown hotel"}
    if not isinstance(nights, int) or nights < 1 or nights > MAX_NIGHTS:
        return {"error": f"Nights must be 1 to {MAX_NIGHTS}"}
    if not isinstance(guests, int) or guests < 1 or guests > 6:
        return {"error": "Guests must be 1 to 6"}
    if not DATE_PATTERN.match(check_in) or check_in < datetime.now(timezone.utc).strftime("%Y-%m-%d"):
        return {"error": "Pick a check-in date from today on"}
    return {"hotel": hotel, "nights": nights, "guests": guests, "check_in": check_in}


def own_booking(booking_id):
    booking = g.store.get("booking", booking_id)
    return booking if booking and booking.get("owner") == owner_of(g.session) else None


def start_payment(booking):
    attempts = g.store.update("booking", booking["id"], lambda current: current.update(attempts=current["attempts"] + 1))["attempts"]
    reference = f"{booking['id']}-P{attempts}"
    nights = booking["nights"]
    order = biti().call("create-order", {
        "amount": booking["quote"]["total"],
        "currency": booking["quote"]["currency"],
        "reference": reference,
        "description": f"{booking['hotel_name']} · {nights} night{'s' if nights > 1 else ''} from {booking['check_in']}",
        "return_url": return_url(f"/booking/{booking['id']}"),
    })

    def apply(current):
        current["order"] = {**order, "reference": reference}
        current["status"] = "awaiting_payment"
    return g.store.update("booking", booking["id"], apply)


def sync_order(booking):
    """Only Biti's answer confirms a booking, never the page."""
    if not booking.get("order") or booking["status"] == "cancelled":
        return booking
    order = biti().call("get-order-status", {"order_id": booking["order"]["order_id"]})

    def apply(current):
        status = order.get("status")
        current["order"]["status"] = status
        if status in ("paid", "partially_refunded"):
            current.update(status="confirmed", transaction_id=order.get("transaction_id"), paid_at=order.get("paid_at"))
        if status == "refunded":
            current["status"] = "cancelled"
        if status in RETRYABLE_ORDER and current["status"] == "awaiting_payment":
            current["status"] = "payment_" + status
    return g.store.update("booking", booking["id"], apply)


@bp.before_request
def gate():
    if not is_signed_in(g.session):
        return jsonify({"error": "Sign in with Biti first", "code": "sign_in_required"}), 401


@bp.get("/bookings")
def list_bookings():
    return jsonify(g.store.list("booking", owner_of(g.session)))


@bp.post("/bookings")
def create_booking():
    key = request.headers.get("Idempotency-Key")
    earlier = g.store.get("idempotency", key) if key else None
    if key and earlier:
        return jsonify(g.store.get("booking", earlier["booking_id"]))

    stay = parse_stay(json_body())
    if "error" in stay:
        return jsonify({"error": stay["error"]}), 400
    hotel = stay["hotel"]
    booking = {
        "id": f"BK-{g.store.next_number('booking', 2041)}",
        "owner": owner_of(g.session),
        "guest": g.session.get("user"),
        "hotel_id": hotel["id"],
        "hotel_name": hotel["name"],
        "room": hotel["room"],
        "check_in": stay["check_in"],
        "check_out": add_days(stay["check_in"], stay["nights"]),
        "nights": stay["nights"],
        "guests": stay["guests"],
        "quote": quote_stay(hotel, stay["nights"]),
        "paid_by": "order",
        "attempts": 0,
        "created_at": now_iso(),
    }

    def save():
        g.store.put("booking", booking["id"], booking, booking["owner"])
        if key:
            g.store.put("idempotency", key, {"booking_id": booking["id"]})
    g.store.transaction(save)
    return jsonify(start_payment(booking)), 201


@bp.get("/bookings/<booking_id>")
def get_booking(booking_id):
    booking = own_booking(booking_id)
    if not booking:
        return jsonify({"error": "Booking not found"}), 404
    synced = sync_order(booking)
    return jsonify({**synced, "cancel_until": iso_utc(cancel_deadline(synced))})


@bp.post("/bookings/<booking_id>/pay")
def pay_booking(booking_id):
    booking = own_booking(booking_id)
    if not booking:
        return jsonify({"error": "Booking not found"}), 404
    synced = sync_order(booking)
    if synced["status"] == "confirmed":
        return jsonify(synced)
    retry = not synced.get("order") or synced["order"].get("status") in RETRYABLE_ORDER
    return jsonify(start_payment(synced) if retry else synced)


@bp.post("/bookings/<booking_id>/cancel")
def cancel_booking(booking_id):
    booking = own_booking(booking_id)
    if not booking:
        return jsonify({"error": "Booking not found"}), 404
    if booking["status"] != "confirmed" or booking.get("paid_by") != "order":
        return jsonify({"error": "Only a paid booking can be cancelled here"}), 409
    if datetime.now(timezone.utc) > cancel_deadline(booking):
        return jsonify({"error": "Free cancellation has ended for this booking"}), 409

    refund = biti().call("refund-order", {
        "order_id": booking["order"]["order_id"],
        "reason": "Guest cancelled the booking",
        "reference": f"{booking['id']}-refund",
    })
    deposit = booking.get("deposit")
    released = biti().call("release-hold", {"hold_id": deposit["hold_id"]}) if deposit and deposit.get("status") == "held" else None

    def apply(current):
        current.update(status="cancelled", refund=refund, cancelled_at=now_iso())
        if released:
            current["deposit"] = {**current["deposit"], **released}
    return jsonify(g.store.update("booking", booking["id"], apply))


@bp.post("/deposit")
def create_deposit():
    booking = own_booking(json_body().get("booking_id"))
    if not booking:
        return jsonify({"error": "Booking not found"}), 404
    if booking["status"] != "confirmed":
        return jsonify({"error": "Pay the booking first"}), 409
    deposit = booking.get("deposit")
    if deposit and deposit.get("status") != "expired":
        return jsonify(deposit)

    checkout_noon = datetime.strptime(booking["check_out"], "%Y-%m-%d").replace(hour=12).astimezone()
    release_by = min(checkout_noon, datetime.now(timezone.utc) + timedelta(days=29))
    hold = biti().call("create-hold", {
        "amount": DEPOSIT_AMOUNT,
        "currency": CURRENCY,
        "reference": f"{booking['id']}-deposit",
        "release_by": to_local_datetime(release_by),
        "description": f"Room deposit · {booking['hotel_name']} · {booking['id']}",
        "return_url": return_url(f"/booking/{booking['id']}"),
    })

    def apply(current):
        current["deposit"] = {**hold, "amount": DEPOSIT_AMOUNT, "release_by": iso_utc(release_by)}
    return jsonify(g.store.update("booking", booking["id"], apply)["deposit"])


def deposit_booking(hold_id):
    owner = owner_of(g.session)
    return next((item for item in g.store.list("booking", owner) if (item.get("deposit") or {}).get("hold_id") == hold_id), None)


@bp.get("/deposit/<hold_id>")
def get_deposit(hold_id):
    booking = deposit_booking(hold_id)
    if not booking:
        return jsonify({"error": "Deposit not found"}), 404
    hold = biti().call("get-hold-status", {"hold_id": hold_id})
    return jsonify(g.store.update("booking", booking["id"], lambda current: current["deposit"].update(hold))["deposit"])


def deposit_action(hold_id, action):
    booking = deposit_booking(hold_id)
    if not booking:
        return jsonify({"error": "Deposit not found"}), 404
    body = {"hold_id": hold_id}
    amount = json_body().get("amount")
    if action == "capture" and amount:
        body["amount"] = to_number(amount)
    hold = biti().call(f"{action}-hold", body)
    return jsonify(g.store.update("booking", booking["id"], lambda current: current["deposit"].update(hold))["deposit"])


@bp.post("/deposit/<hold_id>/release")
def release_deposit(hold_id):
    return deposit_action(hold_id, "release")


@bp.post("/deposit/<hold_id>/capture")
def capture_deposit(hold_id):
    return deposit_action(hold_id, "capture")
