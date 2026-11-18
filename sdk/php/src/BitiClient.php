<?php

namespace Biti\Sdk;

/**
 * @method mixed connectRequest(array $body = [], ?string $token = null)
 * @method mixed connectStatus(array $body = [], ?string $token = null)
 * @method mixed exchangeLoginCode(array $body = [], ?string $token = null)
 * @method mixed connectedWallet(array $body = [], ?string $token = null)
 * @method mixed getTopupMethods(array $body = [], ?string $token = null)
 * @method mixed createTopup(array $body = [], ?string $token = null)
 * @method mixed getTopupStatus(array $body = [], ?string $token = null)
 * @method mixed createPaymentRequest(array $body = [], ?string $token = null)
 * @method mixed getOrderStatus(array $body = [], ?string $token = null)
 * @method mixed createOrder(array $body = [], ?string $token = null)
 * @method mixed releaseSplits(array $body = [], ?string $token = null)
 * @method mixed getPayoutMethods(array $body = [], ?string $token = null)
 * @method mixed quoteBulkSend(array $body = [], ?string $token = null)
 * @method mixed createBulkSend(array $body = [], ?string $token = null)
 * @method mixed getBulkSendStatus(array $body = [], ?string $token = null)
 * @method mixed createMandate(array $body = [], ?string $token = null)
 * @method mixed chargeMandate(array $body = [], ?string $token = null)
 * @method mixed getMandateStatus(array $body = [], ?string $token = null)
 * @method mixed createHold(array $body = [], ?string $token = null)
 * @method mixed captureHold(array $body = [], ?string $token = null)
 * @method mixed releaseHold(array $body = [], ?string $token = null)
 * @method mixed getHoldStatus(array $body = [], ?string $token = null)
 * @method mixed refundOrder(array $body = [], ?string $token = null)
 * @method mixed createPayout(array $body = [], ?string $token = null)
 * @method mixed getPayoutStatus(array $body = [], ?string $token = null)
 * @method mixed getStatement(array $body = [], ?string $token = null)
 * @method mixed onboardCustomer(array $body = [], ?string $token = null)
 * @method mixed onboardVerify(array $body = [], ?string $token = null)
 * @method mixed onboardStatus(array $body = [], ?string $token = null)
 * @method mixed billpayPushBill(array $body = [], ?string $token = null)
 * @method mixed billpayCancelBill(array $body = [], ?string $token = null)
 * @method mixed billpayBillStatus(array $body = [], ?string $token = null)
 * @method mixed billpayConfirmAccount(array $body = [], ?string $token = null)
 */
class BitiClient
{
    /** [method, endpoint, needs customer token] */
    public const ENDPOINTS = [
        ['connectRequest', 'connect-request', false],
        ['connectStatus', 'connect-status', false],
        ['exchangeLoginCode', 'exchange-login-code', false],
        ['connectedWallet', 'connected-wallet', true],
        ['getTopupMethods', 'get-topup-methods', true],
        ['createTopup', 'create-topup', true],
        ['getTopupStatus', 'get-topup-status', true],
        ['createPaymentRequest', 'create-payment-request', true],
        ['getOrderStatus', 'get-order-status', false],
        ['createOrder', 'create-order', false],
        ['releaseSplits', 'release-splits', false],
        ['getPayoutMethods', 'get-payout-methods', false],
        ['quoteBulkSend', 'quote-bulk-send', false],
        ['createBulkSend', 'create-bulk-send', false],
        ['getBulkSendStatus', 'get-bulk-send-status', false],
        ['createMandate', 'create-mandate', false],
        ['chargeMandate', 'charge-mandate', false],
        ['getMandateStatus', 'get-mandate-status', false],
        ['createHold', 'create-hold', false],
        ['captureHold', 'capture-hold', false],
        ['releaseHold', 'release-hold', false],
        ['getHoldStatus', 'get-hold-status', false],
        ['refundOrder', 'refund-order', false],
        ['createPayout', 'create-payout', false],
        ['getPayoutStatus', 'get-payout-status', false],
        ['getStatement', 'get-statement', false],
        ['onboardCustomer', 'onboard-customer', false],
        ['onboardVerify', 'onboard-verify', false],
        ['onboardStatus', 'onboard-status', false],
        ['billpayPushBill', 'billpay-push-bill', false],
        ['billpayCancelBill', 'billpay-cancel-bill', false],
        ['billpayBillStatus', 'billpay-bill-status', false],
        ['billpayConfirmAccount', 'billpay-confirm-account', false],
    ];

    private const HIDDEN_IN_REQUEST = ['access_token', 'client_secret', 'code'];
    private const HIDDEN_IN_RESPONSE = ['access_token', 'client_secret'];

    private $onTrace;

    public function __construct(
        private string $baseUrl,
        private string $clientId,
        private string $clientSecret,
        private int $timeoutSeconds = 20,
        ?callable $onTrace = null,
    ) {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->onTrace = $onTrace;
    }

    public function __call(string $name, array $arguments): mixed
    {
        foreach (self::ENDPOINTS as [$method, $endpoint]) {
            if ($method === $name) {
                return $this->call($endpoint, $arguments[0] ?? [], $arguments[1] ?? null);
            }
        }
        throw new \BadMethodCallException("Unknown method $name");
    }

    public function call(string $endpoint, array $body = [], ?string $token = null): mixed
    {
        $headers = [
            'Content-Type: application/json',
            'X-Biti-Client-Id: ' . $this->clientId,
            'X-Biti-Client-Secret: ' . $this->clientSecret,
        ];
        if ($token) {
            $headers[] = 'X-Biti-Token: ' . $token;
        }

        $started = microtime(true);
        $handle = curl_init("{$this->baseUrl}/partner/v1/$endpoint");
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode((object) $body),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
        ]);
        $raw = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $failure = $raw === false ? curl_error($handle) : null;
        curl_close($handle);

        $trace = fn (array $entry) => $this->onTrace && ($this->onTrace)([
            'name' => $endpoint,
            'ms' => (int) round((microtime(true) - $started) * 1000),
            'request' => self::redact($body, self::HIDDEN_IN_REQUEST),
        ] + $entry);

        if ($failure !== null) {
            $trace(['error' => $failure]);
            throw new BitiError("Can't reach Biti: $failure", 502);
        }

        try {
            $data = self::parseResponse($status, $raw);
        } catch (BitiError $error) {
            $trace(['status' => $status, 'with_token' => (bool) $token, 'error' => $error->getMessage()]);
            throw $error;
        }
        $trace(['status' => $status, 'with_token' => (bool) $token, 'response' => self::redact(['data' => $data], self::HIDDEN_IN_RESPONSE)]);
        return $data;
    }

    /** Unwraps the envelope and returns data, or throws BitiError. */
    public static function parseResponse(int $status, string $raw): mixed
    {
        $json = json_decode($raw, true);
        if (!is_array($json)) {
            $json = ['success' => false, 'message' => "Biti answered $status without JSON"];
        } elseif (!array_key_exists('success', $json) && is_array($json['message'] ?? null)) {
            $json = $json['message'];
        }

        if ($status < 200 || $status >= 300 || ($json['success'] ?? null) === false) {
            $message = $json['message'] ?? "Biti answered $status";
            $code = $json['code'] ?? ($json['data']['code'] ?? null);
            throw new BitiError(is_string($message) ? $message : json_encode($message), $status, $code, $json['data'] ?? null);
        }
        return $json['data'] ?? null;
    }

    public static function verifyWebhook(string $rawBody, array $headers, string $clientSecret, ?int $now = null, int $tolerance = 300): bool
    {
        $lower = array_change_key_case($headers, CASE_LOWER);
        $signature = (string) ($lower['x-biti-signature'] ?? '');
        $timestamp = $lower['x-biti-timestamp'] ?? null;
        if ($signature === '' || !is_numeric($timestamp) || abs(($now ?? time()) - (float) $timestamp) > $tolerance) {
            return false;
        }
        return hash_equals(hash_hmac('sha256', $rawBody, $clientSecret), $signature);
    }

    public static function verifyLookup(string $rawBody, array $headers, string $clientSecret, ?int $now = null, int $tolerance = 300): bool
    {
        return self::verifyWebhook($rawBody, $headers, $clientSecret, $now, $tolerance);
    }

    private static function redact(mixed $value, array $hidden): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        $result = [];
        foreach ($value as $key => $inner) {
            $result[$key] = in_array($key, $hidden, true) ? '•••' : self::redact($inner, $hidden);
        }
        return $result;
    }
}
