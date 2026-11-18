<?php

namespace Daryeel\Routes;

use Biti\Sdk\BitiClient;
use Daryeel\Request;
use Daryeel\Response;
use Daryeel\Store;

/** Verifies and applies Biti's signed events. */
final class Webhooks
{
    private const KEEP_EVENTS = 100;

    public function __construct(private Store $store, private string $clientSecret)
    {
    }

    private function findBooking(callable $match): ?array
    {
        foreach ($this->store->list('booking') as $booking) {
            if ($match($booking)) {
                return $booking;
            }
        }
        return null;
    }

    private function applyBillEvent(string $event, array $data): string
    {
        $id = $data['external_id'] ?? $data['id'] ?? null;
        if ($event === 'bill.account_connect_requested') {
            $account = $data['account_number'] ?? null;
            $customer = $data['customer'] ?? [];
            $this->store->put('bill_account', "request:$account", [
                'account_number' => $account,
                'customer_name' => $data['customer_name'] ?? ($customer['full_name'] ?? ($customer['phone'] ?? null)),
                'requested_at' => Store::now(),
            ]);
            return "connect request for $account";
        }

        if (!$this->store->get('bill', $id)) {
            return 'no bill';
        }
        $bill = $this->store->update('bill', (string) $id, function (array &$current) use ($event, $data) {
            if ($event === 'bill.disputed') {
                $current['status'] = 'Disputed';
            }
            if ($event === 'bill.paid') {
                $current['paid_amount'] = $data['paid_amount'] ?? $current['amount'];
                $current['status'] = $current['paid_amount'] < $current['amount'] ? 'Part paid' : 'Paid';
            }
        });
        return "$id {$bill['status']}";
    }

    /** Applies one verified event to local state. Returns what it changed, for the log. */
    private function applyEvent(string $event, array $data): string
    {
        $dataId = $data['id'] ?? null;

        if ($event === 'payment.paid') {
            $booking = $this->findBooking(fn ($b) => ($b['order']['order_id'] ?? null) === $dataId);
            if (!$booking || $booking['status'] === 'cancelled') {
                return 'no booking for this order';
            }
            $this->store->update('booking', $booking['id'], function (array &$current) use ($data) {
                $current['status'] = 'confirmed';
                $current['transaction_id'] = $data['transaction_id'] ?? null;
                $current['order']['status'] = 'paid';
            });
            return "{$booking['id']} confirmed";
        }
        if ($event === 'payment.failed') {
            $booking = $this->findBooking(fn ($b) => ($b['order']['order_id'] ?? null) === $dataId);
            if ($booking) {
                $this->store->update('booking', $booking['id'], function (array &$current) use ($data) {
                    $current['payment_error'] = $data['error'] ?? null;
                });
            }
            return $booking ? "{$booking['id']} payment failed" : 'no booking';
        }
        if ($event === 'refund.done') {
            $booking = $this->findBooking(fn ($b) => ($b['order']['order_id'] ?? null) === $dataId);
            if ($booking) {
                $this->store->update('booking', $booking['id'], function (array &$current) use ($data) {
                    $current['status'] = 'cancelled';
                    $current['refund'] = array_merge((array) ($current['refund'] ?? []), ['refunded_amount' => $data['refunded_amount'] ?? null]);
                });
            }
            return $booking ? "{$booking['id']} refunded" : 'no booking';
        }
        if (str_starts_with($event, 'hold.')) {
            $status = substr($event, 5);
            $booking = $this->findBooking(fn ($b) => ($b['deposit']['hold_id'] ?? null) === $dataId);
            if ($booking) {
                $this->store->update('booking', $booking['id'], function (array &$current) use ($status) {
                    $current['deposit']['status'] = $status;
                });
            }
            return $booking ? "{$booking['id']} deposit $status" : 'no booking';
        }
        if (str_starts_with($event, 'mandate.')) {
            $status = substr($event, 8);
            $plan = null;
            foreach ($this->store->list('plan') as $item) {
                if (($item['mandate_id'] ?? null) === $dataId) {
                    $plan = $item;
                    break;
                }
            }
            if ($plan && $event !== 'mandate.charged') {
                $this->store->update('plan', $plan['owner'], function (array &$current) use ($status) {
                    $current['status'] = $status;
                });
            }
            return $plan ? "plan $status" : 'no plan';
        }
        if (str_starts_with($event, 'topup.')) {
            $status = $event === 'topup.done' ? 'done' : 'failed';
            $topup = $this->store->get('topup', $dataId === null ? null : (string) $dataId);
            if ($topup) {
                $this->store->update('topup', (string) $dataId, function (array &$current) use ($status) {
                    $current['status'] = $status;
                });
            }
            return $topup ? "top-up $status" : 'no top-up';
        }
        if (str_starts_with($event, 'bill.')) {
            return $this->applyBillEvent($event, $data);
        }
        return 'ignored';
    }

    public function receive(Request $request): Response
    {
        if (!BitiClient::verifyWebhook($request->raw, $request->headers, $this->clientSecret)) {
            error_log('webhook rejected: bad signature ' . $request->header('X-Biti-Event'));
            return Response::error('bad signature', 401);
        }
        $payload = json_decode($request->raw, true);
        if (!is_array($payload)) {
            return Response::error('body is not JSON', 400);
        }
        if (empty($payload['id']) || empty($payload['event'])) {
            return Response::error('id and event are required', 400);
        }

        $result = $this->store->transaction(function () use ($payload, $request) {
            $id = (string) $payload['id'];
            if ($this->store->get('event', $id)) {
                return null;
            }
            $data = is_array($payload['data'] ?? null) ? $payload['data'] : [];
            $outcome = $this->applyEvent((string) $payload['event'], $data);
            $this->store->put('event', $id, [
                'id' => $payload['id'],
                'event' => $payload['event'],
                'header_event' => $request->header('X-Biti-Event'),
                'sent_at' => $request->header('X-Biti-Timestamp'),
                'received_at' => Store::now(),
                'result' => $outcome,
                'data' => $payload['data'] ?? null,
            ]);
            $this->store->keepNewest('event', self::KEEP_EVENTS);
            return $outcome;
        });

        if ($result === null) {
            return Response::json(['ok' => true, 'duplicate' => true]);
        }
        error_log("webhook {$payload['event']} {$payload['id']}: $result");
        return Response::json(['ok' => true]);
    }
}
