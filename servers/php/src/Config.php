<?php

namespace Daryeel;

/** Settings from the process environment, then the repo-root .env. */
final class Config
{
    public string $bitiBaseUrl;
    public string $bitiWalletUrl;
    public string $clientId;
    public string $clientSecret;
    /** @var string[] */
    public array $appOrigins;
    public string $runMode;
    public string $appId;
    public string $sessionSecret;
    public bool $devTools;
    public bool $cookieSecure;
    public string $dbPath;

    public function __construct(public readonly string $root)
    {
        $values = self::readEnvFile($root . '/.env');
        $get = function (string $key, string $default = '') use ($values): string {
            $env = getenv($key);
            return $env !== false && $env !== '' ? $env : ($values[$key] ?? $default);
        };

        $this->bitiBaseUrl = rtrim($get('BITI_BASE_URL', 'http://192.168.100.200:8004'), '/');
        $this->bitiWalletUrl = rtrim($get('BITI_WALLET_URL', 'http://192.168.100.200:8052'), '/');
        $this->clientId = $get('BITI_CLIENT_ID');
        $this->clientSecret = $get('BITI_CLIENT_SECRET');
        $this->appOrigins = array_values(array_filter(array_map(
            fn ($origin) => rtrim(trim($origin), '/'),
            explode(',', $get('APP_ORIGINS'))
        )));
        $this->runMode = $get('RUN_MODE') === 'biti_only' ? 'biti_only' : 'anywhere';
        $this->appId = $get('BITI_APP_ID', 'daryeel-stays');
        $this->sessionSecret = $get('SESSION_SECRET');
        $this->devTools = $get('DEV_TOOLS') === '1';
        $this->cookieSecure = $get('COOKIE_SECURE') === '1';

        $db = $get('DB_PATH', 'data/daryeel.sqlite');
        $this->dbPath = str_starts_with($db, '/') ? $db : $root . '/' . $db;
    }

    /** @return string[] names of required settings that are empty */
    public function missing(): array
    {
        return array_keys(array_filter([
            'BITI_CLIENT_ID' => $this->clientId,
            'BITI_CLIENT_SECRET' => $this->clientSecret,
            'SESSION_SECRET' => $this->sessionSecret,
        ], fn ($value) => $value === ''));
    }

    private static function readEnvFile(string $file): array
    {
        $values = [];
        foreach (is_file($file) ? file($file, FILE_IGNORE_NEW_LINES) : [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $value = trim($value);
            if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[-1] === $value[0]) {
                $value = substr($value, 1, -1);
            }
            $values[trim($key)] = $value;
        }
        return $values;
    }
}
