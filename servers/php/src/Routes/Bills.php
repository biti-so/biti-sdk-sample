<?php

namespace Daryeel\Routes;

use Biti\Sdk\BitiClient;
use Daryeel\Json;
use Daryeel\Request;
use Daryeel\Response;
use Daryeel\Store;

/** Daryeel Stays as a Biti Bill Provider: push bills, answer Biti's account lookup. */
final class Bills
{
    private const OPEN_STATUSES = ['Open', 'Part paid'];
    private const DEMO_ACCOUNTS = [
        ['account_number' => 'DS-1001', 'customer_name' => 'Ahmed Ali', 'area' => 'Mogadishu'],
        ['account_number' => 'DS-1002', 'customer_name' => 'Hodan Warsame', 'area' => 'Hargeisa'],
        ['account_number' => 'DS-1003', 'customer_name' => 'Abdi Salam', 'area' => 'Mogadishu'],
    ];

    public function __construct(private BitiClient $biti, private Store $store, private string $clientSecret)
    {
    }

    public static function seedAccounts(Store $store): void
    {
        foreach (self::DEMO_ACCOUNTS as $account) {
            if (!$store->get('bill_account', $account['account_number'])) {
                $store->put('bill_account', $account['account_number'], $account);
            }
        }
    }

    /** "part_paid" and "PAID" both become Biti's "Part paid" and "Paid". */
    public static function billStatus(mixed $value): string
    {
        return ucfirst(strtolower(str_replace('_', ' ', (string) $value)));
    }

    public function index(Request $request): Response
    {
        $rows = $this->store->list('bill_account');
        return Response::json([
            'accounts' => array_values(array_reverse(array_filter($rows, fn ($row) => empty($row['requested_at'])))),
            'bills' => $this->store->list('bill'),
            'connect_requests' => array_values(array_filter($rows, fn ($row) => !empty($row['requested_at']))),
        ]);
    }

    public function create(Request $request): Response
    {
        $accountNumber = $request->input('account_number');
        $title = trim((string) ($request->input('title') ?? ''));
        $amount = Json::number($request->input('amount'));
        if (!is_scalar($accountNumber) || !$this->store->get('bill_account', (string) $accountNumber)) {
            return Response::error('Unknown account', 404, 'unknown_account');
        }
        if ($title === '' || !($amount > 0)) {
            return Response::error('title and an amount above 0 are required', 400);
        }

        $externalId = 'INV-' . $this->store->nextNumber('invoice', 1001);
        $body = ['account_number' => (string) $accountNumber, 'external_id' => $externalId, 'title' => $title, 'amount' => $amount];
        if (Json::truthy($request->input('min_amount'))) {
            $body['min_amount'] = Json::number($request->input('min_amount'));
        }
        if (Json::truthy($request->input('due_date'))) {
            $body['due_date'] = (string) $request->input('due_date');
        }
        $this->biti->billpayPushBill($body);

        $bill = ['id' => $externalId] + $body + ['status' => 'Open', 'paid_amount' => 0, 'created_at' => Store::now()];
        return Response::json($this->store->put('bill', $externalId, $bill, (string) $accountNumber), 201);
    }

    public function show(Request $request): Response
    {
        $id = $request->params['id'];
        if (!$this->store->get('bill', $id)) {
            return Response::error('Bill not found', 404);
        }
        $remote = $this->biti->billpayBillStatus(['external_id' => $id]);
        return Response::json($this->store->update('bill', $id, function (array &$bill) use ($remote) {
            if (!empty($remote['status'])) {
                $bill['status'] = self::billStatus($remote['status']);
            }
            if (isset($remote['paid_amount'])) {
                $bill['paid_amount'] = Json::number($remote['paid_amount']);
            }
        }));
    }

    public function cancel(Request $request): Response
    {
        $id = $request->params['id'];
        if (!$this->store->get('bill', $id)) {
            return Response::error('Bill not found', 404);
        }
        $this->biti->billpayCancelBill(['external_id' => $id]);
        return Response::json($this->store->update('bill', $id, function (array &$bill) {
            $bill['status'] = 'Cancelled';
        }));
    }

    public function connect(Request $request): Response
    {
        $account = $request->params['account'];
        $requestId = "request:$account";
        if (!$this->store->get('bill_account', $requestId)) {
            return Response::error('No connect request for this account', 404);
        }
        $data = $this->biti->billpayConfirmAccount(['account_number' => $account, 'approved' => Json::truthy($request->input('approved'))]);
        $this->store->delete('bill_account', $requestId);
        return Response::json($data ?? ['ok' => true]);
    }

    /** Biti calls this with a signed body. Verify the raw bytes before parsing. */
    public function lookup(Request $request): Response
    {
        if (!BitiClient::verifyLookup($request->raw, $request->headers, $this->clientSecret)) {
            return Response::error('bad signature', 401);
        }
        $payload = json_decode($request->raw, true);
        if (!is_array($payload)) {
            return Response::error('body is not JSON', 400);
        }

        $accountNumber = $payload['account_number'] ?? null;
        $account = is_scalar($accountNumber) ? $this->store->get('bill_account', (string) $accountNumber) : null;
        if (!$account || !empty($account['requested_at'])) {
            return Response::error('unknown_account', 404);
        }

        $invoices = [];
        foreach ($this->store->listOwned('bill', (string) $accountNumber) as $bill) {
            if (in_array($bill['status'], self::OPEN_STATUSES, true)) {
                $invoices[] = ['id' => $bill['external_id'], 'title' => $bill['title'], 'amount' => $bill['amount'], 'min_amount' => $bill['min_amount'] ?? null, 'due' => $bill['due_date'] ?? null];
            }
        }
        return Response::json(['customer_name' => $account['customer_name'], 'area' => $account['area'], 'invoices' => $invoices]);
    }
}
