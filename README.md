# Daryeel Stays: Biti SDK sample

Daryeel Stays is a sample partner mini app. It books hotels in Mogadishu and Hargeisa and uses every part of the Biti SDK and the Biti partner API. It runs inside the Biti app (mini browser) and in a normal web browser.

The web app is plain HTML, CSS and JavaScript with no build step. The server comes in three versions with the same routes, JSON and SQLite data: **Node** (Express), **PHP** (Apache) and **Python** (Flask). Each one uses the partner SDK for its language in [`sdk/`](sdk/README.md). The shared rules are in [docs/server-contract.md](docs/server-contract.md).

## What it shows

| Feature | Page (SDK) | Server (Biti partner API) |
|---|---|---|
| Find out where the page runs | `biti.isInBitiApp()`, `biti.getContext()` | none |
| Sign in inside Biti | `biti.login({ scopes })` gives a one-time code | `POST /api/login` calls `exchange-login-code` and keeps the token in the server session |
| Connect a wallet outside Biti | none | `POST /api/connect` calls `connect-request`, `GET /api/connect/:token` polls `connect-status` |
| Guest details filled from Biti | none | Name and phone from the sign-in answer (`profile.read`) |
| Book and pay | `biti.requestPayment({ order_id, return_url })` | `POST /api/bookings` prices the stay and calls `create-order` |
| Confirm only after Biti says paid | none | `GET /api/bookings/:id` calls `get-order-status` |
| Pay again after an order expires | `biti.requestPayment` | `POST /api/bookings/:id/pay` calls `create-order` with a new reference |
| Cancel and refund | none | `POST /api/bookings/:id/cancel` calls `refund-order` with a reference, and `release-hold` if a deposit is held |
| Monthly stay plan (auto-pay) | `biti.requestApproval({ mandate_id, return_url })` | `POST /api/plan` calls `create-mandate`, `GET /api/plan` calls `get-mandate-status`, `POST /api/plan/charge` calls `charge-mandate` |
| Room deposit hold | `biti.requestHold({ hold_id, return_url })` | `POST /api/deposit` calls `create-hold`, `GET /api/deposit/:id` calls `get-hold-status`, `POST /api/deposit/:id/release` and `/capture` |
| Share a booking | `biti.share({ title, path })` (system share or copy link on the web) | none |
| Connected wallet and top-up | none | `GET /api/wallet` calls `connected-wallet` and `get-topup-methods`, `POST /api/topup` calls `create-topup` (handles `needs_linking`), `GET /api/topup/:id` calls `get-topup-status` |
| Back to Biti | `biti.close()` | none |
| Webhooks | none | `POST /webhooks/biti` checks `X-Biti-Signature` on the raw body, skips repeated event ids, and updates bookings, deposits, plans and top-ups |
| Developer pages (`DEV_TOOLS=1`) | Tap **Dev**: **SDK playground** (`/dev`) runs every SDK method and every partner endpoint; **Bills** (`/dev/bills`) is the biller side; **Webhooks** (`/dev/webhooks`); **Live log** | `GET /api/playground`, `POST /api/playground/:endpoint`, `GET /api/dev/log` |
| Biller (Bill Provider) | Customers pay Daryeel Stays invoices from Biti's Bills page | `POST /biller/lookup` (signed) answers open bills for `DS-1001`…`DS-1003`; `/api/bills` pushes, checks and cancels bills (`billpay-*`) and approves account connects |

Report is not an SDK method. Inside Biti, the customer taps **···** in the Biti bar, then **Report**.

## Rules this sample follows

* The client secret and the customer token stay on the server. The browser gets only a signed, httpOnly session cookie.
* The server sets every amount. The page sends a hotel, dates and guests, never a price.
* A booking is confirmed only when `get-order-status` (or a signed `payment.paid` webhook) says `paid`. The SDK answer and the `?status=paid` return query are not trusted.
* Each payment attempt has one reference (`BK-2041-P1`, `BK-2041-P2`). The browser sends an `Idempotency-Key` per attempt, so a double tap makes one booking.
* Refunds, holds and plan charges have fixed references, so a repeat changes nothing.

## Set up

1. Copy the settings file and fill it in. All three servers read the same `.env` at the repo root; `.env.example` explains every key.

   ```bash
   cp .env.example .env
   ```

   | Key | Value |
   |---|---|
   | `BITI_BASE_URL` | The Biti API. Production: `https://bitiwallet.easytouch.cloud`. Dev: `http://192.168.100.119:8004`. |
   | `BITI_WALLET_URL` | The Biti wallet web app. The SDK sends web browser users here to pay or approve. |
   | `BITI_CLIENT_ID`, `BITI_CLIENT_SECRET` | From the Mini App record. Never put them in a page or in git. |
   | `APP_ORIGINS` | The origins of this app, separated by commas. They must also be in the Mini App's **Allowed Origins**. |
   | `SESSION_SECRET` | A long random string, for example from `openssl rand -hex 32`. |
   | `DEV_TOOLS` | `1` turns on the SDK playground and the server log. Leave it off in production. |

2. Choose a server.

   | Server | Needs | Dev | Production |
   |---|---|---|---|
   | Node | Node 24+ | `npm install && npm run dev` | `npm run production` behind a reverse proxy with HTTPS (see below) |
   | PHP | PHP 8.1+ with `pdo_sqlite` and `curl` | `PHP_CLI_SERVER_WORKERS=4 php -S 0.0.0.0:8090 servers/php/router.php` | Apache: see [servers/php/README.md](servers/php/README.md) and `servers/php/apache-vhost.conf.example` |
   | Python | Python 3.10+ | `cd servers/python && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python app.py` | `.venv/bin/gunicorn -w 3 -b 127.0.0.1:8090 wsgi:app` behind nginx or Apache, see [servers/python/README.md](servers/python/README.md) |

3. Open http://localhost:8090 and check `/api/health`: it names the server that answered.

4. Check a server with the smoke script (Node 18+ needed only to run it): `BASE=http://localhost:8090 npm run smoke`.

Bookings, plans, top-ups, bills, webhook events and sessions are kept in SQLite (`data/daryeel.sqlite`), so a restart keeps everyone signed in. The servers share the table layout, but each signs its session cookie in its own way: after switching servers, customers sign in again.

## Production checklist

`npm run production` starts the Node server with `NODE_ENV=production`. It refuses to start, and lists what to fix, when `DEV_TOOLS` is on, `COOKIE_SECURE` is not `1`, `BITI_BASE_URL`, `BITI_WALLET_URL` or `APP_ORIGINS` is not https, or `SESSION_SECRET` is shorter than 32 characters. Set `TRUST_PROXY=1` behind Apache or nginx. Keep it running with a process manager, for example `pm2 start npm --name daryeel-stays -- run production` or a systemd unit.


- [ ] `BITI_BASE_URL` and `BITI_WALLET_URL` point to production Biti, and the Mini App is **Published** there.
- [ ] HTTPS only. `COOKIE_SECURE=1`. `APP_ORIGINS` lists only the https origin, and the Mini App's **Allowed Origins** match it.
- [ ] `DEV_TOOLS` is off.
- [ ] `.env` and `data/` are outside the web root (Apache) and not in git.
- [ ] The Mini App's **Webhook URL** is `https://<your host>/webhooks/biti`; the server answers 2xx within 10 seconds.
- [ ] As a biller, the Bill Provider's lookup URL is `https://<your host>/biller/lookup`.
- [ ] Behind a reverse proxy: forward the host and scheme (`TRUST_PROXY=1` for Python) so return URLs match `APP_ORIGINS`.
- [ ] Back up `data/daryeel.sqlite`.

## Run mode

Set `RUN_MODE` in `.env`:

| Value | What happens |
|---|---|
| `anywhere` (default) | The app works inside the Biti mini browser and in a normal browser. In a normal browser, payments open the Biti web pages and come back. |
| `biti_only` | The app works only inside the Biti mini browser. A normal browser shows "Open Daryeel Stays in Biti" with an **Open in Biti** link (`biti://miniapp/<BITI_APP_ID>`). |

`BITI_APP_ID` is the Mini App id in Biti Desk (default `daryeel-stays`). The gate is in the page only. The server still checks every call, so `biti_only` is a product choice, not a security control.

## Register the app in Biti Desk

Open `/desk/biti-apps/mini-app` and create a Mini App:

| Field | Value |
|---|---|
| App ID | `daryeel-stays` |
| Kind | `external` |
| Status | `Published` (payments need it) |
| Launch URL | `http://<LAN-IP>:8090` |
| Allowed Origins | `http://<LAN-IP>:8090` and `http://localhost:8090`, one per line |
| Connect Enabled | on (sign-in needs it) |
| Scopes | `profile.read`, `wallet.read`, `wallet.topup` |
| Payout Wallet | An Active wallet that receives the payments. It must not be the wallet you pay from. |
| Webhook URL | `http://<LAN-IP>:8090/webhooks/biti` |

Then use **Credentials** on the form to make the client ID and client secret. Put them in `.env`. A new secret stops the old one at once.

`wallet.pay` is not needed. Payments always go through the Biti confirm sheet and PIN.

## Test on a phone in the Biti app

1. Put the computer and the phone on the same Wi-Fi.
2. Find the computer's LAN IP (`ipconfig getifaddr en0` on macOS). Use it in the Launch URL, Allowed Origins, Webhook URL and `APP_ORIGINS`.
3. Open Biti, go to **Services** and open **Daryeel Stays**. The page shows **In Biti** at the top.
4. Tap **Sign in with Biti**, then book a hotel and pay.

Android blocks plain `http` pages unless the Biti build allows cleartext traffic. If the page does not load, use HTTPS with a tunnel, for example `ngrok http 8090`. Then put the `https://...ngrok...` URL in the Launch URL, Allowed Origins, Webhook URL and `APP_ORIGINS`, and restart the server.

## Test in a normal browser

1. Open http://localhost:8090. The page shows **Web**.
2. Tap **Connect your Biti wallet** and type your Biti phone number. Approve the request in the Biti app.
3. Book a hotel and tap **Pay with Biti**. The SDK opens `BITI_WALLET_URL/pay/<order_id>`. Sign in, pay, and Biti sends you back to `/booking/<id>`. The page then asks the server to check the order.

The plan and the deposit use the same flow with `/pay/mandate/<id>` and `/pay/hold/<id>`.

## Files

| Path | What it holds |
|---|---|
| `sdk/node`, `sdk/php`, `sdk/python` | Partner API client for each language: every endpoint, credential headers, errors, webhook and lookup signature checks |
| `sdk/js/biti-browser.js` | Browser helper around the Biti mini browser SDK |
| `servers/node` | Express server: `index.js`, `store.js` (SQLite), `session.js`, `catalog.js`, `routes/` |
| `servers/php` | PHP server: `public/index.php` + `.htaccess` (Apache), `router.php` (built-in server), `src/` |
| `servers/python` | Flask server: `app.py`, `wsgi.py`, `store.py`, `session.py`, `routes/` |
| `public/` | The web app shared by all servers: `index.html`, `styles.css`, `js/` (screens, router, SDK wrapper, developer pages in `devViews.js`) |
| `scripts/smoke.mjs` | Smoke test for any running server |
| `docs/server-contract.md` | Routes, storage and SDK interface every server follows |

---

<p align="center">Powered by <a href="https://yool.tech">Yooltech</a></p>
