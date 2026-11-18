# Daryeel Stays: PHP server

The PHP version of the Daryeel Stays server. It answers the same routes with the same JSON as `servers/node` and uses the same SQLite table, so you can switch servers without changing the page or the data. See [docs/server-contract.md](../../docs/server-contract.md).

Needs PHP 8.1+ with `pdo_sqlite` and `curl`. No Composer install. It uses `sdk/php` directly.

## Configure

Copy `.env.example` to `.env` at the repo root and fill it in. `BITI_CLIENT_ID`, `BITI_CLIENT_SECRET` and `SESSION_SECRET` are required. A real environment variable wins over `.env`.

## Run (development)

From the repo root:

```bash
PHP_CLI_SERVER_WORKERS=4 php -S 0.0.0.0:8090 servers/php/router.php
```

The built-in server answers one request at a time by default. `PHP_CLI_SERVER_WORKERS` lets Biti call your webhook while a page request is open. Check it: `BASE=http://localhost:8090 node scripts/smoke.mjs`.

`DB_PATH=data/other.sqlite` uses another database file.

## Deploy on Apache

1. Install PHP 8.1+ with `pdo_sqlite`, `curl` and Apache `mod_rewrite`.
2. Put the repo on the server. Make `data/` writable by the web user (`chown -R www-data data`).
3. Create `.env` with production values: `COOKIE_SECURE=1`, `APP_ORIGINS=https://stays.example.com`, no `DEV_TOOLS`.
4. Copy `apache-vhost.conf.example` into `sites-available`, fix the paths and host, then `a2enmod rewrite alias`, `a2ensite`, reload Apache.
5. Add HTTPS (certbot). Biti calls `https://stays.example.com/webhooks/biti` and `https://stays.example.com/biller/lookup`. Both must be reachable from the internet.

Simpler layout: set `DocumentRoot` to `servers/php/public`. Its `.htaccess` sends every request to `index.php`, which also serves the files from the shared `public/` folder. It is a little slower for static files.

## Production notes

- `.env` and `data/` stay outside the web root. Do not point `DocumentRoot` at the repo root.
- The Biti token stays in the `session` row. The browser only gets `daryeel_sid`, a signed id (HttpOnly, SameSite=Lax, 30 days, `Secure` with `COOKIE_SECURE=1`).
- SQLite runs in WAL mode with `BEGIN IMMEDIATE` for read-modify-write, so several PHP workers share it safely. Back up `data/daryeel.sqlite` with `sqlite3 .backup`.
- Turn `DEV_TOOLS` off. With it on, `/api/dev/log` and the playground are open to everyone.
- Dates for cancellation deadlines use the PHP default time zone (set `date.timezone` in `php.ini`).

## Layout

| Path | What |
|---|---|
| `public/index.php` | Front controller |
| `router.php` | Router script for `php -S` |
| `src/App.php`, `src/Router.php` | Route table, session start, error mapping, static files |
| `src/Store.php`, `src/Session.php`, `src/Catalog.php`, `src/Config.php` | Storage, signed cookie session, hotels, `.env` |
| `src/Routes/*.php` | Account, Bookings, Plan, Bills, Dev, Webhooks |
