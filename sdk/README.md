# Biti partner SDKs

Four small folders. The server SDKs call the Biti partner API (`POST {base}/partner/v1/{endpoint}`) with your client id and secret. `sdk/js` wraps the browser SDK `window.biti`. The contract is in [../docs/server-contract.md](../docs/server-contract.md).

## Install

| Language | Install | Import |
|---|---|---|
| Node 18+ | `npm install ./sdk/node` (package `@biti/partner-sdk`) | `const { BitiClient, BitiError } = require("@biti/partner-sdk")` |
| PHP 8.1+ (ext-curl) | `composer require biti/partner-sdk` (path repository `sdk/php`) | `use Biti\Sdk\{BitiClient, BitiError};` |
| Python 3.9+ | `pip install ./sdk/python` (needs `requests`) | `from biti_partner import BitiClient, BitiError` |
| Browser | copy `sdk/js/biti-browser.js` | `import { bitiCall, loadBitiSdk } from "./biti-browser.js"` |

## Methods

Every server method takes `(body, token)` and returns the `data` of the answer. Methods marked "token" need the customer token (Node: `{token}` option). Failure throws `BitiError` with `message`, `status` (502 for network errors), `code` and `data`. PHP names `code` as `errorCode`, because `Exception::$code` is taken.

| Node / PHP | Python | Endpoint | Token |
|---|---|---|---|
| connectRequest | connect_request | connect-request | no |
| connectStatus | connect_status | connect-status | no |
| exchangeLoginCode | exchange_login_code | exchange-login-code | no |
| connectedWallet | connected_wallet | connected-wallet | token |
| getTopupMethods | get_topup_methods | get-topup-methods | token |
| createTopup | create_topup | create-topup | token |
| getTopupStatus | get_topup_status | get-topup-status | token |
| createPaymentRequest | create_payment_request | create-payment-request | token |
| getOrderStatus | get_order_status | get-order-status | no |
| createOrder | create_order | create-order | no |
| releaseSplits | release_splits | release-splits | no |
| getPayoutMethods | get_payout_methods | get-payout-methods | no |
| quoteBulkSend | quote_bulk_send | quote-bulk-send | no |
| createBulkSend | create_bulk_send | create-bulk-send | no |
| getBulkSendStatus | get_bulk_send_status | get-bulk-send-status | no |
| createMandate | create_mandate | create-mandate | no |
| chargeMandate | charge_mandate | charge-mandate | no |
| getMandateStatus | get_mandate_status | get-mandate-status | no |
| createHold | create_hold | create-hold | no |
| captureHold | capture_hold | capture-hold | no |
| releaseHold | release_hold | release-hold | no |
| getHoldStatus | get_hold_status | get-hold-status | no |
| refundOrder | refund_order | refund-order | no |
| createPayout | create_payout | create-payout | no |
| getPayoutStatus | get_payout_status | get-payout-status | no |
| getStatement | get_statement | get-statement | no |
| onboardCustomer | onboard_customer | onboard-customer | no |
| onboardVerify | onboard_verify | onboard-verify | no |
| onboardStatus | onboard_status | onboard-status | no |
| billpayPushBill | billpay_push_bill | billpay-push-bill | no |
| billpayCancelBill | billpay_cancel_bill | billpay-cancel-bill | no |
| billpayBillStatus | billpay_bill_status | billpay-bill-status | no |
| billpayConfirmAccount | billpay_confirm_account | billpay-confirm-account | no |

Also on every client: `call(endpoint, body, token)`, `ENDPOINTS` (the table as data), `verifyWebhook` / `verifyLookup` (Python: `verify_webhook` / `verify_lookup`), and the `on_trace` / `onTrace` hook. Secrets in traces show as `•••`.

Browser helpers: `isInBiti()`, `loadBitiSdk({ sdkUrl, bitiOrigin })`, `bitiCall(method, params)` for `getContext`, `login`, `requestPayment`, `requestApproval`, `requestHold`, `share`, `close`, and `explainBitiError(error)`.

## Example

Node:

```js
const biti = new BitiClient({ baseUrl: process.env.BITI_BASE_URL, clientId, clientSecret });
const order = await biti.createOrder({ amount: 25, currency: "USD", external_id: "BK-2041" });
const wallet = await biti.connectedWallet({}, { token });
```

PHP:

```php
$biti = new BitiClient($_ENV['BITI_BASE_URL'], $clientId, $clientSecret);
$order = $biti->createOrder(['amount' => 25, 'currency' => 'USD', 'external_id' => 'BK-2041']);
$wallet = $biti->connectedWallet([], $token);
```

Python:

```python
biti = BitiClient(os.environ["BITI_BASE_URL"], client_id, client_secret)
order = biti.create_order({"amount": 25, "currency": "USD", "external_id": "BK-2041"})
wallet = biti.connected_wallet(token=token)
```

Browser:

```js
await loadBitiSdk({ sdkUrl, bitiOrigin });
try { await bitiCall("requestPayment", { order_id }); } catch (error) { alert(explainBitiError(error)); }
```

## Verify a webhook

Use the raw body bytes, not parsed JSON. `verifyLookup` is the same check for the `/biller/lookup` calls. Answer 401 when it returns false.

Node (Express with `express.raw`):

```js
if (!BitiClient.verifyWebhook(req.body, req.headers, clientSecret)) return res.sendStatus(401);
```

PHP:

```php
$ok = BitiClient::verifyWebhook(file_get_contents('php://input'), getallheaders(), $clientSecret);
if (!$ok) { http_response_code(401); exit; }
```

Python (Flask):

```python
if not BitiClient.verify_webhook(request.get_data(), request.headers, client_secret):
    abort(401)
```
