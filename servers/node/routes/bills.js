const express = require("express");

const { BitiClient } = require("../../../sdk/node");

const OPEN_STATUSES = new Set(["Open", "Part paid"]);
const DEMO_ACCOUNTS = [
  { account_number: "DS-1001", customer_name: "Ahmed Ali", area: "Mogadishu" },
  { account_number: "DS-1002", customer_name: "Hodan Warsame", area: "Hargeisa" },
  { account_number: "DS-1003", customer_name: "Abdi Salam", area: "Mogadishu" },
];

/** "part_paid" and "PAID" both become Biti's "Part paid" and "Paid". */
function billStatus(value) {
  const text = String(value || "").replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function seedAccounts(store) {
  for (const account of DEMO_ACCOUNTS) {
    if (!store.get("bill_account", account.account_number)) store.put("bill_account", account.account_number, account);
  }
}

/** Daryeel Stays as a Biti Bill Provider: push bills, answer Biti's account lookup. */
function billRoutes({ biti, store }) {
  const router = express.Router();

  router.get("/bills", (req, res) => {
    const rows = store.list("bill_account");
    res.json({
      accounts: rows.filter((row) => !row.requested_at).reverse(),
      bills: store.list("bill"),
      connect_requests: rows.filter((row) => row.requested_at),
    });
  });

  router.post("/bills", async (req, res, next) => {
    try {
      const { account_number: accountNumber, title, min_amount: minAmount, due_date: dueDate } = req.body;
      const amount = Number(req.body.amount);
      if (!store.get("bill_account", accountNumber)) return res.status(404).json({ error: "Unknown account", code: "unknown_account" });
      if (!String(title || "").trim() || !(amount > 0)) return res.status(400).json({ error: "title and an amount above 0 are required" });

      const externalId = `INV-${store.nextNumber("invoice", 1001)}`;
      const body = { account_number: accountNumber, external_id: externalId, title: String(title).trim(), amount };
      if (minAmount) body.min_amount = Number(minAmount);
      if (dueDate) body.due_date = String(dueDate);
      await biti.billpayPushBill(body);

      const bill = { id: externalId, external_id: externalId, ...body, due_date: body.due_date, status: "Open", paid_amount: 0, created_at: new Date().toISOString() };
      res.status(201).json(store.put("bill", externalId, bill, accountNumber));
    } catch (error) {
      next(error);
    }
  });

  function findBill(req, res) {
    const bill = store.get("bill", req.params.id);
    if (!bill) res.status(404).json({ error: "Bill not found" });
    return bill;
  }

  router.get("/bills/:id", async (req, res, next) => {
    try {
      if (!findBill(req, res)) return;
      const remote = await biti.billpayBillStatus({ external_id: req.params.id });
      res.json(store.update("bill", req.params.id, (bill) => {
        if (remote?.status) bill.status = billStatus(remote.status);
        if (remote?.paid_amount !== undefined) bill.paid_amount = Number(remote.paid_amount);
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bills/:id/cancel", async (req, res, next) => {
    try {
      if (!findBill(req, res)) return;
      await biti.billpayCancelBill({ external_id: req.params.id });
      res.json(store.update("bill", req.params.id, (bill) => { bill.status = "Cancelled"; }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bills/connect/:account", async (req, res, next) => {
    try {
      const requestId = `request:${req.params.account}`;
      if (!store.get("bill_account", requestId)) return res.status(404).json({ error: "No connect request for this account" });
      const data = await biti.billpayConfirmAccount({ account_number: req.params.account, approved: Boolean(req.body.approved) });
      store.delete("bill_account", requestId);
      res.json(data ?? { ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/** Biti calls this with a signed body. Verify the raw bytes before parsing. */
function lookupRoutes({ store, clientSecret }) {
  const router = express.Router();

  router.post("/biller/lookup", express.raw({ type: "*/*", limit: "100kb" }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!BitiClient.verifyLookup(raw, req.headers, clientSecret)) return res.status(401).json({ error: "bad signature" });

    let accountNumber;
    try {
      accountNumber = JSON.parse(raw.toString("utf8")).account_number;
    } catch {
      return res.status(400).json({ error: "body is not JSON" });
    }

    const account = store.get("bill_account", accountNumber);
    if (!account || account.requested_at) return res.status(404).json({ error: "unknown_account" });

    const invoices = store.list("bill", accountNumber)
      .filter((bill) => OPEN_STATUSES.has(bill.status))
      .map((bill) => ({ id: bill.external_id, title: bill.title, amount: bill.amount, min_amount: bill.min_amount ?? null, due: bill.due_date ?? null }));
    res.json({ customer_name: account.customer_name, area: account.area, invoices });
  });

  return router;
}

module.exports = { billRoutes, lookupRoutes, seedAccounts };
