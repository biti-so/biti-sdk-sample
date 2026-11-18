<?php

namespace Daryeel\Routes;

use Biti\Sdk\BitiClient;
use Daryeel\Catalog;
use Daryeel\Config;
use Daryeel\Json;
use Daryeel\Request;
use Daryeel\Response;
use Daryeel\Store;

/** Bookings: orders, payment checks, refunds and the room deposit hold. */
final class Bookings
{
    private const DAY = 24 * 3600;
    private const RETRYABLE_ORDER = ['expired', 'cancelled', 'failed'];

    public function __construct(private BitiClient $biti, private Store $store, private Config $config)
    {
    }

    public static function addDays(string $isoDate, int|float $days): string
    {
        return gmdate('Y-m-d', strtotime($isoDate . ' 00:00:00 UTC') + (int) ($days * self::DAY));
    }

    private static function toLocalDateTime(int $timestamp): string
    {
        return date('Y-m-d H:i:00', $timestamp);
    }

    private static function iso(int $timestamp): string
    {
        return (new \DateTimeImmutable('@' . $timestamp))->format('Y-m-d\TH:i:s.v\Z');
    }

    /** Free cancellation ends 24 hours before check-in at 12:00. */
    private static function cancelDeadline(array $booking): int
    {
        return strtotime($booking['check_in'] . ' 12:00:00') - self::DAY;
    }

    private static function parseStay(array $body): array
    {
        $hotel = Catalog::hotel($body['hotel_id'] ?? null);
        $nights = Json::number($body['nights'] ?? null);
        $guests = Json::number($body['guests'] ?? null);
        $checkIn = (string) ($body['check_in'] ?? '');
        $max = Catalog::MAX_NIGHTS;

        if (!$hotel) {
            return ['error' => 'Unknown hotel'];
        }
        if (!Json::isWhole($nights) || $nights < 1 || $nights > $max) {
            return ['error' => "Nights must be 1 to $max"];
        }
        if (!Json::isWhole($guests) || $guests < 1 || $guests > 6) {
            return ['error' => 'Guests must be 1 to 6'];
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $checkIn) || $checkIn < gmdate('Y-m-d')) {
            return ['error' => 'Pick a check-in date from today on'];
        }
        return ['hotel' => $hotel, 'nights' => (int) $nights, 'guests' => (int) $guests, 'checkIn' => $checkIn];
    }

    private function ownBooking(Request $request): ?array
    {
        $booking = $this->store->get('booking', $request->params['id'] ?? ($request->input('booking_id') === null ? null : (string) $request->input('booking_id')));
        return $booking && $booking['owner'] === $request->session->owner() ? $booking : null;
    }

    private function startPayment(Request $request, array $booking): array
    {
        $updated = $this->store->update('booking', $booking['id'], function (array &$current) {
            $current['attempts']++;
        });
        $reference = $booking['id'] . '-P' . $updated['attempts'];
        $nights = $booking['nights'];
        $order = $this->biti->call('create-order', Json::withoutNulls([
            'amount' => $booking['quote']['total'],
            'currency' => $booking['quote']['currency'],
            'reference' => $reference,
            'description' => "{$booking['hotel_name']} · $nights night" . ($nights > 1 ? 's' : '') . " from {$booking['check_in']}",
            'return_url' => $request->returnUrl($this->config, '/booking/' . $booking['id']),
        ]));
        return $this->store->update('booking', $booking['id'], function (array &$current) use ($order, $reference) {
            $current['order'] = array_merge((array) $order, ['reference' => $reference]);
            $current['status'] = 'awaiting_payment';
        });
    }

    /** Only Biti's answer confirms a booking, never the page. */
    private function syncOrder(array $booking): array
    {
        if (empty($booking['order']) || $booking['status'] === 'cancelled') {
            return $booking;
        }
        $order = $this->biti->call('get-order-status', ['order_id' => $booking['order']['order_id']]);
        return $this->store->update('booking', $booking['id'], function (array &$current) use ($order) {
            $status = $order['status'] ?? null;
            $current['order']['status'] = $status;
            if ($status === 'paid' || $status === 'partially_refunded') {
                $current['status'] = 'confirmed';
                $current['transaction_id'] = $order['transaction_id'] ?? null;
                $current['paid_at'] = $order['paid_at'] ?? null;
            }
            if ($status === 'refunded') {
                $current['status'] = 'cancelled';
            }
            if (in_array($status, self::RETRYABLE_ORDER, true) && $current['status'] === 'awaiting_payment') {
                $current['status'] = 'payment_' . $status;
            }
        });
    }

    public function list(Request $request): Response
    {
        return Response::json($this->store->listOwned('booking', $request->session->owner()));
    }

    public function create(Request $request): Response
    {
        $key = $request->header('Idempotency-Key');
        $earlier = $key ? $this->store->get('idempotency', $key) : null;
        if ($earlier) {
            return Response::json($this->store->get('booking', $earlier['booking_id']));
        }

        $stay = self::parseStay($request->body);
        if (isset($stay['error'])) {
            return Response::error($stay['error'], 400);
        }
        $hotel = $stay['hotel'];
        $booking = [
            'id' => 'BK-' . $this->store->nextNumber('booking', 2041),
            'owner' => $request->session->owner(),
            'guest' => $request->session->data['user'] ?? new \stdClass(),
            'hotel_id' => $hotel['id'],
            'hotel_name' => $hotel['name'],
            'room' => $hotel['room'],
            'check_in' => $stay['checkIn'],
            'check_out' => self::addDays($stay['checkIn'], $stay['nights']),
            'nights' => $stay['nights'],
            'guests' => $stay['guests'],
            'quote' => Catalog::quoteStay($hotel, $stay['nights']),
            'paid_by' => 'order',
            'attempts' => 0,
            'created_at' => self::iso(time()),
        ];
        $this->store->transaction(function () use ($booking, $key) {
            $this->store->put('booking', $booking['id'], $booking, $booking['owner']);
            if ($key) {
                $this->store->put('idempotency', $key, ['booking_id' => $booking['id']]);
            }
        });
        return Response::json($this->startPayment($request, $booking), 201);
    }

    public function show(Request $request): Response
    {
        $booking = $this->ownBooking($request);
        if (!$booking) {
            return Response::error('Booking not found', 404);
        }
        $synced = $this->syncOrder($booking);
        return Response::json($synced + ['cancel_until' => self::iso(self::cancelDeadline($synced))]);
    }

    /** A new attempt only when the last order can no longer be paid. */
    public function pay(Request $request): Response
    {
        $booking = $this->ownBooking($request);
        if (!$booking) {
            return Response::error('Booking not found', 404);
        }
        $synced = $this->syncOrder($booking);
        if ($synced['status'] === 'confirmed') {
            return Response::json($synced);
        }
        $retry = empty($synced['order']) || in_array($synced['order']['status'] ?? null, self::RETRYABLE_ORDER, true);
        return Response::json($retry ? $this->startPayment($request, $synced) : $synced);
    }

    public function cancel(Request $request): Response
    {
        $booking = $this->ownBooking($request);
        if (!$booking) {
            return Response::error('Booking not found', 404);
        }
        if ($booking['status'] !== 'confirmed' || ($booking['paid_by'] ?? null) !== 'order') {
            return Response::error('Only a paid booking can be cancelled here', 409);
        }
        if (time() > self::cancelDeadline($booking)) {
            return Response::error('Free cancellation has ended for this booking', 409);
        }

        $refund = $this->biti->call('refund-order', [
            'order_id' => $booking['order']['order_id'],
            'reason' => 'Guest cancelled the booking',
            'reference' => $booking['id'] . '-refund',
        ]);
        $released = ($booking['deposit']['status'] ?? null) === 'held' ? $this->biti->call('release-hold', ['hold_id' => $booking['deposit']['hold_id']]) : null;
        return Response::json($this->store->update('booking', $booking['id'], function (array &$current) use ($refund, $released) {
            $current['status'] = 'cancelled';
            $current['refund'] = $refund;
            $current['cancelled_at'] = self::iso(time());
            if ($released) {
                $current['deposit'] = array_merge($current['deposit'], (array) $released);
            }
        }));
    }

    public function createDeposit(Request $request): Response
    {
        $booking = $this->ownBooking($request);
        if (!$booking) {
            return Response::error('Booking not found', 404);
        }
        if ($booking['status'] !== 'confirmed') {
            return Response::error('Pay the booking first', 409);
        }
        if (!empty($booking['deposit']) && ($booking['deposit']['status'] ?? null) !== 'expired') {
            return Response::json($booking['deposit']);
        }

        $releaseBy = min(strtotime($booking['check_out'] . ' 12:00:00'), time() + 29 * self::DAY);
        $hold = $this->biti->call('create-hold', Json::withoutNulls([
            'amount' => Catalog::DEPOSIT_AMOUNT,
            'currency' => Catalog::CURRENCY,
            'reference' => $booking['id'] . '-deposit',
            'release_by' => self::toLocalDateTime($releaseBy),
            'description' => "Room deposit · {$booking['hotel_name']} · {$booking['id']}",
            'return_url' => $request->returnUrl($this->config, '/booking/' . $booking['id']),
        ]));
        $updated = $this->store->update('booking', $booking['id'], function (array &$current) use ($hold, $releaseBy) {
            $current['deposit'] = array_merge((array) $hold, ['amount' => Catalog::DEPOSIT_AMOUNT, 'release_by' => self::iso($releaseBy)]);
        });
        return Response::json($updated['deposit']);
    }

    private function depositBooking(Request $request): ?array
    {
        foreach ($this->store->listOwned('booking', $request->session->owner()) as $booking) {
            if (($booking['deposit']['hold_id'] ?? null) === $request->params['holdId']) {
                return $booking;
            }
        }
        return null;
    }

    private function mergeHold(array $booking, mixed $hold): Response
    {
        $updated = $this->store->update('booking', $booking['id'], function (array &$current) use ($hold) {
            $current['deposit'] = array_merge($current['deposit'], (array) $hold);
        });
        return Response::json($updated['deposit']);
    }

    public function showDeposit(Request $request): Response
    {
        $booking = $this->depositBooking($request);
        if (!$booking) {
            return Response::error('Deposit not found', 404);
        }
        return $this->mergeHold($booking, $this->biti->call('get-hold-status', ['hold_id' => $request->params['holdId']]));
    }

    public function releaseDeposit(Request $request): Response
    {
        return $this->holdAction($request, 'release');
    }

    public function captureDeposit(Request $request): Response
    {
        return $this->holdAction($request, 'capture');
    }

    /** In a real hotel only staff release or capture; the sample shows both calls. */
    private function holdAction(Request $request, string $action): Response
    {
        $booking = $this->depositBooking($request);
        if (!$booking) {
            return Response::error('Deposit not found', 404);
        }
        $body = ['hold_id' => $request->params['holdId']];
        if ($action === 'capture' && Json::truthy($request->input('amount'))) {
            $body['amount'] = Json::number($request->input('amount'));
        }
        return $this->mergeHold($booking, $this->biti->call("$action-hold", $body));
    }
}
