import re
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from catalog import CURRENCY, PLAN_LIMIT, get_hotel, quote_stay
from http_helpers import biti, json_body, return_url, to_number
from routes.bookings import add_days
from session import is_signed_in, owner_of
from store import now_iso

ENDED = {"revoked", "expired"}

bp = Blueprint("plan", __name__)


@bp.before_request
def gate():
    if not is_signed_in(g.session):
        return jsonify({"error": "Sign in with Biti first", "code": "sign_in_required"}), 401


def sync_plan(plan, owner):
    status = biti().call("get-mandate-status", {"mandate_id": plan["mandate_id"]})
    return g.store.update("plan", owner, lambda current: current.update(status))


@bp.get("/plan")
def get_plan():
    owner = owner_of(g.session)
    plan = g.store.get("plan", owner)
    return jsonify(sync_plan(plan, owner) if plan else None)


@bp.post("/plan")
def create_plan():
    owner = owner_of(g.session)
    earlier = g.store.get("plan", owner)
    if earlier and earlier.get("status") not in ENDED:
        return jsonify(sync_plan(earlier, owner))

    sequence = ((earlier or {}).get("sequence") or 0) + 1
    digits = re.sub(r"\D", "", owner)[-9:] or "guest"
    reference = f"PLAN-{digits}-{sequence}"
    mandate = biti().call("create-mandate", {
        "max_amount": PLAN_LIMIT,
        "currency": CURRENCY,
        "period": "month",
        "reference": reference,
        "description": "Monthly stay plan: up to 4 nights a month",
        "return_url": return_url("/plan"),
    })
    plan = {**mandate, "owner": owner, "reference": reference, "sequence": sequence, "max_amount": PLAN_LIMIT, "period": "month", "charges": []}
    return jsonify(g.store.put("plan", owner, plan, owner)), 201


@bp.post("/plan/charge")
def charge_plan():
    owner = owner_of(g.session)
    plan = g.store.get("plan", owner)
    if not plan:
        return jsonify({"error": "Set up the monthly plan first"}), 409
    key = request.headers.get("Idempotency-Key")
    earlier = g.store.get("idempotency", key) if key else None
    if key and earlier:
        return jsonify(g.store.get("booking", earlier["booking_id"]))

    body = json_body()
    hotel = get_hotel(body.get("hotel_id"))
    nights = to_number(body.get("nights")) or 1
    tomorrow = add_days(datetime.now(timezone.utc).strftime("%Y-%m-%d"), 1)
    check_in = str(body.get("check_in") or tomorrow)
    if not hotel or not 1 <= nights <= 4:
        return jsonify({"error": "Pick a hotel and 1 to 4 nights"}), 400

    quote = quote_stay(hotel, nights)
    booking_id = f"BK-{g.store.next_number('booking', 2041)}"
    reference = f"{booking_id}-PLAN"
    charge = biti().call("charge-mandate", {"mandate_id": plan["mandate_id"], "amount": quote["total"], "reference": reference})
    booking = {
        "id": booking_id, "owner": owner, "guest": g.session.get("user"), "hotel_id": hotel["id"], "hotel_name": hotel["name"],
        "room": hotel["room"], "check_in": check_in, "check_out": add_days(check_in, int(nights)), "nights": nights, "guests": 1,
        "quote": quote, "paid_by": "plan", "status": "confirmed", "attempts": 0,
        "transaction_id": charge.get("transaction_id"), "plan_reference": reference, "created_at": now_iso(),
    }

    def save():
        g.store.put("booking", booking_id, booking, owner)
        g.store.update("plan", owner, lambda current: current["charges"].insert(0, {"reference": reference, "booking_id": booking_id, "amount": quote["total"], "at": now_iso()}))
        if key:
            g.store.put("idempotency", key, {"booking_id": booking_id})
    g.store.transaction(save)
    sync_plan(g.store.get("plan", owner), owner)
    return jsonify(booking), 201
