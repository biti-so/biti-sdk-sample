<?php

namespace Daryeel\Routes;

use Biti\Sdk\BitiClient;
use Daryeel\Catalog;
use Daryeel\Config;
use Daryeel\Json;
use Daryeel\Request;
use Daryeel\Response;
use Daryeel\Store;

/** Monthly stay plan: a Biti mandate the server charges for each stay. */
final class Plan
{
    private const ENDED = ['revoked', 'expired'];

    public function __construct(private BitiClient $biti, private Store $store, private Config $config)
    {
    }

    private function sync(array $plan, string $owner): array
    {
        $status = $this->biti->call('get-mandate-status', ['mandate_id' => $plan['mandate_id']]);
        return $this->store->update('plan', $owner, function (array &$current) use ($status) {
            $current = array_merge($current, (array) $status);
        });
    }

    public function show(Request $request): Response
    {
        $owner = $request->session->owner();
        $plan = $this->store->get('plan', $owner);
        return Response::json($plan ? $this->sync($plan, $owner) : null);
    }

    public function create(Request $request): Response
    {
        $owner = $request->session->owner();
        $earlier = $this->store->get('plan', $owner);
        if ($earlier && !in_array($earlier['status'] ?? null, self::ENDED, true)) {
            return Response::json($this->sync($earlier, $owner));
        }

        $sequence = ($earlier['sequence'] ?? 0) + 1;
        $digits = substr(preg_replace('/\D/', '', $owner), -9);
        $reference = 'PLAN-' . ($digits !== '' ? $digits : 'guest') . "-$sequence";
        $mandate = $this->biti->call('create-mandate', Json::withoutNulls([
            'max_amount' => Catalog::PLAN_LIMIT,
            'currency' => Catalog::CURRENCY,
            'period' => 'month',
            'reference' => $reference,
            'description' => 'Monthly stay plan: up to 4 nights a month',
            'return_url' => $request->returnUrl($this->config, '/plan'),
        ]));
        $plan = array_merge((array) $mandate, [
            'owner' => $owner, 'reference' => $reference, 'sequence' => $sequence,
            'max_amount' => Catalog::PLAN_LIMIT, 'period' => 'month', 'charges' => [],
        ]);
        return Response::json($this->store->put('plan', $owner, $plan, $owner), 201);
    }

    /** Books one stay and charges it to the plan, without a payment sheet. */
    public function charge(Request $request): Response
    {
        $owner = $request->session->owner();
        $plan = $this->store->get('plan', $owner);
        if (!$plan) {
            return Response::error('Set up the monthly plan first', 409);
        }
        $key = $request->header('Idempotency-Key');
        $earlier = $key ? $this->store->get('idempotency', $key) : null;
        if ($earlier) {
            return Response::json($this->store->get('booking', $earlier['booking_id']));
        }

        $hotel = Catalog::hotel($request->input('hotel_id'));
        $nights = Json::number($request->input('nights'));
        $nights = Json::truthy($nights) && !is_nan((float) $nights) ? $nights : 1;
        $checkIn = Json::truthy($request->input('check_in')) ? (string) $request->input('check_in') : Bookings::addDays(gmdate('Y-m-d'), 1);
        if (!$hotel || $nights < 1 || $nights > 4) {
            return Response::error('Pick a hotel and 1 to 4 nights', 400);
        }

        $quote = Catalog::quoteStay($hotel, $nights);
        $id = 'BK-' . $this->store->nextNumber('booking', 2041);
        $reference = "$id-PLAN";
        $charge = $this->biti->call('charge-mandate', ['mandate_id' => $plan['mandate_id'], 'amount' => $quote['total'], 'reference' => $reference]);
        $now = Store::now();
        $booking = [
            'id' => $id, 'owner' => $owner, 'guest' => $request->session->data['user'] ?? new \stdClass(),
            'hotel_id' => $hotel['id'], 'hotel_name' => $hotel['name'], 'room' => $hotel['room'],
            'check_in' => $checkIn, 'check_out' => Bookings::addDays($checkIn, $nights), 'nights' => $nights, 'guests' => 1, 'quote' => $quote,
            'paid_by' => 'plan', 'status' => 'confirmed', 'attempts' => 0,
            'transaction_id' => $charge['transaction_id'] ?? null, 'plan_reference' => $reference,
            'created_at' => $now,
        ];
        $this->store->transaction(function () use ($booking, $id, $owner, $quote, $reference, $key, $now) {
            $this->store->put('booking', $id, $booking, $owner);
            $this->store->update('plan', $owner, function (array &$current) use ($reference, $id, $quote, $now) {
                array_unshift($current['charges'], ['reference' => $reference, 'booking_id' => $id, 'amount' => $quote['total'], 'at' => $now]);
            });
            if ($key) {
                $this->store->put('idempotency', $key, ['booking_id' => $id]);
            }
        });
        $this->sync($this->store->get('plan', $owner), $owner);
        return Response::json($booking, 201);
    }
}
