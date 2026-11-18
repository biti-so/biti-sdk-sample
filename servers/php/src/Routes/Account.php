<?php

namespace Daryeel\Routes;

use Biti\Sdk\BitiClient;
use Biti\Sdk\BitiError;
use Daryeel\Catalog;
use Daryeel\Json;
use Daryeel\Request;
use Daryeel\Response;
use Daryeel\Store;

/** Sign-in (mini browser code or Connect by phone), wallet and top-ups. */
final class Account
{
    public const LOGIN_SCOPES = ['profile.read', 'wallet.read', 'wallet.topup'];

    public function __construct(private BitiClient $biti, private Store $store)
    {
    }

    public function me(Request $request): Response
    {
        return Response::json($request->session->publicUser());
    }

    public function login(Request $request): Response
    {
        $code = (string) ($request->input('code') ?? '');
        if ($code === '') {
            return Response::error('code is required', 400);
        }
        $data = $this->biti->call('exchange-login-code', ['code' => $code]);
        $request->session->signIn($data, 'mini_browser');
        return Response::json($request->session->publicUser());
    }

    public function logout(Request $request): Response
    {
        $request->session->signOut();
        return Response::json(['signed_in' => false]);
    }

    public function connect(Request $request): Response
    {
        $phone = preg_replace('/\s+/', '', (string) ($request->input('phone') ?? ''));
        if (!preg_match('/^\+?\d{7,15}$/', $phone)) {
            return Response::error('Enter a phone number, for example +252615123456', 400);
        }
        $data = $this->biti->call('connect-request', ['phone' => $phone, 'scopes' => implode(',', self::LOGIN_SCOPES), 'device' => 'Daryeel Stays web']);
        return Response::json(Json::withoutNulls([
            'request_token' => $data['request_token'] ?? null,
            'expires_in' => $data['expires_in'] ?? null,
            'install' => $data['install'] ?? null,
        ]));
    }

    public function connectStatus(Request $request): Response
    {
        $data = $this->biti->call('connect-status', ['request_token' => $request->params['token']]);
        if (!empty($data['access_token'])) {
            $request->session->signIn($data, 'connect');
        }
        return Response::json(Json::withoutNulls([
            'status' => $data['status'] ?? null,
            'account_exists' => $data['account_exists'] ?? null,
            'expires_in' => $data['expires_in'] ?? null,
            'me' => $request->session->publicUser(),
        ]));
    }

    public function wallet(Request $request): Response
    {
        $token = $request->session->token();
        $wallet = $this->biti->call('connected-wallet', [], $token);
        try {
            $methods = $this->biti->call('get-topup-methods', [], $token);
        } catch (BitiError $error) {
            $methods = ['error' => $error->getMessage(), 'methods' => []];
        }
        return Response::json(['wallet' => $wallet, 'topup' => $methods]);
    }

    public function topup(Request $request): Response
    {
        $amount = Json::number($request->input('amount'));
        $methodId = (string) ($request->input('method_id') ?? '');
        $key = $request->header('Idempotency-Key');
        $reference = 'TU-' . substr(preg_replace('/[^A-Za-z0-9]/', '', (string) ($key ?: (int) (microtime(true) * 1000))), 0, 40);
        if (!($amount > 0) || $methodId === '' || !preg_match('/^[A-Za-z0-9._:-]{1,64}$/', $reference)) {
            return Response::error('method_id and an amount above 0 are required', 400);
        }

        try {
            $data = $this->biti->call('create-topup', [
                'method_id' => $methodId,
                'amount' => $amount,
                'currency' => Json::truthy($request->input('currency')) ? $request->input('currency') : Catalog::CURRENCY,
                'reference' => $reference,
            ], $request->session->token());
        } catch (BitiError $error) {
            if ($error->errorCode === 'needs_linking') {
                return Response::error($error->getMessage(), 409, $error->errorCode, ['link_url' => $error->data['link_url'] ?? null]);
            }
            throw $error;
        }
        $this->store->put('topup', $data['topup_id'], $data + ['reference' => $reference, 'created_at' => Store::now()], $request->session->owner());
        return Response::json($data);
    }

    public function topupStatus(Request $request): Response
    {
        $id = $request->params['id'];
        $data = $this->biti->call('get-topup-status', ['topup_id' => $id], $request->session->token());
        if ($this->store->get('topup', $id)) {
            $this->store->update('topup', $id, function (array &$topup) use ($data) {
                $topup = array_merge($topup, (array) $data);
            });
        }
        return Response::json($data);
    }
}
