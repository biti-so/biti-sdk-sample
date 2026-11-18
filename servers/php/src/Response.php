<?php

namespace Daryeel;

final class Response
{
    public function __construct(public int $status, public string $body, public string $type = 'application/json; charset=utf-8', public array $headers = [])
    {
    }

    public static function json(mixed $data, int $status = 200): self
    {
        return new self($status, Json::encode($data));
    }

    public static function error(string $message, int $status, ?string $code = null, array $extra = []): self
    {
        return self::json(Json::withoutNulls(['error' => $message, 'code' => $code] + $extra), $status);
    }

    public function send(): void
    {
        http_response_code($this->status);
        header('Content-Type: ' . $this->type);
        foreach ($this->headers as $name => $value) {
            header("$name: $value");
        }
        echo $this->body;
    }
}
