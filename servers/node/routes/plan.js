const express = require("express");

const { CURRENCY, PLAN_LIMIT, getHotel, quoteStay } = require("../catalog");
const { addDays } = require("./bookings");
const { ownerOf, requireUser } = require("../session");

const ENDED = new Set(["revoked", "expired"]);

/** Monthly stay plan: a Biti mandate the server charges for each stay. */
function planRoutes({ biti, store, returnUrl }) {
  const router = express.Router();
  router.all(["/plan", "/plan/*"], requireUser);

  async function syncPlan(plan, owner) {
    const status = await biti.call("get-mandate-status", { mandate_id: plan.mandate_id });
    return store.update("plan", owner, (current) => Object.assign(current, status));
  }

  router.get("/plan", async (req, res, next) => {
    try {
      const owner = ownerOf(req.session);
      const plan = store.get("plan", owner);
      res.json(plan ? await syncPlan(plan, owner) : null);
    } catch (error) {
      next(error);
    }
  });

  router.post("/plan", async (req, res, next) => {
    try {
      const owner = ownerOf(req.session);
      const earlier = store.get("plan", owner);
      if (earlier && !ENDED.has(earlier.status)) return res.json(await syncPlan(earlier, owner));

      const sequence = (earlier?.sequence || 0) + 1;
      const reference = `PLAN-${owner.replace(/\D/g, "").slice(-9) || "guest"}-${sequence}`;
      const mandate = await biti.call("create-mandate", {
        max_amount: PLAN_LIMIT,
        currency: CURRENCY,
        period: "month",
        reference,
        description: "Monthly stay plan: up to 4 nights a month",
        return_url: returnUrl(req, "/plan"),
      });
      const plan = { ...mandate, owner, reference, sequence, max_amount: PLAN_LIMIT, period: "month", charges: [] };
      res.status(201).json(store.put("plan", owner, plan, owner));
    } catch (error) {
      next(error);
    }
  });

  // Books one stay and charges it to the plan, without a payment sheet.
  router.post("/plan/charge", async (req, res, next) => {
    try {
      const owner = ownerOf(req.session);
      const plan = store.get("plan", owner);
      if (!plan) return res.status(409).json({ error: "Set up the monthly plan first" });
      const key = req.get("Idempotency-Key");
      const earlier = store.get("idempotency", key);
      if (key && earlier) return res.json(store.get("booking", earlier.booking_id));

      const hotel = getHotel(req.body.hotel_id);
      const nights = Number(req.body.nights) || 1;
      const checkIn = String(req.body.check_in || addDays(new Date().toISOString().slice(0, 10), 1));
      if (!hotel || nights < 1 || nights > 4) return res.status(400).json({ error: "Pick a hotel and 1 to 4 nights" });

      const quote = quoteStay(hotel, nights);
      const id = `BK-${store.nextNumber("booking", 2041)}`;
      const reference = `${id}-PLAN`;
      const charge = await biti.call("charge-mandate", { mandate_id: plan.mandate_id, amount: quote.total, reference });
      const booking = {
        id, owner, guest: req.session.user, hotel_id: hotel.id, hotel_name: hotel.name, room: hotel.room,
        check_in: checkIn, check_out: addDays(checkIn, nights), nights, guests: 1, quote,
        paid_by: "plan", status: "confirmed", attempts: 0,
        transaction_id: charge.transaction_id, plan_reference: reference,
        created_at: new Date().toISOString(),
      };
      store.transaction(() => {
        store.put("booking", id, booking, owner);
        store.update("plan", owner, (current) => current.charges.unshift({ reference, booking_id: id, amount: quote.total, at: new Date().toISOString() }));
        if (key) store.put("idempotency", key, { booking_id: id });
      });
      await syncPlan(store.get("plan", owner), owner);
      res.status(201).json(booking);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { planRoutes };
