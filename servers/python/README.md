# Daryeel Stays: Python (Flask) server

Same app, routes, JSON and SQLite schema as `servers/node` (see `docs/server-contract.md`). Uses `sdk/python/biti_partner` and the shared `public/` web app and root `.env`.

## Setup

```bash
cd servers/python
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Needs Python 3.10+. Flask, requests and python-dotenv are the only app dependencies (gunicorn is for production). The SDK is loaded from `../../sdk/python`, so nothing else to install.

## Development

```bash
.venv/bin/python app.py                       # PORT from .env, default 8090
.venv/bin/flask --app app run -p 8092         # alternative
PORT=8092 DB_PATH=data/py-test.sqlite .venv/bin/python app.py
BASE=http://localhost:8092 node ../../scripts/smoke.mjs   # run from repo root: node scripts/smoke.mjs
```

## Production

```bash
.venv/bin/gunicorn -w 3 -b 0.0.0.0:8090 wsgi:app
```

Run it behind nginx or Apache with HTTPS.

- Set `COOKIE_SECURE=1`, `DEV_TOOLS` off, a long random `SESSION_SECRET`, and `APP_ORIGINS` to the public https origin.
- Behind a proxy, send `X-Forwarded-Proto` and `X-Forwarded-Host` and set `TRUST_PROXY=1`, so return URLs match `APP_ORIGINS`.
- Several workers are safe: SQLite runs in WAL mode, every request has its own connection, and read-modify-write uses `BEGIN IMMEDIATE`.
- Keep `data/` writable by the service user. Back up `daryeel.sqlite` (with its `-wal` file) or use `sqlite3 .backup`.
- The `/api/dev/log` call log is kept in memory per worker. It is for development only.
- Biti must reach `/webhooks/biti` and `/biller/lookup` over the public URL. Set the Mini App webhook and lookup URLs there.
