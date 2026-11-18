<?php

namespace Daryeel;

use Biti\Sdk\BitiClient;
use Biti\Sdk\BitiError;
use Daryeel\Routes\Account;
use Daryeel\Routes\Bills;
use Daryeel\Routes\Bookings;
use Daryeel\Routes\Dev;
use Daryeel\Routes\Plan;
use Daryeel\Routes\Webhooks;

/** Front controller: the route table, session start and error mapping. */
final class App
{
    private const PAGE_ROUTES = ['/', '/hotel/:id', '/checkout/:id', '/booking/:id', '/bookings', '/plan', '/deposit/:id', '/wallet', '/connect', '/dev', '/dev/bills', '/dev/webhooks'];
    private const MIME_TYPES = [
        'html' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'js' => 'application/javascript; charset=utf-8',
        'json' => 'application/json', 'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif', 'webp' => 'image/webp', 'ico' => 'image/x-icon', 'woff' => 'font/woff', 'woff2' => 'font/woff2',
        'txt' => 'text/plain; charset=utf-8', 'map' => 'application/json',
    ];

    private Store $store;
    private BitiClient $biti;
    private string $publicDir;

    public function __construct(private Config $config)
    {
        $this->publicDir = $config->root . '/public';
        $this->store = new Store($config->dbPath);
        Bills::seedAccounts($this->store);
        $this->biti = new BitiClient(
            $config->bitiBaseUrl,
            $config->clientId,
            $config->clientSecret,
            20,
            $config->devTools ? fn (array $entry) => Dev::recordCall($this->store, $entry) : null,
        );
    }

    public function handle(Request $request): ?Response
    {
        try {
            return $this->dispatch($request);
        } catch (BitiError $error) {
            $status = $error->status >= 500 || !$error->status ? 502 : $error->status;
            return Response::json(Json::withoutNulls(['error' => $error->getMessage(), 'code' => $error->errorCode, 'data' => $error->data, 'source' => 'biti']), $status);
        } catch (\Throwable $error) {
            error_log((string) $error);
            return Response::error($error->getMessage() ?: 'Something went wrong', 500);
        }
    }

    private function dispatch(Request $request): ?Response
    {
        $secret = $this->config->clientSecret;
        $path = $request->path;

        if ($request->method === 'POST' && $path === '/webhooks/biti') {
            return (new Webhooks($this->store, $secret))->receive($request);
        }
        if ($request->method === 'POST' && $path === '/biller/lookup') {
            return (new Bills($this->biti, $this->store, $secret))->lookup($request);
        }
        if ($request->method === 'GET' && $path === '/config.js') {
            return $this->configScript();
        }
        if (str_starts_with($path, '/api/') || $path === '/api') {
            $request->session = Session::start($request, $this->store, $this->config);
            return $this->api($request);
        }
        if ($request->method === 'GET' || $request->method === 'HEAD') {
            return $this->staticFile($path) ?? $this->page($path);
        }
        return null;
    }

    private function configScript(): Response
    {
        $pageConfig = [
            'sdkUrl' => $this->config->bitiBaseUrl . '/assets/biti_wallet/js/biti-sdk.js',
            'bitiOrigin' => $this->config->bitiWalletUrl,
            'runMode' => $this->config->runMode,
            'appId' => $this->config->appId,
            'loginScopes' => Account::LOGIN_SCOPES,
            'currency' => Catalog::CURRENCY,
            'cityTaxPerNight' => Catalog::CITY_TAX_PER_NIGHT,
            'depositAmount' => Catalog::DEPOSIT_AMOUNT,
            'planLimit' => Catalog::PLAN_LIMIT,
            'devTools' => $this->config->devTools,
        ];
        return new Response(200, 'window.APP_CONFIG = ' . Json::encode($pageConfig) . ';', 'application/javascript; charset=utf-8', ['Cache-Control' => 'no-store']);
    }

    private function page(string $path): ?Response
    {
        foreach (self::PAGE_ROUTES as $route) {
            if (preg_match(Router::pattern($route), $path)) {
                return new Response(200, file_get_contents($this->publicDir . '/index.html'), 'text/html; charset=utf-8');
            }
        }
        return null;
    }

    private function staticFile(string $path): ?Response
    {
        $file = realpath($this->publicDir . $path);
        $root = realpath($this->publicDir);
        if ($file === false || !is_file($file) || !str_starts_with($file, $root . DIRECTORY_SEPARATOR) || str_ends_with($file, '.php')) {
            return null;
        }
        $type = self::MIME_TYPES[strtolower(pathinfo($file, PATHINFO_EXTENSION))] ?? 'application/octet-stream';
        return new Response(200, file_get_contents($file), $type);
    }

    private function api(Request $request): Response
    {
        $match = $this->routes()->match($request->method, $request->path);
        if (!$this->config->devTools && preg_match('#^/api/(dev|playground)(/|$)#', $request->path)) {
            return Dev::disabled();
        }
        if (!$match) {
            return Response::error('Not found', 404);
        }
        [$handler, $needsUser, $request->params] = $match;
        if ($needsUser && !$request->session->isSignedIn()) {
            return Response::error('Sign in with Biti first', 401, 'sign_in_required');
        }
        return $handler($request);
    }

    private function routes(): Router
    {
        $account = new Account($this->biti, $this->store);
        $bookings = new Bookings($this->biti, $this->store, $this->config);
        $plan = new Plan($this->biti, $this->store, $this->config);
        $bills = new Bills($this->biti, $this->store, $this->config->clientSecret);
        $dev = new Dev($this->biti, $this->store);
        $router = new Router();

        $router->add('GET', '/api/health', [$this, 'health']);
        $router->add('GET', '/api/hotels', fn () => Response::json(Catalog::HOTELS));

        if ($this->config->devTools) {
            $router->add('GET', '/api/dev/log', [$dev, 'log']);
            $router->add('GET', '/api/playground', [$dev, 'endpoints']);
            $router->add('POST', '/api/playground/:endpoint', [$dev, 'call']);
        }

        $router->add('GET', '/api/me', [$account, 'me']);
        $router->add('POST', '/api/login', [$account, 'login']);
        $router->add('POST', '/api/logout', [$account, 'logout']);
        $router->add('POST', '/api/connect', [$account, 'connect']);
        $router->add('GET', '/api/connect/:token', [$account, 'connectStatus']);
        $router->add('GET', '/api/wallet', [$account, 'wallet'], true);
        $router->add('POST', '/api/topup', [$account, 'topup'], true);
        $router->add('GET', '/api/topup/:id', [$account, 'topupStatus'], true);

        $router->add('GET', '/api/bookings', [$bookings, 'list'], true);
        $router->add('POST', '/api/bookings', [$bookings, 'create'], true);
        $router->add('GET', '/api/bookings/:id', [$bookings, 'show'], true);
        $router->add('POST', '/api/bookings/:id/pay', [$bookings, 'pay'], true);
        $router->add('POST', '/api/bookings/:id/cancel', [$bookings, 'cancel'], true);
        $router->add('POST', '/api/deposit', [$bookings, 'createDeposit'], true);
        $router->add('GET', '/api/deposit/:holdId', [$bookings, 'showDeposit'], true);
        $router->add('POST', '/api/deposit/:holdId/release', [$bookings, 'releaseDeposit'], true);
        $router->add('POST', '/api/deposit/:holdId/capture', [$bookings, 'captureDeposit'], true);

        $router->add('GET', '/api/plan', [$plan, 'show'], true);
        $router->add('POST', '/api/plan', [$plan, 'create'], true);
        $router->add('POST', '/api/plan/charge', [$plan, 'charge'], true);

        $router->add('GET', '/api/bills', [$bills, 'index']);
        $router->add('POST', '/api/bills', [$bills, 'create']);
        $router->add('POST', '/api/bills/connect/:account', [$bills, 'connect']);
        $router->add('GET', '/api/bills/:id', [$bills, 'show']);
        $router->add('POST', '/api/bills/:id/cancel', [$bills, 'cancel']);
        return $router;
    }

    public function health(): Response
    {
        $started = microtime(true);
        $handle = curl_init($this->config->bitiBaseUrl . '/api/method/ping');
        curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5]);
        curl_exec($handle);
        $reachable = curl_errno($handle) === 0 && curl_getinfo($handle, CURLINFO_RESPONSE_CODE) < 400;
        curl_close($handle);
        return Response::json([
            'ok' => true,
            'biti_reachable' => $reachable,
            'biti_base_url' => $this->config->bitiBaseUrl,
            'ms' => (int) round((microtime(true) - $started) * 1000),
            'server' => 'php',
        ]);
    }
}
