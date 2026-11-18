const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  owner TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS records_owner ON records (kind, owner);
`;

/** Every record lives in one SQLite table: kind + id + JSON data. */
class Store {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    this.depth = 0;
  }

  get(kind, id) {
    const row = this.db.prepare("SELECT data FROM records WHERE kind = ? AND id = ?").get(kind, String(id));
    return row ? JSON.parse(row.data) : null;
  }

  put(kind, id, data, owner = null) {
    this.db
      .prepare(
        `INSERT INTO records (kind, id, owner, data, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (kind, id) DO UPDATE SET owner = COALESCE(excluded.owner, owner), data = excluded.data`
      )
      .run(kind, String(id), owner, JSON.stringify(data), new Date().toISOString());
    return data;
  }

  delete(kind, id) {
    this.db.prepare("DELETE FROM records WHERE kind = ? AND id = ?").run(kind, String(id));
  }

  /** Newest first. */
  list(kind, owner) {
    const rows = owner === undefined
      ? this.db.prepare("SELECT data FROM records WHERE kind = ? ORDER BY created_at DESC, rowid DESC").all(kind)
      : this.db.prepare("SELECT data FROM records WHERE kind = ? AND owner = ? ORDER BY created_at DESC, rowid DESC").all(kind, owner);
    return rows.map((row) => JSON.parse(row.data));
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS total FROM records").get().total;
  }

  /** Runs fn inside BEGIN IMMEDIATE. Nested calls join the open transaction. */
  transaction(fn) {
    if (this.depth > 0) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  /** Read-modify-write one record. mutate edits the record in place (synchronously). */
  update(kind, id, mutate) {
    return this.transaction(() => {
      const data = this.get(kind, id);
      if (!data) throw new Error(`${kind} ${id} not found`);
      mutate(data);
      return this.put(kind, id, data, data.owner ?? null);
    });
  }

  nextNumber(counter, start) {
    return this.transaction(() => {
      const { next } = this.get("counter", counter) || { next: start };
      this.put("counter", counter, { next: next + 1 });
      return next;
    });
  }

  keepNewest(kind, limit) {
    this.db
      .prepare(
        `DELETE FROM records WHERE kind = ? AND rowid NOT IN
         (SELECT rowid FROM records WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`
      )
      .run(kind, kind, limit);
  }

  /** One-time import of the old JSON store into an empty database. */
  importLegacy(file) {
    if (!fs.existsSync(file) || this.count() > 0) return false;
    const old = JSON.parse(fs.readFileSync(file, "utf8"));

    this.transaction(() => {
      for (const booking of Object.values(old.bookings || {})) this.put("booking", booking.id, booking, booking.owner);
      for (const [owner, plan] of Object.entries(old.plans || {})) this.put("plan", owner, plan, owner);
      for (const [id, topup] of Object.entries(old.topups || {})) this.put("topup", id, topup);
      for (const [key, bookingId] of Object.entries(old.idempotency || {})) this.put("idempotency", key, { booking_id: bookingId });
      for (const event of [...(old.events || [])].reverse()) this.put("event", event.id, event);
      if (old.nextBooking) this.put("counter", "booking", { next: old.nextBooking });
    });
    fs.renameSync(file, `${file}.imported`);
    return true;
  }
}

module.exports = { Store };
