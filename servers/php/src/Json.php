<?php

namespace Daryeel;

final class Json
{
    public static function encode(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    /** Drops null values, like JSON.stringify drops undefined. */
    public static function withoutNulls(array $values): array
    {
        return array_filter($values, fn ($value) => $value !== null);
    }

    /** JavaScript truthiness for request values. */
    public static function truthy(mixed $value): bool
    {
        return !($value === null || $value === false || $value === 0 || $value === 0.0 || $value === '');
    }

    /** JavaScript Number(): NAN when the value is not numeric. */
    public static function number(mixed $value): float|int
    {
        if ($value === null) {
            return NAN;
        }
        if (is_bool($value)) {
            return (int) $value;
        }
        if (is_string($value) && trim($value) === '') {
            return 0;
        }
        return is_numeric($value) ? $value + 0 : NAN;
    }

    public static function isWhole(mixed $number): bool
    {
        return !is_nan((float) $number) && is_finite((float) $number) && floor((float) $number) == $number;
    }
}
