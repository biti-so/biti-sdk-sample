const CURRENCY = "USD";
const CITY_TAX_PER_NIGHT = 2;
const DEPOSIT_AMOUNT = 50;
const PLAN_LIMIT = 300;
const MAX_NIGHTS = 14;

const HOTELS = [
  { id: "lido-beach", name: "Lido Beach Hotel", city: "Mogadishu", rating: 4.6, tags: ["Sea view", "Breakfast"], room: "Deluxe sea view", price: 85, look: "a" },
  { id: "jazeera-palace", name: "Jazeera Palace", city: "Mogadishu", rating: 4.4, tags: ["Airport 5 min"], room: "Executive double", price: 70, look: "b" },
  { id: "peace-hotel", name: "Peace Hotel", city: "Mogadishu", rating: 4.2, tags: ["City centre"], room: "Standard double", price: 55, look: "c" },
  { id: "hargeisa-gardens", name: "Hargeisa Gardens", city: "Hargeisa", rating: 4.3, tags: ["Garden", "Breakfast"], room: "Garden room", price: 60, look: "d" },
];

function getHotel(id) {
  return HOTELS.find((hotel) => hotel.id === id) || null;
}

/** The server prices every stay. The page never sends an amount. */
function quoteStay(hotel, nights) {
  const roomTotal = hotel.price * nights;
  const cityTax = CITY_TAX_PER_NIGHT * nights;
  return { nights, room_total: roomTotal, city_tax: cityTax, total: roomTotal + cityTax, currency: CURRENCY };
}

module.exports = { CURRENCY, CITY_TAX_PER_NIGHT, DEPOSIT_AMOUNT, PLAN_LIMIT, MAX_NIGHTS, HOTELS, getHotel, quoteStay };
