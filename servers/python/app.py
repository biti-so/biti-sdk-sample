import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "sdk" / "python"))

import requests  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from flask import Flask, g, jsonify, request, send_from_directory  # noqa: E402
from werkzeug.exceptions import HTTPException  # noqa: E402
from werkzeug.middleware.proxy_fix import ProxyFix  # noqa: E402

import catalog  # noqa: E402
from biti_partner import BitiClient, BitiError  # noqa: E402
from routes import account, bills, bookings, dev, plan, webhooks  # noqa: E402
from session import load_session, set_session_cookie  # noqa: E402
from store import Store  # noqa: E402

PAGE_ROUTES = ["/", "/hotel/<id>", "/checkout/<id>", "/booking/<id>", "/bookings", "/plan", "/deposit/<id>", "/wallet", "/connect", "/dev", "/dev/bills", "/dev/webhooks"]
SESSION_FREE = ("/webhooks/", "/biller/")


def build_settings():
    load_dotenv(ROOT / ".env")
    env = os.environ.get
    settings = {
        "biti_base_url": (env("BITI_BASE_URL") or "http://192.168.100.200:8004").rstrip("/"),
        "biti_wallet_url": (env("BITI_WALLET_URL") or "http://192.168.100.200:8052").rstrip("/"),
        "client_id": env("BITI_CLIENT_ID"),
        "client_secret": env("BITI_CLIENT_SECRET"),
        "app_origins": [origin.strip().rstrip("/") for origin in (env("APP_ORIGINS") or "").split(",") if origin.strip()],
        "run_mode": "biti_only" if env("RUN_MODE") == "biti_only" else "anywhere",
        "app_id": env("BITI_APP_ID") or "daryeel-stays",
        "session_secret": env("SESSION_SECRET"),
        "dev_tools": env("DEV_TOOLS") == "1",
        "cookie_secure": env("COOKIE_SECURE") == "1",
        "db_path": str((ROOT / (env("DB_PATH") or "data/daryeel.sqlite")).resolve()),
        "server_calls": [],
    }
    for key in ("client_id", "client_secret", "session_secret"):
        if not settings[key]:
            raise RuntimeError(f"Missing {key.upper()} in .env. Copy .env.example to .env and fill it in.")
    return settings


def create_app():
    settings = build_settings()
    app = Flask(__name__, static_folder=str(ROOT / "public"), static_url_path="")
    app.json.sort_keys = False
    app.json.ensure_ascii = False
    app.config["DARYEEL"] = settings
    if os.environ.get("TRUST_PROXY") == "1":
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def trace(entry):
        calls = settings["server_calls"]
        calls.insert(0, {"at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), **entry})
        del calls[50:]
        app.logger.info("biti %s -> %s %sms", entry.get("name"), entry.get("status", "network error"), entry.get("ms"))

    settings["biti"] = BitiClient(settings["biti_base_url"], settings["client_id"], settings["client_secret"], on_trace=trace)

    seed = Store(settings["db_path"])
    bills.seed_accounts(seed)
    seed.close()

    @app.before_request
    def open_store():
        g.store = Store(settings["db_path"])
        if request.path.startswith("/api/"):
            load_session()

    @app.after_request
    def finish(response):
        if getattr(g, "new_session_id", None):
            set_session_cookie(response)
        return response

    @app.teardown_request
    def close_store(error=None):
        store = g.pop("store", None)
        if store:
            store.close()

    @app.get("/config.js")
    def config_js():
        import json
        page = {
            "sdkUrl": f"{settings['biti_base_url']}/assets/biti_wallet/js/biti-sdk.js",
            "bitiOrigin": settings["biti_wallet_url"],
            "runMode": settings["run_mode"],
            "appId": settings["app_id"],
            "loginScopes": account.LOGIN_SCOPES,
            "currency": catalog.CURRENCY,
            "cityTaxPerNight": catalog.CITY_TAX_PER_NIGHT,
            "depositAmount": catalog.DEPOSIT_AMOUNT,
            "planLimit": catalog.PLAN_LIMIT,
            "devTools": settings["dev_tools"],
        }
        body = "window.APP_CONFIG = " + json.dumps(page, separators=(",", ":")) + ";"
        return body, 200, {"Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store"}

    @app.get("/api/health")
    def health():
        started = time.monotonic()
        try:
            reachable = requests.get(f"{settings['biti_base_url']}/api/method/ping", timeout=5).ok
        except requests.RequestException:
            reachable = False
        return jsonify({"ok": True, "biti_reachable": reachable, "biti_base_url": settings["biti_base_url"], "ms": round((time.monotonic() - started) * 1000), "server": "python"})

    @app.get("/api/hotels")
    def hotels():
        return jsonify(catalog.HOTELS)

    for blueprint in (dev.bp, account.bp, bookings.bp, plan.bp, bills.bp):
        app.register_blueprint(blueprint, url_prefix="/api")
    app.register_blueprint(bills.lookup_bp)
    app.register_blueprint(webhooks.bp)

    def page(**_):
        return send_from_directory(app.static_folder, "index.html")

    for index, rule in enumerate(PAGE_ROUTES):
        app.add_url_rule(rule, endpoint=f"page_{index}", view_func=page)

    @app.errorhandler(BitiError)
    def biti_error(error):
        status = 502 if not error.status or error.status >= 500 else error.status
        payload = {"error": error.message, "source": "biti"}
        if error.code is not None:
            payload["code"] = error.code
        if error.data is not None:
            payload["data"] = error.data
        return jsonify(payload), status

    @app.errorhandler(Exception)
    def server_error(error):
        if isinstance(error, HTTPException):
            if request.path.startswith("/api/"):
                return jsonify({"error": error.description or error.name}), error.code
            return error
        app.logger.exception("error")
        return jsonify({"error": str(error) or "Something went wrong"}), 500

    return app


if __name__ == "__main__":
    application = create_app()
    port = int(os.environ.get("PORT") or 8090)
    application.run(host="0.0.0.0", port=port, threaded=True)
