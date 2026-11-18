from flask import Blueprint, g, jsonify

from biti_partner import ENDPOINTS, BitiError
from http_helpers import biti, json_body, settings


def camel_case(endpoint):
    first, *rest = endpoint.split("-")
    return first + "".join(part.capitalize() for part in rest)


bp = Blueprint("dev", __name__)


@bp.before_request
def gate():
    if not settings()["dev_tools"]:
        return jsonify({"error": "Dev tools are off", "code": "dev_tools_off"}), 404


@bp.get("/dev/log")
def log():
    return jsonify({"server_calls": settings()["server_calls"][:50], "webhooks": g.store.list("event")[:20]})


@bp.get("/playground")
def list_endpoints():
    return jsonify({"endpoints": [{"method": camel_case(endpoint), "endpoint": endpoint, "token": needs_token} for _, endpoint, needs_token in ENDPOINTS]})


@bp.post("/playground/<endpoint>")
def run(endpoint):
    entry = next((item for item in ENDPOINTS if item[1] == endpoint), None)
    if not entry:
        return jsonify({"ok": False, "status": 404, "error": "Unknown endpoint"})
    if entry[2] and not g.session.get("token"):
        return jsonify({"ok": False, "status": 401, "error": "Sign in with Biti first", "code": "sign_in_required"})
    body = json_body().get("body")
    try:
        data = biti().call(endpoint, body if isinstance(body, dict) else {}, g.session.get("token") if entry[2] else None)
        return jsonify({"ok": True, "status": 200, "data": data})
    except BitiError as error:
        payload = {"ok": False, "status": error.status or 500, "error": error.message}
        if error.code:
            payload["code"] = error.code
        if error.data is not None:
            payload["data"] = error.data
        return jsonify(payload)


@bp.route("/dev/<path:rest>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def unknown(rest):
    return jsonify({"error": "Not found"}), 404
