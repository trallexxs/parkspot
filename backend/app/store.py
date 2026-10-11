"""SQLite persistence: bookings, walk-in sessions, sandbox payments, event log."""
import json
import secrets
import sqlite3
import threading
from datetime import datetime, timezone

from . import config

_lock = threading.RLock()
_conn = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, lot_id TEXT, spot_id TEXT, original_spot_id TEXT, name TEXT,
  arrive_at TEXT, duration_min INTEGER, amount INTEGER, currency TEXT,
  status TEXT, paid INTEGER DEFAULT 0, payment_ref TEXT, created_at TEXT, checked_in_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, lot_id TEXT, spot_id TEXT, started_at TEXT, ended_at TEXT,
  card_last4 TEXT, paid_amount INTEGER DEFAULT 0, payment_ref TEXT, status TEXT,
  spot_at TEXT, parked_spot TEXT, parked_at TEXT, parked_by TEXT, free_at_start TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lot_id TEXT, at TEXT, kind TEXT, spot_id TEXT, detail TEXT
);
"""


def now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse(s):
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def conn():
    global _conn
    with _lock:
        if _conn is None:
            _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.executescript(SCHEMA)
            # a database file from an older version: add the walk-in columns it lacks
            have = {r[1] for r in _conn.execute("PRAGMA table_info(sessions)")}
            for col in ("spot_at", "parked_spot", "parked_at", "parked_by", "free_at_start"):
                if col not in have:
                    _conn.execute(f"ALTER TABLE sessions ADD COLUMN {col} TEXT")
            _conn.commit()
        return _conn


def new_id(prefix):
    return f"{prefix}_{secrets.token_hex(4)}"


def q(sql, args=(), one=False):
    with _lock:
        cur = conn().execute(sql, args)
        rows = [dict(r) for r in cur.fetchall()]
        conn().commit()
    return (rows[0] if rows else None) if one else rows


def log(lot_id, kind, spot_id=None, **detail):
    q("INSERT INTO events (lot_id, at, kind, spot_id, detail) VALUES (?,?,?,?,?)",
      (lot_id, iso(now()), kind, spot_id, json.dumps(detail)))


def events(lot_id, limit=30):
    rows = q("SELECT * FROM events WHERE lot_id=? ORDER BY id DESC LIMIT ?", (lot_id, limit))
    for r in rows:
        r["detail"] = json.loads(r["detail"] or "{}")
    return rows
