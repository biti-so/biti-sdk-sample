const express = require("express");

const { CURRENCY, DEPOSIT_AMOUNT, MAX_NIGHTS, getHotel, quoteStay } = require("../catalog");
const { ownerOf, requireUser } = require("../session");

const DAY_MS = 24 * 3600 * 1000;
const RETRYABLE_ORDER = new Set(["expired", "cancelled", "failed"]);

function toLocalDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function addDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Free cancellation ends 24 hours before check-in at 12:00. */
function cancelDeadline(booking) {
  return new Date(Date.parse(`${booking.check_in}T12:00:00`) - DAY_MS);
}

function parseStay(body) {
  const hotel = getHotel(body.hotel_id);
  const nights = Number(body.nights);
  const guests = Number(body.guests);
  const checkIn = String(body.check_in || "");
  if (!hotel) return { error: "Unknown hotel" };
  if (!Number.isInteger(nights) || nights < 1 || nights > MAX_NIGHTS) return { error: `Nights must be 1 to ${MAX_NIGHTS}` };
  if (!Number.isInteger(guests) || guests < 1 || guests > 6) return { error: "Guests must be 1 to 6" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || checkIn < new Date().toISOString().slice(0, 10)) return { error: "Pick a check-in date from today on" };
  return { hotel, nights, guests, checkIn };
}

/** Bookings: orders, payment checks, refunds and the room deposit hold. */
function bookingRoutes({ biti, store, returnUrl }) {
  const router = express.Router();

  function ownBooking(req) {
    const booking = store.get("booking", req.params.id || req.body.booking_id);
    return booking && booking.owner === ownerOf(req.session) ? booking : null;
  }

  async function startPayment(req, booking) {
    const { attempts } = store.update("booking", booking.id, (current) => { current.attempts += 1; });
    const reference = `${booking.id}-P${attempts}`;
    const order = await biti.call("create-order", {
      amount: booking.quote.total,
      currency: booking.quote.currency,
      reference,
      description: `${booking.hotel_name} · ${booking.nights} night${booking.nights > 1 ? "s" : ""} from ${booking.check_in}`,
      return_url: returnUrl(req, `/booking/${booking.id}`),
    });
    return store.update("booking", booking.id, (current) => {
      current.order = { ...order, reference };
      current.status = "awaiting_payment";
    });
  }

  /** Only Biti's answer confirms a booking, never the page. */
  async function syncOrder(booking) {
    if (!booking.order || booking.status === "cancelled") return booking;
    const order = await biti.call("get-order-status", { order_id: booking.order.order_id });
    return store.update("booking", booking.id, (current) => {
      current.order.status = order.status;
      if (order.status === "paid" || order.status === "partially_refunded") {
        Object.assign(current, { status: "confirmed", transaction_id: order.transaction_id, paid_at: order.paid_at });
      }
      if (order.status === "refunded") current.status = "cancelled";
      if (RETRYABLE_ORDER.has(order.status) && current.status === "awaiting_payment") current.status = "payment_" + order.status;
    });
  }

  router.all(["/bookings", "/bookings/*", "/deposit", "/deposit/*"], requireUser);

  router.get("/bookings", (req, res) => {
    res.json(store.list("booking", ownerOf(req.session)));
  });

  router.post("/bookings", async (req, res, next) => {
    try {
      const key = req.get("Idempotency-Key");
      const earlier = store.get("idempotency", key);
      if (key && earlier) return res.json(store.get("booking", earlier.booking_id));

      const stay = parseStay(req.body);
      if (stay.error) return res.status(400).json({ error: stay.error });
      const booking = {
        id: `BK-${store.nextNumber("booking", 2041)}`,
        owner: ownerOf(req.session),
        guest: req.session.user,
        hotel_id: stay.hotel.id,
        hotel_name: stay.hotel.name,
        room: stay.hotel.room,
        check_in: stay.checkIn,
        check_out: addDays(stay.checkIn, stay.nights),
        nights: stay.nights,
        guests: stay.guests,
        quote: quoteStay(stay.hotel, stay.nights),
        paid_by: "order",
        attempts: 0,
        created_at: new Date().toISOString(),
      };
      store.transaction(() => {
        store.put("booking", booking.id, booking, booking.owner);
        if (key) store.put("idempotency", key, { booking_id: booking.id });
      });
      res.status(201).json(await startPayment(req, booking));
    } catch (error) {
      next(error);
    }
  });

  router.get("/bookings/:id", async (req, res, next) => {
    try {
      const booking = ownBooking(req);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      const synced = await syncOrder(booking);
      res.json({ ...synced, cancel_until: cancelDeadline(synced).toISOString() });
    } catch (error) {
      next(error);
    }
  });

  // A new attempt only when the last order can no longer be paid.
  router.post("/bookings/:id/pay", async (req, res, next) => {
    try {
      const booking = ownBooking(req);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      const synced = await syncOrder(booking);
      if (synced.status === "confirmed") return res.json(synced);
      const retry = !synced.order || RETRYABLE_ORDER.has(synced.order.status);
      res.json(retry ? await startPayment(req, synced) : synced);
    } catch (error) {
      next(error);
    }
  });

  router.post("/bookings/:id/cancel", async (req, res, next) => {
    try {
      const booking = ownBooking(req);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      if (booking.status !== "confirmed" || booking.paid_by !== "order") return res.status(409).json({ error: "Only a paid booking can be cancelled here" });
      if (new Date() > cancelDeadline(booking)) return res.status(409).json({ error: "Free cancellation has ended for this booking" });

      const refund = await biti.call("refund-order", {
        order_id: booking.order.order_id,
        reason: "Guest cancelled the booking",
        reference: `${booking.id}-refund`,
      });
      const released = booking.deposit?.status === "held" ? await biti.call("release-hold", { hold_id: booking.deposit.hold_id }) : null;
      res.json(store.update("booking", booking.id, (current) => {
        Object.assign(current, { status: "cancelled", refund, cancelled_at: new Date().toISOString() });
        if (released) current.deposit = { ...current.deposit, ...released };
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/deposit", async (req, res, next) => {
    try {
      const booking = ownBooking(req);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      if (booking.status !== "confirmed") return res.status(409).json({ error: "Pay the booking first" });
      if (booking.deposit && booking.deposit.status !== "expired") return res.json(booking.deposit);

      const latest = new Date(Date.now() + 29 * DAY_MS);
      const releaseBy = new Date(Math.min(Date.parse(`${booking.check_out}T12:00:00`), latest.getTime()));
      const hold = await biti.call("create-hold", {
        amount: DEPOSIT_AMOUNT,
        currency: CURRENCY,
        reference: `${booking.id}-deposit`,
        release_by: toLocalDateTime(releaseBy),
        description: `Room deposit · ${booking.hotel_name} · ${booking.id}`,
        return_url: returnUrl(req, `/booking/${booking.id}`),
      });
      const updated = store.update("booking", booking.id, (current) => {
        current.deposit = { ...hold, amount: DEPOSIT_AMOUNT, release_by: releaseBy.toISOString() };
      });
      res.json(updated.deposit);
    } catch (error) {
      next(error);
    }
  });

  function depositBooking(req) {
    const owner = ownerOf(req.session);
    return store.list("booking", owner).find((booking) => booking.deposit?.hold_id === req.params.holdId) || null;
  }

  router.get("/deposit/:holdId", async (req, res, next) => {
    try {
      const booking = depositBooking(req);
      if (!booking) return res.status(404).json({ error: "Deposit not found" });
      const hold = await biti.call("get-hold-status", { hold_id: req.params.holdId });
      res.json(store.update("booking", booking.id, (current) => Object.assign(current.deposit, hold)).deposit);
    } catch (error) {
      next(error);
    }
  });

  // In a real hotel only staff release or capture; the sample shows both calls.
  for (const action of ["release", "capture"]) {
    router.post(`/deposit/:holdId/${action}`, async (req, res, next) => {
      try {
        const booking = depositBooking(req);
        if (!booking) return res.status(404).json({ error: "Deposit not found" });
        const body = { hold_id: req.params.holdId };
        if (action === "capture" && req.body.amount) body.amount = Number(req.body.amount);
        const hold = await biti.call(`${action}-hold`, body);
        res.json(store.update("booking", booking.id, (current) => Object.assign(current.deposit, hold)).deposit);
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}

module.exports = { bookingRoutes, addDays };
