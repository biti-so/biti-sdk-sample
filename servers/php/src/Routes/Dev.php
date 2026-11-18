<?php

namespace Daryeel\Routes;

use Biti\Sdk\BitiClient;
use Biti\Sdk\BitiError;
use Daryeel\Json;
use Daryeel\Request;
use Daryeel\Response;
use Daryeel\Store;

/** Playground and call log. Only reachable when DEV_TOOLS=1. */
final class Dev
{
    public const KEEP_CALLS = 50;

    public function __construct(private BitiClient $biti, private Store $store)
    {
    }

    /** Stores one traced Biti call so the next request can show it. */
    public static function recordCall(Store $store, array $entry): void
    {
        $id = sprintf('%.6f-%s', microtime(true), bin2hex(random_bytes(3)));
        $store->put('call', $id, ['at' => Store::now()] + $entry);
        $store->keepNewest('call', self::KEEP_CALLS);
    }

    public static function disabled(): Response
    {
        return Response::error('Dev tools are off', 404, 'dev_tools_off');
    }

    public function log(Request $request): Response
    {
        return Response::json(['server_calls' => $this->store->list('call'), 'webhooks' => array_slice($this->store->list('event'), 0, 20)]);
    }

    public function endpoints(Request $request): Response
    {
        return Response::json(['endpoints' => self::endpointTable()]);
    }

    public static function endpointTable(): array
    {
        return array_map(fn ($entry) => ['method' => $entry[0], 'endpoint' => $entry[1], 'token' => $entry[2]], BitiClient::ENDPOINTS);
    }

    public function call(Request $request): Response
    {
        $name = $request->params['endpoint'];
        $entry = null;
        foreach (self::endpointTable() as $candidate) {
            if ($candidate['endpoint'] === $name) {
                $entry = $candidate;
            }
        }
        if (!$entry) {
            return Response::json(['ok' => false, 'status' => 404, 'error' => 'Unknown endpoint']);
        }
        if ($entry['token'] && !$request->session->token()) {
            return Response::json(['ok' => false, 'status' => 401, 'error' => 'Sign in with Biti first', 'code' => 'sign_in_required']);
        }

        $body = $request->input('body');
        try {
            $data = $this->biti->call($name, Json::truthy($body) && is_array($body) ? $body : [], $entry['token'] ? $request->session->token() : null);
            return Response::json(['ok' => true, 'status' => 200, 'data' => $data]);
        } catch (BitiError $error) {
            return Response::json(Json::withoutNulls(['ok' => false, 'status' => $error->status ?: 500, 'error' => $error->getMessage(), 'code' => $error->errorCode, 'data' => $error->data]));
        }
    }
}
