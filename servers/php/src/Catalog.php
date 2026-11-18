<?php

namespace Daryeel;

final class Catalog
{
    public const CURRENCY = 'USD';
    public const CITY_TAX_PER_NIGHT = 2;
    public const DEPOSIT_AMOUNT = 50;
    public const PLAN_LIMIT = 300;
    public const MAX_NIGHTS = 14;

    public const HOTELS = [
        ['id' => 'lido-beach', 'name' => 'Lido Beach Hotel', 'city' => 'Mogadishu', 'rating' => 4.6, 'tags' => ['Sea view', 'Breakfast'], 'room' => 'Deluxe sea view', 'price' => 85, 'look' => 'a'],
        ['id' => 'jazeera-palace', 'name' => 'Jazeera Palace', 'city' => 'Mogadishu', 'rating' => 4.4, 'tags' => ['Airport 5 min'], 'room' => 'Executive double', 'price' => 70, 'look' => 'b'],
        ['id' => 'peace-hotel', 'name' => 'Peace Hotel', 'city' => 'Mogadishu', 'rating' => 4.2, 'tags' => ['City centre'], 'room' => 'Standard double', 'price' => 55, 'look' => 'c'],
        ['id' => 'hargeisa-gardens', 'name' => 'Hargeisa Gardens', 'city' => 'Hargeisa', 'rating' => 4.3, 'tags' => ['Garden', 'Breakfast'], 'room' => 'Garden room', 'price' => 60, 'look' => 'd'],
    ];

    public static function hotel(mixed $id): ?array
    {
        foreach (self::HOTELS as $hotel) {
            if ($hotel['id'] === $id) {
                return $hotel;
            }
        }
        return null;
    }

    /** The server prices every stay. The page never sends an amount. */
    public static function quoteStay(array $hotel, int|float $nights): array
    {
        $roomTotal = $hotel['price'] * $nights;
        $cityTax = self::CITY_TAX_PER_NIGHT * $nights;
        return ['nights' => $nights, 'room_total' => $roomTotal, 'city_tax' => $cityTax, 'total' => $roomTotal + $cityTax, 'currency' => self::CURRENCY];
    }
}
