import re
import time

from flask import Blueprint, g, jsonify, request

from catalog import CURRENCY
from http_helpers import biti, json_body, to_number
from session import is_signed_in, owner_of, require_user, sign_in, sign_out
from biti_partner import BitiError
from store import now_iso

LOGIN_SCOPES = ["profile.read", "wallet.read", "wallet.topup"]
REFERENCE_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
PHONE_PATTERN = re.compile(r"^\+?\d{7,15}$")

bp = Blueprint("account", __name__)


def public_user(session):
    if not is_signed_in(session):
        return {"signed_in": False}
    return {"signed_in": True, "via": session.get("via"), "user": session.get("user"), "scopes": session.get("scopes"), "expires_at": session.get("expires_at")}


@bp.get("/me")
def me():
    return jsonify(public_user(g.session))


@bp.post("/login")
def login():
    code = str(json_body().get("code") or "")
    if not code:
        return jsonify({"error": "code is required"}), 400
    sign_in(biti().call("exchange-login-code", {"code": code}), "mini_browser")
    return jsonify(public_user(g.session))


@bp.post("/logout")
def logout():
    sign_out()
    return jsonify({"signed_in": False})


@bp.post("/connect")
def connect():
    phone = re.sub(r"\s+", "", str(json_body().get("phone") or ""))
    if not PHONE_PATTERN.match(phone):
        return jsonify({"error": "Enter a phone number, for example +252615123456"}), 400
    data = biti().call("connect-request", {"phone": phone, "scopes": ",".join(LOGIN_SCOPES), "device": "Daryeel Stays web"})
    return jsonify({"request_token": data.get("request_token"), "expires_in": data.get("expires_in"), "install": data.get("install")})


@bp.get("/connect/<token>")
def connect_status(token):
    data = biti().call("connect-status", {"request_token": token})
    if data.get("access_token"):
        sign_in(data, "connect")
    return jsonify({"status": data.get("status"), "account_exists": data.get("account_exists"), "expires_in": data.get("expires_in"), "me": public_user(g.session)})


@bp.get("/wallet")
@require_user
def wallet():
    token = g.session["token"]
    wallet_data = biti().call("connected-wallet", {}, token)
    try:
        methods = biti().call("get-topup-methods", {}, token)
    except BitiError as error:
        methods = {"error": error.message, "methods": []}
    return jsonify({"wallet": wallet_data, "topup": methods})


@bp.post("/topup")
@require_user
def topup():
    body = json_body()
    amount = to_number(body.get("amount"))
    method_id = str(body.get("method_id") or "")
    key = request.headers.get("Idempotency-Key")
    reference = "TU-" + re.sub(r"[^A-Za-z0-9]", "", str(key or int(time.time() * 1000)))[:40]
    if not amount > 0 or not method_id or not REFERENCE_PATTERN.match(reference):
        return jsonify({"error": "method_id and an amount above 0 are required"}), 400

    try:
        data = biti().call(
            "create-topup",
            {"method_id": method_id, "amount": amount, "currency": body.get("currency") or CURRENCY, "reference": reference},
            g.session["token"],
        )
    except BitiError as error:
        if error.code == "needs_linking":
            link = error.data.get("link_url") if isinstance(error.data, dict) else None
            payload = {"error": error.message, "code": error.code}
            if link is not None:
                payload["link_url"] = link
            return jsonify(payload), 409
        raise
    g.store.put("topup", data["topup_id"], {**data, "reference": reference, "created_at": now_iso()}, owner_of(g.session))
    return jsonify(data)


@bp.get("/topup/<topup_id>")
@require_user
def topup_status(topup_id):
    data = biti().call("get-topup-status", {"topup_id": topup_id}, g.session["token"])
    if g.store.get("topup", topup_id):
        g.store.update("topup", topup_id, lambda topup: topup.update(data))
    return jsonify(data)
