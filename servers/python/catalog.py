CURRENCY = "USD"
CITY_TAX_PER_NIGHT = 2
DEPOSIT_AMOUNT = 50
PLAN_LIMIT = 300
MAX_NIGHTS = 14

HOTELS = [
    {"id": "lido-beach", "name": "Lido Beach Hotel", "city": "Mogadishu", "rating": 4.6, "tags": ["Sea view", "Breakfast"], "room": "Deluxe sea view", "price": 85, "look": "a"},
    {"id": "jazeera-palace", "name": "Jazeera Palace", "city": "Mogadishu", "rating": 4.4, "tags": ["Airport 5 min"], "room": "Executive double", "price": 70, "look": "b"},
    {"id": "peace-hotel", "name": "Peace Hotel", "city": "Mogadishu", "rating": 4.2, "tags": ["City centre"], "room": "Standard double", "price": 55, "look": "c"},
    {"id": "hargeisa-gardens", "name": "Hargeisa Gardens", "city": "Hargeisa", "rating": 4.3, "tags": ["Garden", "Breakfast"], "room": "Garden room", "price": 60, "look": "d"},
]


def get_hotel(hotel_id):
    return next((hotel for hotel in HOTELS if hotel["id"] == hotel_id), None)


def quote_stay(hotel, nights):
    """The server prices every stay. The page never sends an amount."""
    room_total = hotel["price"] * nights
    city_tax = CITY_TAX_PER_NIGHT * nights
    return {"nights": nights, "room_total": room_total, "city_tax": city_tax, "total": room_total + city_tax, "currency": CURRENCY}
