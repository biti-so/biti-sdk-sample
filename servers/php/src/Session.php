<?php

namespace Daryeel;

/** Every visitor gets a signed session id cookie. The Biti token stays in the `session` records. */
final class Session
{
    public const COOKIE = 'daryeel_sid';
    private const LIFETIME = 30 * 24 * 3600;

    public array $data;

    private function __construct(private Store $store, public readonly string $id, array $data)
    {
        $this->data = $data;
    }

    public static function start(Request $request, Store $store, Config $config): self
    {
        $id = self::verify($request->cookies[self::COOKIE] ?? '', $config->sessionSecret);
        $data = $id ? $store->get('session', $id) : null;
        if ($data !== null) {
            return new self($store, $id, $data);
        }

        $id = bin2hex(random_bytes(24));
        $session = new self($store, $id, ['id' => $id]);
        $session->save();
        setcookie(self::COOKIE, $id . '.' . hash_hmac('sha256', $id, $config->sessionSecret), [
            'expires' => time() + self::LIFETIME,
            'path' => '/',
            'secure' => $config->cookieSecure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        return $session;
    }

    private static function verify(string $cookie, string $secret): ?string
    {
        $dot = strrpos($cookie, '.');
        if ($dot === false) {
            return null;
        }
        $id = substr($cookie, 0, $dot);
        return hash_equals(hash_hmac('sha256', $id, $secret), substr($cookie, $dot + 1)) ? $id : null;
    }

    public function save(): void
    {
        $this->store->put('session', $this->id, $this->data);
    }

    public function signIn(array $login, string $via): void
    {
        $this->data['token'] = $login['access_token'] ?? null;
        $this->data['expires_at'] = $login['expires_at'] ?? null;
        $this->data['scopes'] = $login['scopes'] ?? [];
        $this->data['user'] = $login['user'] ?? new \stdClass();
        $this->data['via'] = $via;
        $this->save();
    }

    public function signOut(): void
    {
        foreach (['token', 'expires_at', 'scopes', 'user', 'via'] as $key) {
            unset($this->data[$key]);
        }
        $this->save();
    }

    public function isSignedIn(): bool
    {
        if (empty($this->data['token'])) {
            return false;
        }
        $expires = $this->data['expires_at'] ?? null;
        return !$expires || strtotime($expires) > time();
    }

    public function token(): ?string
    {
        return $this->data['token'] ?? null;
    }

    public function user(): array
    {
        return (array) ($this->data['user'] ?? []);
    }

    /** The customer key for bookings and plans: the phone Biti returned at sign-in. */
    public function owner(): string
    {
        $user = $this->user();
        return $user['phone'] ?? null ?: ($user['full_name'] ?? null ?: $this->id);
    }

    public function publicUser(): array
    {
        if (!$this->isSignedIn()) {
            return ['signed_in' => false];
        }
        return Json::withoutNulls([
            'signed_in' => true,
            'via' => $this->data['via'] ?? null,
            'user' => $this->user() ?: new \stdClass(),
            'scopes' => $this->data['scopes'] ?? [],
            'expires_at' => $this->data['expires_at'] ?? null,
        ]);
    }
}
