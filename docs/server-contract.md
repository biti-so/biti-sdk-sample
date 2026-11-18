# Server contract

The Node, PHP and Python servers are three versions of one app. They serve the same `public/` web app, answer the same routes with the same JSON, and use the same SQLite schema, so you can switch servers without changing the page or the data. `servers/node` is the reference: when this file and the Node server disagree, fix this file.

## Folders

| Folder | What |
|---|---|
| `sdk/node`, `sdk/php`, `sdk/python` | Partner API clients. One class `BitiClient` each, same method names (camelCase in Node and PHP, snake_case in Python). |
| `sdk/js` | Browser helper around `window.biti` (the Biti mini browser SDK). |
| `servers/node`, `servers/php`, `servers/python` | The Daryeel Stays server in each language. Each one uses its own language's SDK folder. |
| `public/` | The web app. Shared by all servers. |
| `data/` | SQLite file `daryeel.sqlite` (gitignored). |
| `scripts/smoke.mjs` | Runs every route against a running server. |

## Configuration (`.env` at the repo root, read by every server)

| Key | Required | Meaning |
|---|---|---|
| `BITI_BASE_URL` | yes | Biti API, e.g. `https://bitiwallet.easytouch.cloud` (production) or `http://192.168.100.119:8004` (dev). |
| `BITI_WALLET_URL` | yes | Biti web app origin, for the SDK `data-biti-origin`. |
| `BITI_CLIENT_ID`, `BITI_CLIENT_SECRET` | yes | From the Mini App in Biti Desk. Server only. |
| `BITI_APP_ID` | no | Mini App id, default `daryeel-stays`. |
| `SESSION_SECRET` | yes | Signs the session cookie. |
| `APP_ORIGINS` | yes | Comma list of this app's origins; return URLs are only built for these. |
| `RUN_MODE` | no | `anywhere` (default) or `biti_only`. |
| `DEV_TOOLS` | no | `1` turns on the playground and `/api/dev/log`. Leave it off in production. |
| `PORT` | no | Default 8090 (Node, Python dev server, PHP built-in server). |
| `DB_PATH` | no | Default `data/daryeel.sqlite`. |
| `COOKIE_SECURE` | no | `1` in production (HTTPS): adds `Secure` to the cookie. |

## SDK client interface

```
client = BitiClient(base_url, client_id, client_secret, timeout_seconds=20, on_trace=None)
client.call(endpoint, body={}, token=None) -> data          # POST {base}/partner/v1/{endpoint}
client.<method>(body={}, token=None) -> data                 # one per endpoint, list below
BitiClient.verify_webhook(raw_body, headers, client_secret, now=None, tolerance=300) -> bool
BitiClient.verify_lookup(raw_body, headers, client_secret, now=None, tolerance=300) -> bool
```

- Headers on every call: `X-Biti-Client-Id`, `X-Biti-Client-Secret`, `Content-Type: application/json`; plus `X-Biti-Token` when `token` is given.
- Answer envelope `{success, message, data}`; when `success` is missing and `message` is an object, use `message` as the envelope.
- Failure raises `BitiError(message, status, code, data)`: HTTP status (502 for network errors), `code` from `body.code` or `body.data.code`.
- `on_trace({name, status, ms, with_token, request, response, error})` after each call, with `access_token`, `client_secret` and `code` replaced by `•••`.
- Signatures: hex HMAC-SHA256 of the raw body, key = client secret, header `X-Biti-Signature`, compared in constant time. `X-Biti-Timestamp` (unix seconds) must be within `tolerance` of now. Header lookup is case-insensitive.

| Method (Node/PHP) | Endpoint | Token |
|---|---|---|
| connectRequest | connect-request | no |
| connectStatus | connect-status | no |
| exchangeLoginCode | exchange-login-code | no |
| connectedWallet | connected-wallet | yes |
| getTopupMethods | get-topup-methods | yes |
| createTopup | create-topup | yes |
| getTopupStatus | get-topup-status | yes |
| createPaymentRequest | create-payment-request | yes |
| getOrderStatus | get-order-status | no |
| createOrder | create-order | no |
| releaseSplits | release-splits | no |
| getPayoutMethods | get-payout-methods | no |
| quoteBulkSend | quote-bulk-send | no |
| createBulkSend | create-bulk-send | no |
| getBulkSendStatus | get-bulk-send-status | no |
| createMandate | create-mandate | no |
| chargeMandate | charge-mandate | no |
| getMandateStatus | get-mandate-status | no |
| createHold | create-hold | no |
| captureHold | capture-hold | no |
| releaseHold | release-hold | no |
| getHoldStatus | get-hold-status | no |
| refundOrder | refund-order | no |
| createPayout | create-payout | no |
| getPayoutStatus | get-payout-status | no |
| getStatement | get-statement | no |
| onboardCustomer | onboard-customer | no |
| onboardVerify | onboard-verify | no |
| onboardStatus | onboard-status | no |
| billpayPushBill | billpay-push-bill | no |
| billpayCancelBill | billpay-cancel-bill | no |
| billpayBillStatus | billpay-bill-status | no |
| billpayConfirmAccount | billpay-confirm-account | no |

The table is the single source: each SDK keeps it as one data list (`ENDPOINTS`) and also exports it, so the playground can list every endpoint.

## Storage

One SQLite table, the same in every server:

```sql
CREATE TABLE IF NOT EXISTS records (
  kind TEXT NOT NULL,          -- session | booking | plan | topup | event | idempotency | bill | bill_account | counter
  id TEXT NOT NULL,
  owner TEXT,                  -- customer key (phone) where it applies
  data TEXT NOT NULL,          -- JSON
  created_at TEXT NOT NULL,    -- ISO 8601 UTC
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS records_owner ON records (kind, owner);
```

- Booking ids come from `counter/booking` (`{"next": 2041}`), giving `BK-2041`, `BK-2042`, …
- `session` rows hold `{token, expires_at, scopes, user, via}`; the cookie `daryeel_sid` holds only a signed session id (HttpOnly, SameSite=Lax, 30 days, `Secure` when `COOKIE_SECURE=1`). The Biti token never reaches the browser.
- Writes that read then change a row run in one transaction (`BEGIN IMMEDIATE`).
- Keep the last 100 `event` rows.

## Routes

All `/api/*` answers are JSON. Errors: `{error, code?, data?, source?}` with HTTP 400 (bad input), 401 (`sign_in_required`), 404, 409 (state conflict), or the Biti status (`source: "biti"`, 502 for Biti 5xx/network). Routes marked *user* answer 401 `{error: "Sign in with Biti first", code: "sign_in_required"}` without a signed-in session.

| Method | Path | Notes |
|---|---|---|
| GET | `/config.js` | `window.APP_CONFIG = {sdkUrl, bitiOrigin, runMode, appId, loginScopes, currency, cityTaxPerNight, depositAmount, planLimit, devTools}`; `Cache-Control: no-store`. |
| GET | `/api/health` | `{ok, biti_reachable, biti_base_url, ms, server: "node"|"php"|"python"}` |
| GET | `/api/hotels` | Catalog |
| GET | `/api/me` | `{signed_in, via?, user?, scopes?, expires_at?}` |
| POST | `/api/login` | `{code}` → exchange-login-code |
| POST | `/api/logout` | |
| POST | `/api/connect` | `{phone}` → connect-request |
| GET | `/api/connect/:token` | connect-status |
| GET | `/api/wallet` | *user* `{wallet, topup}` |
| POST | `/api/topup` | *user* `{method_id, amount, currency?}`, `Idempotency-Key` header; 409 `needs_linking` with `link_url` |
| GET | `/api/topup/:id` | *user* |
| GET/POST | `/api/bookings` | *user*; POST `{hotel_id, nights, guests, check_in}` + `Idempotency-Key` |
| GET | `/api/bookings/:id` | *user*, synced with get-order-status, adds `cancel_until` |
| POST | `/api/bookings/:id/pay`, `/api/bookings/:id/cancel` | *user* |
| POST | `/api/deposit` | *user* `{booking_id}` |
| GET | `/api/deposit/:holdId` | *user* |
| POST | `/api/deposit/:holdId/release`, `/api/deposit/:holdId/capture` | *user*; capture `{amount?}` |
| GET/POST | `/api/plan`, POST `/api/plan/charge` | *user* |
| GET | `/api/bills` | Biller side: `{accounts, bills, connect_requests}` |
| POST | `/api/bills` | `{account_number, title, amount, min_amount?, due_date?}` → billpay-push-bill, `external_id` = `INV-<n>` |
| GET | `/api/bills/:id` | billpay-bill-status, saved |
| POST | `/api/bills/:id/cancel` | billpay-cancel-bill |
| POST | `/api/bills/connect/:account` | `{approved}` → billpay-confirm-account |
| POST | `/biller/lookup` | Called by Biti, signed like webhooks (401 if bad). `{account_number}` → `{customer_name, area, invoices: [{id, title, amount, min_amount, due}]}`; unknown account → 404 `{error: "unknown_account"}` |
| POST | `/webhooks/biti` | Signed; duplicates answer `{ok, duplicate: true}` |
| GET | `/api/dev/log` | `DEV_TOOLS` only: `{server_calls, webhooks}` (last 50 calls, 20 events) |
| GET | `/api/playground` | `DEV_TOOLS` only: the endpoint table |
| POST | `/api/playground/:endpoint` | `DEV_TOOLS` only: `{body}` → any endpoint in the table, with the session token when the endpoint needs one; answers `{ok, status, data?, error?, code?}` and never throws |

Page routes that return `public/index.html`: `/`, `/hotel/:id`, `/checkout/:id`, `/booking/:id`, `/bookings`, `/plan`, `/deposit/:id`, `/wallet`, `/connect`, `/dev`, `/dev/bills`, `/dev/webhooks`.

## Biller demo

Daryeel Stays also acts as a Biti Bill Provider ("Daryeel Stays invoices"). Seed three demo accounts on first start (`bill_account` rows): `DS-1001` Ahmed Ali (Mogadishu), `DS-1002` Hodan Warsame (Hargeisa), `DS-1003` Abdi Salam (Mogadishu). Lookup answers each account's open bills (`bill` rows with status `Open` or `Part paid`).

## Webhook events

Apply and record every event. Besides the booking, deposit, plan and top-up events, handle:

- `bill.paid` → bill status `Paid` or `Part paid` with `paid_amount`
- `bill.disputed` → bill status `Disputed`
- `bill.account_connect_requested` → save a pending connect request (`account_number`, customer)
- every other event → recorded as `ignored`

## Details fixed by the Node server

| Topic | Rule |
|---|---|
| Dev tools off | `/api/dev/*` and `/api/playground*` answer 404 `{error, code: "dev_tools_off"}`. |
| Playground | Always HTTP 200 `{ok, status, data\|error, code}`. Unknown endpoint: `ok:false, status:404`. Token endpoint without a session: `ok:false, status:401, code:"sign_in_required"`. `GET /api/playground` answers `{endpoints: [{method, endpoint, token}]}`. |
| Connect requests | `bill_account` rows with id `request:<account_number>` holding `{account_number, customer_name, requested_at}`, deleted once confirmed. `GET /api/bills` returns those as `connect_requests` and the other rows as `accounts`. |
| Bills | Ids from `counter/invoice` (`INV-1001` on). Row id = `external_id`, `owner` = account number, status `Open`. `POST /api/bills` → 201 bill, 404 `unknown_account`, 400 bad input. Status strings normalised to Biti's (`part_paid` → `Part paid`). |
| Bill events | Use `data.external_id \|\| data.id` and `data.paid_amount`; `bill.paid` sets `Part paid` when paid < amount, else `Paid`. |
| Lookup | Open bills with full `amount`; missing `min_amount`/`due` sent as `null`. |
| Webhook body | Not JSON, or no `id`/`event`, answers 400 after the signature check. |
| Plans | Plan rows use the owner as id and keep `owner` inside `data`. |
| Events | Dedupe uses the kept event rows (last 100). |
| Node | `engines.node >= 24` (node:sqlite). |
