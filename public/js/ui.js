export const config = window.APP_CONFIG;

/** Shared page state. main.js sets navigate() and render(). */
export const app = {
  me: { signed_in: false },
  hotels: [],
  search: null,
  navigate: () => {},
  render: () => {},
};

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function money(amount, currency = config.currency) {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

export function usd(amount) {
  return `$${Number(amount || 0).toFixed(Number.isInteger(Number(amount)) ? 0 : 2)}`;
}

const DAY = 24 * 3600 * 1000;

export function isoDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(iso, days) {
  return isoDate(new Date(new Date(`${iso}T12:00:00`).getTime() + days * DAY));
}

export function shortDate(iso, withDay = true) {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString("en-GB", withDay ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
}

export function stayRange(checkIn, nights) {
  return `${shortDate(checkIn)} – ${shortDate(addDays(checkIn, nights))}`;
}

export function nextFriday() {
  const date = new Date();
  date.setDate(date.getDate() + ((5 - date.getDay() + 7) % 7 || 7));
  return isoDate(date);
}

export function quote(hotel, nights) {
  const roomTotal = hotel.price * nights;
  const cityTax = config.cityTaxPerNight * nights;
  return { roomTotal, cityTax, total: roomTotal + cityTax };
}

export function hotelImage(hotel, size = "") {
  return `<span class="img look-${esc(hotel?.look || "a")} ${size}" aria-hidden="true"></span>`;
}

export function header(title, back = "/") {
  return `<header class="bar"><button class="back" data-go="${esc(back)}" aria-label="Back">←</button><h1>${esc(title)}</h1></header>`;
}

export function alertBox(message, tone = "error") {
  return message ? `<div class="alert ${tone}" role="${tone === "error" ? "alert" : "status"}">${esc(message)}</div>` : "";
}

let toastTimer;
export function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

/** Shows a bottom sheet. Returns a close function. */
export function openSheet(html, { dismissible = true } = {}) {
  const overlay = document.getElementById("overlay");
  overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  overlay.hidden = false;
  overlay.onclick = (event) => {
    if (dismissible && event.target === overlay) closeSheet();
  };
  return closeSheet;
}

export function closeSheet() {
  const overlay = document.getElementById("overlay");
  overlay.hidden = true;
  overlay.innerHTML = "";
}

export function checkingSheet(title = "Checking your payment…") {
  return openSheet(`<div class="center pad"><div class="spin"></div><b>${esc(title)}</b><small class="muted">Don't close the app.</small></div>`, { dismissible: false });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function statusPill(status) {
  const key = String(status || "").toLowerCase().replace(/ /g, "_");
  const tone = { confirmed: "g", active: "g", held: "g", done: "g", paid: "g", cancelled: "n", released: "n", captured: "a", awaiting_payment: "a", pending: "a", open: "a", part_paid: "a" }[key] || "r";
  const text = String(status || "unknown").replace(/_/g, " ");
  return `<span class="pill ${tone}">${esc(text[0].toUpperCase() + text.slice(1))}</span>`;
}
