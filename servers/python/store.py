import json
import os
import sqlite3
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  owner TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS records_owner ON records (kind, owner);
"""


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Store:
    """Every record lives in one SQLite table: kind + id + JSON data. One instance per request."""

    def __init__(self, file):
        os.makedirs(os.path.dirname(file), exist_ok=True)
        self.db = sqlite3.connect(file, timeout=5, isolation_level=None)
        self.db.execute("PRAGMA busy_timeout = 5000")
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.executescript(SCHEMA)
        self.depth = 0

    def close(self):
        self.db.close()

    def get(self, kind, record_id):
        row = self.db.execute("SELECT data FROM records WHERE kind = ? AND id = ?", (kind, str(record_id))).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, kind, record_id, data, owner=None):
        self.db.execute(
            """INSERT INTO records (kind, id, owner, data, created_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (kind, id) DO UPDATE SET owner = COALESCE(excluded.owner, owner), data = excluded.data""",
            (kind, str(record_id), owner, json.dumps(data), now_iso()),
        )
        return data

    def delete(self, kind, record_id):
        self.db.execute("DELETE FROM records WHERE kind = ? AND id = ?", (kind, str(record_id)))

    def list(self, kind, owner=None):
        """Newest first. Pass an owner to filter."""
        if owner is None:
            rows = self.db.execute("SELECT data FROM records WHERE kind = ? ORDER BY created_at DESC, rowid DESC", (kind,))
        else:
            rows = self.db.execute("SELECT data FROM records WHERE kind = ? AND owner = ? ORDER BY created_at DESC, rowid DESC", (kind, owner))
        return [json.loads(row[0]) for row in rows.fetchall()]

    def transaction(self, fn):
        """Runs fn inside BEGIN IMMEDIATE. Nested calls join the open transaction."""
        if self.depth > 0:
            return fn()
        self.db.execute("BEGIN IMMEDIATE")
        self.depth = 1
        try:
            result = fn()
            self.db.execute("COMMIT")
            return result
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        finally:
            self.depth = 0

    def update(self, kind, record_id, mutate):
        """Read-modify-write one record. mutate edits the dict in place."""
        def run():
            data = self.get(kind, record_id)
            if data is None:
                raise LookupError(f"{kind} {record_id} not found")
            mutate(data)
            return self.put(kind, record_id, data, data.get("owner"))
        return self.transaction(run)

    def next_number(self, counter, start):
        def run():
            current = (self.get("counter", counter) or {"next": start})["next"]
            self.put("counter", counter, {"next": current + 1})
            return current
        return self.transaction(run)

    def keep_newest(self, kind, limit):
        self.db.execute(
            """DELETE FROM records WHERE kind = ? AND rowid NOT IN
               (SELECT rowid FROM records WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)""",
            (kind, kind, limit),
        )
