const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "store.json");
const EMPTY = { nextBooking: 2041, bookings: {}, plans: {}, topups: {}, events: [], seenEvents: {}, idempotency: {} };

/** Bookings, plans, top-ups and webhook events in one JSON file. One Node process owns it. */
class Store {
  constructor(file = FILE) {
    this.file = file;
    this.data = structuredClone(EMPTY);
    if (fs.existsSync(file)) Object.assign(this.data, JSON.parse(fs.readFileSync(file, "utf8")));
  }

  save() {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2));
    fs.renameSync(temporary, this.file);
  }

  newBookingId() {
    const id = `BK-${this.data.nextBooking}`;
    this.data.nextBooking += 1;
    return id;
  }

  get bookings() {
    return this.data.bookings;
  }

  get plans() {
    return this.data.plans;
  }

  get topups() {
    return this.data.topups;
  }

  findBooking(predicate) {
    return Object.values(this.data.bookings).find(predicate) || null;
  }

  /** Returns the earlier answer for a repeated client key, or null. */
  getIdempotent(key) {
    return key ? this.data.idempotency[key] ?? null : null;
  }

  putIdempotent(key, value) {
    if (key) this.data.idempotency[key] = value;
  }

  hasSeenEvent(eventId) {
    return Boolean(this.data.seenEvents[eventId]);
  }

  recordEvent(event) {
    this.data.seenEvents[event.id] = event.received_at;
    this.data.events.unshift(event);
    this.data.events.length = Math.min(this.data.events.length, 100);
  }
}

module.exports = { Store };
