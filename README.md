# Daryeel Stays: Biti SDK sample

Daryeel Stays is a sample partner mini app. It books hotels in Mogadishu and Hargeisa and uses every part of the Biti SDK and the Biti partner API. It runs inside the Biti app (mini browser) and in a normal web browser.

The stack is Node and Express with plain HTML, CSS and JavaScript. There is no build step.

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
| Developer panel | Tap **Dev**. **Page** lists each SDK and `/api` call. **Server** lists each call to Biti and each webhook. | `GET /api/dev/log` |

Report is not an SDK method. Inside Biti, the customer taps **···** in the Biti bar, then **Report**.

## Rules this sample follows

* The client secret and the customer token stay on the server. The browser gets only a signed, httpOnly session cookie.
* The server sets every amount. The page sends a hotel, dates and guests, never a price.
* A booking is confirmed only when `get-order-status` (or a signed `payment.paid` webhook) says `paid`. The SDK answer and the `?status=paid` return query are not trusted.
* Each payment attempt has one reference (`BK-2041-P1`, `BK-2041-P2`). The browser sends an `Idempotency-Key` per attempt, so a double tap makes one booking.
* Refunds, holds and plan charges have fixed references, so a repeat changes nothing.

## Set up

1. Install Node 18 or newer.
2. Install the packages:

   ```bash
   npm install
   ```

3. Copy the settings file and fill it in:

   ```bash
   cp .env.example .env
   ```

   | Key | Value |
   |---|---|
   | `BITI_BASE_URL` | The Biti backend, for example `http://192.168.100.200:8004`. The server calls `/partner/v1/*` here. Pages load `/assets/biti_wallet/js/biti-sdk.js` from here. |
   | `BITI_WALLET_URL` | The Biti wallet web app, for example `http://192.168.100.200:8052`. The SDK sends web browser users here to pay or approve. |
   | `BITI_CLIENT_ID`, `BITI_CLIENT_SECRET` | From the Mini App record. Never put them in a page or in git. |
   | `APP_ORIGINS` | The origins of this app, separated by commas. They must also be in the Mini App's **Allowed Origins**. Biti sends the customer back only to these. |
   | `PORT` | `8090` |
   | `SESSION_SECRET` | A long random string, for example from `openssl rand -hex 32`. |

4. Start the server:

   ```bash
   npm run dev
   ```

5. Open http://localhost:8090.

Bookings, plans and webhook events are kept in `data/store.json`. Sessions are kept in memory, so a server restart signs everyone out.

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
| `server/index.js` | Express app, settings, `/config.js`, health check, error answers |
| `server/biti.js` | Biti API client (credential headers, envelope, call log) and the webhook signature check |
| `server/routes/account.js` | Sign-in, Connect, wallet and top-up routes |
| `server/routes/bookings.js` | Bookings, payment checks, refunds and deposit holds |
| `server/routes/plan.js` | Monthly stay plan (mandate) |
| `server/routes/webhooks.js` | Webhook endpoint |
| `server/catalog.js` | Hotels and prices |
| `server/session.js`, `server/store.js` | Session cookie and the JSON store |
| `public/index.html`, `public/styles.css` | Page shell and styles |
| `public/js/client.js` | Calls to this server, SDK loader and wrapper, call log |
| `public/js/views.js`, `public/js/main.js`, `public/js/ui.js` | Screens, router, developer panel and helpers |
