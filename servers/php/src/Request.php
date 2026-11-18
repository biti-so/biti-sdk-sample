<?php

namespace Daryeel;

final class Request
{
    public array $body = [];
    public array $headers = [];
    public ?Session $session = null;
    public array $params = [];

    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly string $raw,
        public readonly array $cookies,
        array $serverVars,
        public readonly string $host,
        public readonly bool $https,
    ) {
        foreach ($serverVars as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $this->headers[strtolower(str_replace('_', '-', substr($key, 5)))] = $value;
            }
        }
        $decoded = json_decode($raw, true);
        $this->body = is_array($decoded) ? $decoded : [];
    }

    public static function fromGlobals(): self
    {
        $path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
        return new self(
            strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            $path === '/' ? '/' : rtrim($path, '/'),
            file_get_contents('php://input') ?: '',
            $_COOKIE,
            $_SERVER,
            $_SERVER['HTTP_HOST'] ?? 'localhost',
            !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        );
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function input(string $key): mixed
    {
        return $this->body[$key] ?? null;
    }

    /** A return URL for Biti's web pages, only when this request came from an allowed origin. */
    public function returnUrl(Config $config, string $pagePath): ?string
    {
        $origin = ($this->https ? 'https' : 'http') . '://' . $this->host;
        return in_array($origin, $config->appOrigins, true) ? $origin . $pagePath : null;
    }
}
