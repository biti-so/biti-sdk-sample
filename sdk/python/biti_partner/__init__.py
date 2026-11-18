import hashlib
import hmac
import time

import requests

# (method, endpoint, needs customer token)
ENDPOINTS = [
    ("connect_request", "connect-request", False),
    ("connect_status", "connect-status", False),
    ("exchange_login_code", "exchange-login-code", False),
    ("connected_wallet", "connected-wallet", True),
    ("get_topup_methods", "get-topup-methods", True),
    ("create_topup", "create-topup", True),
    ("get_topup_status", "get-topup-status", True),
    ("create_payment_request", "create-payment-request", True),
    ("get_order_status", "get-order-status", False),
    ("create_order", "create-order", False),
    ("release_splits", "release-splits", False),
    ("get_payout_methods", "get-payout-methods", False),
    ("quote_bulk_send", "quote-bulk-send", False),
    ("create_bulk_send", "create-bulk-send", False),
    ("get_bulk_send_status", "get-bulk-send-status", False),
    ("create_mandate", "create-mandate", False),
    ("charge_mandate", "charge-mandate", False),
    ("get_mandate_status", "get-mandate-status", False),
    ("create_hold", "create-hold", False),
    ("capture_hold", "capture-hold", False),
    ("release_hold", "release-hold", False),
    ("get_hold_status", "get-hold-status", False),
    ("refund_order", "refund-order", False),
    ("create_payout", "create-payout", False),
    ("get_payout_status", "get-payout-status", False),
    ("get_statement", "get-statement", False),
    ("onboard_customer", "onboard-customer", False),
    ("onboard_verify", "onboard-verify", False),
    ("onboard_status", "onboard-status", False),
    ("billpay_push_bill", "billpay-push-bill", False),
    ("billpay_cancel_bill", "billpay-cancel-bill", False),
    ("billpay_bill_status", "billpay-bill-status", False),
    ("billpay_confirm_account", "billpay-confirm-account", False),
]

HIDDEN_IN_REQUEST = {"access_token", "client_secret", "code"}
HIDDEN_IN_RESPONSE = {"access_token", "client_secret"}


class BitiError(Exception):
    def __init__(self, message, status=0, code=None, data=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.data = data


def _redact(value, hidden):
    if isinstance(value, list):
        return [_redact(item, hidden) for item in value]
    if isinstance(value, dict):
        return {key: "•••" if key in hidden else _redact(inner, hidden) for key, inner in value.items()}
    return value


def _header(headers, name):
    for key, value in (headers or {}).items():
        if key.lower() == name:
            return value
    return None


class BitiClient:
    def __init__(self, base_url, client_id, client_secret, timeout_seconds=20, on_trace=None):
        self.base_url = base_url.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.timeout_seconds = timeout_seconds
        self.on_trace = on_trace

    def call(self, endpoint, body=None, token=None):
        body = body or {}
        headers = {
            "Content-Type": "application/json",
            "X-Biti-Client-Id": self.client_id,
            "X-Biti-Client-Secret": self.client_secret,
        }
        if token:
            headers["X-Biti-Token"] = token

        started = time.monotonic()

        def trace(**entry):
            if self.on_trace:
                self.on_trace({"name": endpoint, "ms": round((time.monotonic() - started) * 1000),
                               "request": _redact(body, HIDDEN_IN_REQUEST), **entry})

        try:
            response = requests.post(f"{self.base_url}/partner/v1/{endpoint}", json=body, headers=headers,
                                     timeout=self.timeout_seconds)
        except requests.RequestException as error:
            trace(error=str(error))
            raise BitiError(f"Can't reach Biti: {error}", 502) from error

        try:
            raw = response.json()
        except ValueError:
            raw = None
        try:
            data = self.parse_response(response.status_code, raw)
        except BitiError as error:
            trace(status=response.status_code, with_token=bool(token), error=error.message)
            raise
        trace(status=response.status_code, with_token=bool(token), response=_redact({"data": data}, HIDDEN_IN_RESPONSE))
        return data

    @staticmethod
    def parse_response(status, raw):
        if not isinstance(raw, dict):
            raw = {"success": False, "message": f"Biti answered {status} without JSON"}
        elif "success" not in raw and isinstance(raw.get("message"), dict):
            raw = raw["message"]

        if not 200 <= status < 300 or raw.get("success") is False:
            data = raw.get("data")
            code = raw.get("code") or (data.get("code") if isinstance(data, dict) else None)
            raise BitiError(raw.get("message") or f"Biti answered {status}", status, code, data)
        return raw.get("data")

    @staticmethod
    def verify_webhook(raw_body, headers, client_secret, now=None, tolerance=300):
        signature = _header(headers, "x-biti-signature")
        try:
            timestamp = float(_header(headers, "x-biti-timestamp"))
        except (TypeError, ValueError):
            return False
        if not signature or abs((time.time() if now is None else now) - timestamp) > tolerance:
            return False

        if isinstance(raw_body, str):
            raw_body = raw_body.encode()
        expected = hmac.new(client_secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, str(signature))

    @staticmethod
    def verify_lookup(raw_body, headers, client_secret, now=None, tolerance=300):
        return BitiClient.verify_webhook(raw_body, headers, client_secret, now, tolerance)


def _add_method(method, endpoint):
    def invoke(self, body=None, token=None):
        return self.call(endpoint, body, token)

    invoke.__name__ = method
    setattr(BitiClient, method, invoke)


for _method, _endpoint, _needs_token in ENDPOINTS:
    _add_method(_method, _endpoint)
