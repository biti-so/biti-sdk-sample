<?php

require __DIR__ . '/../src/BitiError.php';
require __DIR__ . '/../src/BitiClient.php';

use Biti\Sdk\BitiClient;
use Biti\Sdk\BitiError;

$passed = 0;
$failed = 0;

function check(string $name, bool $ok): void
{
    global $passed, $failed;
    $ok ? $passed++ : $failed++;
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . "\n";
}

function failure(callable $run): ?BitiError
{
    try {
        $run();
    } catch (BitiError $error) {
        return $error;
    }
    return null;
}

$secret = 's3cret';
$body = '{"event":"x"}';
$now = 1700000000;
$sign = fn (string $text, string $key = 's3cret') => hash_hmac('sha256', $text, $key);
$headers = ['X-Biti-Signature' => $sign($body), 'X-Biti-Timestamp' => (string) $now];

check('valid signature', BitiClient::verifyWebhook($body, $headers, $secret, $now));
check('verifyLookup is the same check', BitiClient::verifyLookup($body, $headers, $secret, $now));
check('case-insensitive headers', BitiClient::verifyWebhook($body, ['x-biti-signature' => $sign($body), 'X-BITI-TIMESTAMP' => (string) $now], $secret, $now));
check('wrong secret', !BitiClient::verifyWebhook($body, $headers, 'other', $now));
check('tampered body', !BitiClient::verifyWebhook($body . ' ', $headers, $secret, $now));
check('missing headers', !BitiClient::verifyWebhook($body, [], $secret, $now));
check('stale timestamp', !BitiClient::verifyWebhook($body, $headers, $secret, $now + 301));
check('tolerance widens window', BitiClient::verifyWebhook($body, $headers, $secret, $now + 301, 600));

check('plain envelope', BitiClient::parseResponse(200, '{"success":true,"data":{"ok":1}}') === ['ok' => 1]);
check('nested message envelope', BitiClient::parseResponse(200, '{"message":{"success":true,"data":{"id":7}}}') === ['id' => 7]);

$error = failure(fn () => BitiClient::parseResponse(409, '{"success":false,"message":"Nope","data":{"code":"needs_linking"}}'));
check('error status, message, code', $error && $error->status === 409 && $error->getMessage() === 'Nope' && $error->errorCode === 'needs_linking');

$error = failure(fn () => BitiClient::parseResponse(502, 'not json'));
check('non-JSON answer', $error && $error->status === 502 && str_contains($error->getMessage(), 'without JSON'));

$error = failure(fn () => BitiClient::parseResponse(200, '{"success":false,"message":"Bad","code":"c1"}'));
check('success=false on HTTP 200', $error && $error->errorCode === 'c1');

$methods = array_column(BitiClient::ENDPOINTS, 0);
check('33 endpoints', count($methods) === 33 && in_array('billpayConfirmAccount', $methods, true));

$client = new BitiClient('http://127.0.0.1:1', 'cid', $secret, 2);
$error = failure(fn () => $client->createOrder([]));
check('network error is 502', $error && $error->status === 502);

try {
    $client->nope();
    check('unknown method throws', false);
} catch (BadMethodCallException) {
    check('unknown method throws', true);
}

echo "\n$passed passed, $failed failed\n";
exit($failed ? 1 : 0);
