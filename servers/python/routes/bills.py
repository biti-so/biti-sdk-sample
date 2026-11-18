import json

from flask import Blueprint, g, jsonify, request

from biti_partner import BitiClient
from http_helpers import biti, json_body, settings, to_number
from store import now_iso

OPEN_STATUSES = {"Open", "Part paid"}
DEMO_ACCOUNTS = [
    {"account_number": "DS-1001", "customer_name": "Ahmed Ali", "area": "Mogadishu"},
    {"account_number": "DS-1002", "customer_name": "Hodan Warsame", "area": "Hargeisa"},
    {"account_number": "DS-1003", "customer_name": "Abdi Salam", "area": "Mogadishu"},
]

bp = Blueprint("bills", __name__)
lookup_bp = Blueprint("lookup", __name__)


def bill_status(value):
    """"part_paid" and "PAID" both become Biti's "Part paid" and "Paid"."""
    text = str(value or "").replace("_", " ").lower()
    return text[:1].upper() + text[1:]


def seed_accounts(store):
    for account in DEMO_ACCOUNTS:
        if not store.get("bill_account", account["account_number"]):
            store.put("bill_account", account["account_number"], account)


@bp.get("/bills")
def list_bills():
    rows = g.store.list("bill_account")
    return jsonify({
        "accounts": [row for row in rows if not row.get("requested_at")][::-1],
        "bills": g.store.list("bill"),
        "connect_requests": [row for row in rows if row.get("requested_at")],
    })


@bp.post("/bills")
def push_bill():
    data = json_body()
    account_number = data.get("account_number")
    title = data.get("title")
    amount = to_number(data.get("amount"))
    if not isinstance(account_number, str) or not g.store.get("bill_account", account_number):
        return jsonify({"error": "Unknown account", "code": "unknown_account"}), 404
    if not str(title or "").strip() or not amount > 0:
        return jsonify({"error": "title and an amount above 0 are required"}), 400

    external_id = f"INV-{g.store.next_number('invoice', 1001)}"
    body = {"account_number": account_number, "external_id": external_id, "title": str(title).strip(), "amount": amount}
    if data.get("min_amount"):
        body["min_amount"] = to_number(data["min_amount"])
    if data.get("due_date"):
        body["due_date"] = str(data["due_date"])
    biti().call("billpay-push-bill", body)

    bill = {"id": external_id, **body, "status": "Open", "paid_amount": 0, "created_at": now_iso()}
    return jsonify(g.store.put("bill", external_id, bill, account_number)), 201


def bill_or_404(bill_id):
    return g.store.get("bill", bill_id)


@bp.get("/bills/<bill_id>")
def get_bill(bill_id):
    if not bill_or_404(bill_id):
        return jsonify({"error": "Bill not found"}), 404
    remote = biti().call("billpay-bill-status", {"external_id": bill_id})

    def apply(bill):
        if remote and remote.get("status"):
            bill["status"] = bill_status(remote["status"])
        if remote and remote.get("paid_amount") is not None:
            bill["paid_amount"] = to_number(remote["paid_amount"])
    return jsonify(g.store.update("bill", bill_id, apply))


@bp.post("/bills/<bill_id>/cancel")
def cancel_bill(bill_id):
    if not bill_or_404(bill_id):
        return jsonify({"error": "Bill not found"}), 404
    biti().call("billpay-cancel-bill", {"external_id": bill_id})
    return jsonify(g.store.update("bill", bill_id, lambda bill: bill.update(status="Cancelled")))


@bp.post("/bills/connect/<account>")
def confirm_account(account):
    request_id = f"request:{account}"
    if not g.store.get("bill_account", request_id):
        return jsonify({"error": "No connect request for this account"}), 404
    data = biti().call("billpay-confirm-account", {"account_number": account, "approved": bool(json_body().get("approved"))})
    g.store.delete("bill_account", request_id)
    return jsonify(data if data is not None else {"ok": True})


@lookup_bp.post("/biller/lookup")
def lookup():
    """Biti calls this with a signed body. Verify the raw bytes before parsing."""
    raw = request.get_data()
    if not BitiClient.verify_lookup(raw, request.headers, settings()["client_secret"]):
        return jsonify({"error": "bad signature"}), 401
    try:
        account_number = json.loads(raw.decode("utf-8")).get("account_number")
    except (ValueError, AttributeError):
        return jsonify({"error": "body is not JSON"}), 400

    account = g.store.get("bill_account", account_number) if isinstance(account_number, str) else None
    if not account or account.get("requested_at"):
        return jsonify({"error": "unknown_account"}), 404

    invoices = [
        {"id": bill.get("external_id"), "title": bill.get("title"), "amount": bill.get("amount"), "min_amount": bill.get("min_amount"), "due": bill.get("due_date")}
        for bill in g.store.list("bill", account_number) if bill.get("status") in OPEN_STATUSES
    ]
    return jsonify({"customer_name": account.get("customer_name"), "area": account.get("area"), "invoices": invoices})
