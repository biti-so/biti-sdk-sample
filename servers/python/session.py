import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from functools import wraps

from flask import current_app, g, jsonify, request

COOKIE = "daryeel_sid"
MAX_AGE = 30 * 24 * 3600


def _sign(session_id, secret):
    return hmac.new(secret.encode(), session_id.encode(), hashlib.sha256).hexdigest()


def _read_cookie(value, secret):
    if not value or "." not in value:
        return None
    session_id, signature = value.rsplit(".", 1)
    return session_id if hmac.compare_digest(_sign(session_id, secret), signature) else None


def load_session():
    """Every visitor gets a signed session id cookie. The Biti token stays in the `session` rows."""
    config = current_app.config["DARYEEL"]
    session_id = _read_cookie(request.cookies.get(COOKIE), config["session_secret"])
    data = g.store.get("session", session_id) if session_id else None
    g.new_session_id = None
    if data is None:
        session_id = secrets.token_hex(24)
        data = g.store.put("session", session_id, {"id": session_id})
        g.new_session_id = session_id
    g.session_id = session_id
    g.session = data


def set_session_cookie(response):
    session_id = getattr(g, "new_session_id", None)
    if session_id:
        config = current_app.config["DARYEEL"]
        response.set_cookie(
            COOKIE, f"{session_id}.{_sign(session_id, config['session_secret'])}",
            max_age=MAX_AGE, httponly=True, samesite="Lax", secure=config["cookie_secure"],
        )
    return response


def save_session():
    g.store.put("session", g.session_id, g.session)


def sign_in(data, via):
    g.session.update({
        "token": data.get("access_token"), "expires_at": data.get("expires_at"),
        "scopes": data.get("scopes") or [], "user": data.get("user") or {}, "via": via,
    })
    save_session()


def sign_out():
    for key in ("token", "expires_at", "scopes", "user", "via"):
        g.session.pop(key, None)
    save_session()


def is_signed_in(session):
    if not session.get("token"):
        return False
    expires_at = session.get("expires_at")
    if not expires_at:
        return True
    try:
        parsed = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        return True
    if parsed.tzinfo is None:
        parsed = parsed.astimezone()
    return parsed > datetime.now(timezone.utc)


def owner_of(session):
    """The customer key for bookings and plans: the phone Biti returned at sign-in."""
    user = session.get("user") or {}
    return user.get("phone") or user.get("full_name") or session["id"]


def require_user(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_signed_in(g.session):
            return jsonify({"error": "Sign in with Biti first", "code": "sign_in_required"}), 401
        return view(*args, **kwargs)
    return wrapped
