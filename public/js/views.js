import { api, explain, isInBiti, newKey, sdk } from "./client.js";
import {
  alertBox, app, checkingSheet, closeSheet, config, esc, header, hotelImage, money, openSheet, quote,
  shortDate, sleep, statusPill, stayRange, toast, usd,
} from "./ui.js";

const CITIES = ["Mogadishu", "Hargeisa"];

function hotelById(id) {
  return app.hotels.find((hotel) => hotel.id === id);
}

function hotelSubtitle(hotel) {
  return `★ ${hotel.rating} · ${hotel.tags.join(" · ")}`;
}

function guestLine(count) {
  return `${count} guest${count > 1 ? "s" : ""}`;
}

/** Mini browser: biti.login() then the server swaps the code. Web: Connect by phone. */
export async function signIn(next = location.pathname) {
  if (!isInBiti()) return app.navigate(`/connect?next=${encodeURIComponent(next)}`);
  const { code } = await sdk("login", { scopes: config.loginScopes });
  app.me = await api("POST", "/login", { code });
  toast(`Signed in as ${app.me.user?.full_name || "Biti customer"}`);
  app.render();
}

async function waitForBooking(id, isDone, tries = 8) {
  let booking = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    booking = await api("GET", `/bookings/${id}`);
    if (isDone(booking)) return booking;
    await sleep(1500);
  }
  return booking;
}

/** Asks Biti to pay the order. In a web browser the SDK leaves the page for the Biti pay page. */
async function payBooking(booking) {
  await sdk("requestPayment", { order_id: booking.order.order_id, return_url: `${location.origin}/booking/${booking.id}` });
  const close = checkingSheet();
  try {
    await waitForBooking(booking.id, (item) => item.status !== "awaiting_payment");
  } finally {
    close();
  }
  app.navigate(`/booking/${booking.id}`);
}

function bindClick(root, selector, handler) {
  root.querySelectorAll(selector).forEach((node) => {
    node.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const errorSlot = root.querySelector("[data-error]");
      if (errorSlot) errorSlot.innerHTML = "";
      button.disabled = true;
      try {
        await handler(button);
      } catch (error) {
        if (errorSlot) errorSlot.innerHTML = alertBox(explain(error));
        else toast(explain(error));
      } finally {
        button.disabled = false;
      }
    });
  });
}

function accountCard() {
  if (app.me.signed_in) {
    const user = app.me.user || {};
    return `<div class="card row-card"><span class="avatar">${esc((user.full_name || "B")[0])}</span><span class="tx"><b>${esc(user.full_name || "Biti customer")}</b><small>${esc(user.phone || "")} · via ${app.me.via === "connect" ? "Connect" : "Biti app"}</small></span><button class="chip" data-action="logout">Sign out</button></div>`;
  }
  return `<div class="card"><b>Sign in with Biti</b><p class="muted small">Fill your details from Biti and pay from your wallet.</p><button class="btn app" data-action="signin">${isInBiti() ? "Sign in with Biti" : "Connect your Biti wallet"}</button></div>`;
}

function hotelRow(hotel) {
  return `<button class="row" data-go="/hotel/${esc(hotel.id)}">${hotelImage(hotel)}<span class="tx"><b>${esc(hotel.name)}</b><small>${esc(hotelSubtitle(hotel))}</small></span><span class="price">${usd(hotel.price)}<small>/night</small></span></button>`;
}

export const views = {
  async home() {
    const search = app.search;
    const hotels = app.hotels.filter((hotel) => hotel.city === search.city);
    const html = `
      <div class="hero"><small>${esc(search.city)} · ${search.nights} night${search.nights > 1 ? "s" : ""}</small><b>Find your stay</b></div>
      <div class="chips">
        <button class="chip on" data-action="dates">${esc(stayRange(search.checkIn, search.nights))}</button>
        <button class="chip" data-action="guests">${guestLine(search.guests)}</button>
        ${CITIES.map((city) => `<button class="chip ${city === search.city ? "sel" : ""}" data-city="${city}">${city}</button>`).join("")}
      </div>
      ${hotels.map(hotelRow).join("")}
      <div class="links">
        <button class="tile" data-go="/bookings"><span>▤</span>My bookings</button>
        <button class="tile" data-go="/plan"><span>↻</span>Stay plan</button>
        <button class="tile" data-go="/wallet"><span>◎</span>Wallet</button>
      </div>
      ${accountCard()}
      <p class="foot muted">${isInBiti() ? `Running inside Biti. To report a problem, tap ··· in the Biti bar, then Report.` : `Web browser. Payments open the Biti web page, then come back here.`}</p>
      ${isInBiti() ? `<button class="btn sec" data-action="close">Back to Biti</button>` : ""}`;

    return {
      html,
      mount(root) {
        root.querySelectorAll("[data-city]").forEach((node) => node.addEventListener("click", () => {
          app.search.city = node.dataset.city;
          app.render();
        }));
        root.querySelector("[data-action=guests]").addEventListener("click", () => {
          app.search.guests = (app.search.guests % 4) + 1;
          app.render();
        });
        root.querySelector("[data-action=dates]").addEventListener("click", openDatesSheet);
        bindCommon(root);
      },
    };
  },

  async hotel({ id }) {
    const hotel = hotelById(id);
    if (!hotel) return notFound("Hotel not found");
    const { nights, checkIn, guests } = app.search;
    const price = quote(hotel, nights);
    const map = `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${hotel.name} ${hotel.city}`)}`;
    return {
      html: `${header(hotel.name)}
        <div class="photo look-${esc(hotel.look)}"><span>${esc(hotel.city)}</span></div>
        <div class="card"><b class="lg">${esc(hotel.name)}</b><small class="muted block">${esc(hotelSubtitle(hotel))}</small>
          <div class="line"><span class="muted">Room</span><span>${esc(hotel.room)}</span></div>
          <div class="line"><span class="muted">Dates</span><span>${esc(stayRange(checkIn, nights))}</span></div>
          <div class="line"><span class="muted">Guests</span><span>${guestLine(guests)}</span></div>
          <div class="line"><span class="muted">Price</span><span>${usd(hotel.price)} a night</span></div>
        </div>
        <div class="card"><b>Good to know</b><ul class="list"><li>Free cancellation up to 24 hours before check-in.</li><li>Refunds go back to your Biti wallet.</li><li>A ${usd(config.depositAmount)} room deposit can be held in your wallet and released at checkout.</li></ul></div>
        <a class="weblink" href="${esc(map)}" target="_blank" rel="noopener">See ${esc(hotel.name)} on the map ↗</a>
        <button class="btn app" data-go="/checkout/${esc(hotel.id)}">Book · ${usd(price.total)} total</button>`,
      mount: bindCommon,
    };
  },

  async checkout({ id }) {
    const hotel = hotelById(id);
    if (!hotel) return notFound("Hotel not found");
    const { nights, checkIn, guests } = app.search;
    const price = quote(hotel, nights);
    const user = app.me.user || {};
    const guestCard = app.me.signed_in
      ? `<div class="card"><b>Guest details</b><div class="line"><span class="muted">Name</span><span>${esc(user.full_name || "—")}</span></div><div class="line"><span class="muted">Phone</span><span>${esc(user.phone || "—")}</span></div><small class="muted">Filled from Biti</small></div>`
      : `<div class="card"><b>Guest details</b><p class="muted small">Sign in to fill your details and pay with your wallet.</p><button class="btn app" data-action="signin">Sign in with Biti</button></div>`;
    return {
      html: `${header("Checkout", `/hotel/${hotel.id}`)}
        ${guestCard}
        <div class="row static">${hotelImage(hotel)}<span class="tx"><b>${esc(hotel.name)}</b><small>${esc(hotel.room)} · ${esc(stayRange(checkIn, nights))} · ${guestLine(guests)}</small></span></div>
        <div class="card">
          <div class="line"><span class="muted">${nights} night${nights > 1 ? "s" : ""} × ${usd(hotel.price)}</span><span>$${price.roomTotal.toFixed(2)}</span></div>
          <div class="line"><span class="muted">City tax</span><span>$${price.cityTax.toFixed(2)}</span></div>
          <div class="line tot"><span>Total</span><span>$${price.total.toFixed(2)}</span></div>
        </div>
        <div data-error></div>
        <button class="btn app" data-action="pay" ${app.me.signed_in ? "" : "disabled"}>Pay with Biti</button>
        <div class="card"><b>Monthly stay plan</b><p class="muted small">Business travellers: up to 4 nights a month, charged automatically.</p><button class="btn sec" data-go="/plan" ${app.me.signed_in ? "" : "disabled"}>Set up automatic payments</button></div>`,
      mount(root) {
        bindCommon(root);
        const attemptKey = newKey("book");
        bindClick(root, "[data-action=pay]", async () => {
          const booking = await api("POST", "/bookings", { hotel_id: hotel.id, check_in: checkIn, nights, guests }, { idempotencyKey: attemptKey });
          await payBooking(booking);
        });
      },
    };
  },

  async booking({ id }, query) {
    const fromWeb = query.get("biti_order");
    if (fromWeb) history.replaceState(null, "", `/booking/${id}`);
    let booking;
    try {
      booking = fromWeb ? await waitForBooking(id, (item) => item.status !== "awaiting_payment", 4) : await api("GET", `/bookings/${id}`);
    } catch (error) {
      return notFound(error.status === 401 ? "Sign in to see this booking" : explain(error), error.status === 401);
    }
    return { html: bookingHtml(booking, fromWeb ? query.get("status") : null), mount: (root) => mountBooking(root, booking) };
  },

  async deposit({ id }) {
    const booking = await api("GET", `/bookings/${id}`).catch(() => null);
    if (!booking) return notFound("Booking not found");
    return {
      html: `${header("Room deposit", `/booking/${booking.id}`)}<div class="row static">${hotelImage(hotelById(booking.hotel_id))}<span class="tx"><b>${esc(booking.hotel_name)}</b><small>${esc(booking.id)} · ${esc(stayRange(booking.check_in, booking.nights))}</small></span></div>${depositCard(booking)}<div data-error></div>`,
      mount: (root) => mountBooking(root, booking),
    };
  },

  async bookings() {
    if (!app.me.signed_in) return notFound("Sign in to see your bookings", true);
    const list = await api("GET", "/bookings");
    const rows = list.map((booking) => `<button class="row" data-go="/booking/${esc(booking.id)}">${hotelImage(hotelById(booking.hotel_id))}<span class="tx"><b>${esc(booking.hotel_name)}</b><small>${esc(booking.id)} · ${esc(shortDate(booking.check_in, false))}–${esc(shortDate(booking.check_out, false))} · ${booking.paid_by === "plan" ? "Stay plan" : esc(money(booking.quote.total))}</small></span>${statusPill(booking.status)}</button>`);
    return {
      html: `${header("My bookings")}${rows.join("") || `<div class="center pad"><b>No bookings yet</b><small class="muted">Book a hotel and it shows here.</small><button class="btn app" data-go="/">Find a hotel</button></div>`}`,
      mount: bindCommon,
    };
  },

  async plan() {
    if (!app.me.signed_in) return notFound("Sign in to set up a stay plan", true);
    const plan = await api("GET", "/plan");
    const active = plan?.status === "active";
    const options = app.hotels.map((hotel) => `<option value="${esc(hotel.id)}">${esc(hotel.name)} · ${usd(hotel.price)}/night</option>`).join("");
    return {
      html: `${header("Monthly stay plan")}
        <div class="card"><b>Pay for stays automatically</b><p class="muted small">You allow Daryeel Stays to charge up to ${money(config.planLimit)} a month. Each stay is charged when you book it. Cancel any time in Biti, Settings, Connected apps.</p>
          ${plan ? `<div class="line"><span class="muted">Status</span>${statusPill(plan.status)}</div><div class="line"><span class="muted">Limit</span><span>${money(plan.max_amount)} / ${esc(plan.period)}</span></div>${active && plan.remaining !== undefined ? `<div class="line"><span class="muted">Left this ${esc(plan.period)}</span><span>${money(plan.remaining)}</span></div>` : ""}<div class="line"><span class="muted">Mandate</span><span class="mono">${esc(plan.mandate_id)}</span></div>` : ""}
        </div>
        <div data-error></div>
        ${active ? "" : `<button class="btn app" data-action="approve">${plan?.status === "pending" ? "Approve in Biti" : "Set up automatic payments"}</button>`}
        ${plan?.status === "pending" ? `<button class="btn sec" data-action="refresh">Check status</button>` : ""}
        ${active ? `<div class="card"><b>Book with your plan</b><p class="muted small">No payment sheet. The server charges the plan.</p>
          <label class="field">Hotel<select id="plan-hotel">${options}</select></label>
          <label class="field">Nights<select id="plan-nights">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join("")}</select></label>
          <button class="btn app" data-action="charge">Book and charge plan</button></div>` : ""}
        ${(plan?.charges || []).map((charge) => `<button class="row" data-go="/booking/${esc(charge.booking_id)}"><span class="round g">↻</span><span class="tx"><b>${esc(charge.booking_id)}</b><small>${esc(new Date(charge.at).toLocaleString())}</small></span><span class="price">${money(charge.amount)}</span></button>`).join("")}`,
      mount(root) {
        bindCommon(root);
        bindClick(root, "[data-action=approve]", async () => {
          const created = await api("POST", "/plan");
          const result = await sdk("requestApproval", { mandate_id: created.mandate_id, return_url: `${location.origin}/plan` });
          toast(result?.status === "active" || result?.status === "approved" ? "Automatic payments allowed" : "Checking the plan…");
          app.render();
        });
        bindClick(root, "[data-action=refresh]", async () => app.render());
        const chargeKey = newKey("plan");
        bindClick(root, "[data-action=charge]", async () => {
          const booking = await api("POST", "/plan/charge", {
            hotel_id: root.querySelector("#plan-hotel").value,
            nights: Number(root.querySelector("#plan-nights").value),
            check_in: app.search.checkIn,
          }, { idempotencyKey: chargeKey });
          toast(`${booking.hotel_name} booked with your plan`);
          app.navigate(`/booking/${booking.id}`);
        });
      },
    };
  },

  async wallet() {
    if (!app.me.signed_in) return notFound("Connect your Biti wallet to see it here", true);
    const { wallet, topup } = await api("GET", "/wallet");
    const methods = topup.methods || [];
    return {
      html: `${header("Biti wallet")}
        <div class="walletcard"><small>${esc(wallet.wallet_label || "Connected wallet")}</small><b>${money(wallet.balance, wallet.currency)}</b><span>${esc(wallet.status || "")}</span></div>
        <p class="muted small">Only this one wallet is connected to Daryeel Stays. Biti shows the balance because you allowed wallet.read.</p>
        <div class="card"><b>Top up this wallet</b>
          ${topup.error ? alertBox(topup.error) : ""}
          ${methods.length ? methods.map((method, index) => `<label class="radio"><input type="radio" name="method" value="${esc(method.id)}" ${index === 0 ? "checked" : ""}><span><b>${esc(method.label || method.provider)}</b><small class="muted">${esc(method.masked_number || method.kind)}</small></span></label>`).join("") : `<p class="muted small">No top-up methods are on for this app.</p>`}
          <label class="field">Amount (${esc(wallet.currency)})<input id="topup-amount" type="number" inputmode="decimal" min="1" step="1" value="20"></label>
          <button class="btn app" data-action="topup" ${methods.length ? "" : "disabled"}>Start top-up</button>
          ${topup.topup_link ? `<a class="weblink" href="${esc(topup.topup_link)}">Top up in the Biti app ↗</a>` : ""}
        </div>
        <div data-error></div><div id="topup-result"></div>`,
      mount(root) {
        bindCommon(root);
        let key = newKey("topup");
        bindClick(root, "[data-action=topup]", async () => {
          const methodId = root.querySelector("input[name=method]:checked")?.value;
          const amount = Number(root.querySelector("#topup-amount").value);
          try {
            const result = await api("POST", "/topup", { method_id: methodId, amount, currency: wallet.currency }, { idempotencyKey: key });
            key = newKey("topup");
            root.querySelector("#topup-result").innerHTML = topupHtml(result);
            bindClick(root, "[data-action=topup-status]", async () => {
              root.querySelector("#topup-result").innerHTML = topupHtml(await api("GET", `/topup/${result.topup_id}`));
            });
          } catch (error) {
            if (error.code !== "needs_linking") throw error;
            root.querySelector("#topup-result").innerHTML = `<div class="card"><b>Link an account first</b><p class="muted small">${esc(error.message)}. Open Biti to link it, then come back and try again.</p><a class="btn app" href="${esc(error.body.link_url)}">Link in Biti</a></div>`;
          }
        });
      },
    };
  },

  async connect(params, query) {
    const next = query.get("next") || "/";
    return {
      html: `${header("Connect Biti", next)}
        <div class="center pad"><span class="big app">B</span><b class="lg">Connect your Biti wallet</b><small class="muted">We send a request to your Biti app. You approve it there and choose one wallet.</small></div>
        <div class="card"><label class="field">Biti phone number<input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+252 61 512 3456"></label><button class="btn app" data-action="connect">Send request</button></div>
        <div data-error></div><div id="connect-state"></div>`,
      mount(root) {
        bindCommon(root);
        bindClick(root, "[data-action=connect]", async () => {
          const request = await api("POST", "/connect", { phone: root.querySelector("#phone").value });
          const state = root.querySelector("#connect-state");
          const deeplink = request.install?.deeplink;
          state.innerHTML = `<div class="card"><b>Open Biti and approve</b><p class="muted small">Waiting for your answer. The request ends in ${Math.round((request.expires_in || 600) / 60)} minutes.</p>${deeplink ? `<a class="btn app" href="${esc(deeplink)}">Open Biti</a>` : ""}<div class="center"><div class="spin sm"></div></div></div>`;
          await pollConnect(request.request_token, state, next);
        });
      },
    };
  },
};

async function pollConnect(token, state, next) {
  for (let attempt = 0; attempt < 200 && location.pathname === "/connect"; attempt += 1) {
    const answer = await api("GET", `/connect/${encodeURIComponent(token)}`);
    if (answer.me?.signed_in) {
      app.me = answer.me;
      toast(`Connected as ${answer.me.user?.full_name || "Biti customer"}`);
      return app.navigate(next);
    }
    if (answer.status && !["pending", "approved"].includes(answer.status)) {
      state.innerHTML = alertBox(`The request is ${answer.status}. Send a new one.`);
      return;
    }
    await sleep(3000);
  }
}

function topupHtml(topup) {
  const steps = topup.instructions || {};
  const how = steps.type === "pay_merchant_code"
    ? `<div class="line"><span class="muted">Pay merchant code</span><span class="mono">${esc(steps.merchant_code)}</span></div>${steps.ussd ? `<div class="line"><span class="muted">Dial</span><a class="mono" href="tel:${esc(steps.ussd).replace(/#/g, "%23")}">${esc(steps.ussd)}</a></div>` : ""}`
    : steps.type === "confirm_on_phone" ? `<p class="muted small">Confirm the payment on your phone when your provider asks.</p>` : "";
  return `<div class="card"><b>Top-up ${esc(topup.topup_id)}</b><div class="line"><span class="muted">Status</span>${statusPill(topup.status)}</div><div class="line"><span class="muted">Amount</span><span>${money(topup.amount, topup.currency)}</span></div>${topup.fee !== undefined ? `<div class="line"><span class="muted">Fee</span><span>${money(topup.fee, topup.currency)}</span></div>` : ""}${how}
    ${topup.error ? alertBox(topup.error) : ""}
    <div class="btns">${topup.topup_link ? `<a class="btn sec" href="${esc(topup.topup_link)}">Open in Biti</a>` : ""}<button class="btn sec" data-action="topup-status">Check status</button></div></div>`;
}

function depositCard(booking) {
  const deposit = booking.deposit;
  if (booking.status !== "confirmed") return "";
  if (!deposit || deposit.status === "expired") {
    return `<div class="card"><b>Room deposit</b><p class="muted small">${money(config.depositAmount)}, held in your wallet and released at checkout.</p><button class="btn sec" data-action="hold">Hold deposit</button></div>`;
  }
  const until = deposit.release_by ? shortDate(String(deposit.release_by).slice(0, 10)) : "checkout";
  const label = {
    pending: `Waiting for your approval in Biti`,
    held: `${money(deposit.amount)} held until ${until}`,
    released: `Deposit released. Nothing was charged.`,
    captured: `${money(deposit.captured_amount)} kept for damage`,
  }[deposit.status] || deposit.status;
  return `<div class="card"><b>Room deposit</b><p><span class="pill ${deposit.status === "held" ? "a" : "n"}">${esc(label)}</span></p>
    ${deposit.status === "pending" ? `<div class="btns"><button class="btn sec" data-action="hold">Approve in Biti</button><button class="btn sec" data-action="hold-status">Check</button></div>` : ""}
    ${deposit.status === "held" ? `<details class="staff"><summary>Hotel staff (demo)</summary><p class="muted small">At checkout the hotel releases the deposit, or keeps part of it.</p><div class="btns"><button class="btn sec" data-action="release">Release</button><button class="btn danger" data-action="capture">Keep $10</button></div></details>` : ""}</div>`;
}

function bookingHtml(booking, webStatus) {
  const head = header(booking.id, "/bookings");
  if (booking.status === "awaiting_payment" || booking.status.startsWith("payment_")) {
    const expired = booking.status !== "awaiting_payment";
    return `${head}<div class="center pad"><span class="big amber">…</span><b class="lg">${expired ? "Payment time ran out" : "Waiting for payment"}</b><small class="muted">${esc(booking.hotel_name)} · ${esc(stayRange(booking.check_in, booking.nights))}</small>
      ${webStatus === "cancelled" ? alertBox("You cancelled the payment in Biti. Nothing was paid.", "info") : ""}</div>
      <div class="card"><div class="line"><span class="muted">Amount</span><span>${money(booking.quote.total)}</span></div><div class="line"><span class="muted">Order</span><span class="mono">${esc(booking.order?.order_id)}</span></div><div class="line"><span class="muted">Biti says</span>${statusPill(booking.order?.status)}</div></div>
      <div data-error></div><button class="btn app" data-action="pay">Pay with Biti</button><button class="btn sec" data-action="refresh">Check again</button>`;
  }
  if (booking.status === "cancelled") {
    const refunded = booking.refund?.refunded_amount ?? booking.quote.total;
    return `${head}<div class="row static"><span class="round g lg">↙</span><span class="tx"><b>Refund from Daryeel Stays</b><small>Booking ${esc(booking.id)} cancelled</small></span><span class="price green">+ ${usd(refunded)}</span></div>
      <p class="muted small center-text">The refund is in your Biti wallet and in History.</p>${depositCard(booking)}<button class="btn sec" data-go="/">Back to hotels</button>`;
  }
  const canCancel = booking.paid_by === "order" && new Date() < new Date(booking.cancel_until);
  return `${head}<div class="center"><span class="big green">✓</span><b class="xl">Booking confirmed</b><small class="muted">${esc(booking.hotel_name)} · ${esc(stayRange(booking.check_in, booking.nights))}</small></div>
    <div class="card"><div class="line"><span class="muted">Paid</span><span>${booking.paid_by === "plan" ? "Stay plan · " : ""}${money(booking.quote.total)}</span></div><div class="line"><span class="muted">Biti ref</span><span class="mono">${esc(booking.transaction_id || "—")}</span></div><div class="line"><span class="muted">Booking</span><span class="mono">${esc(booking.id)}</span></div><div class="line"><span class="muted">Guest</span><span>${esc(booking.guest?.full_name || "—")}</span></div></div>
    ${depositCard(booking)}
    <div data-error></div>
    <div class="btns"><button class="btn sec" data-action="share">Share</button><button class="btn app" data-go="/bookings">My bookings</button></div>
    ${canCancel ? `<div class="card"><b>Cancel booking</b><p class="muted small">Free cancellation until ${esc(new Date(booking.cancel_until).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}. The refund goes back to your Biti wallet.</p><button class="btn danger" data-action="cancel">Cancel and refund</button></div>` : booking.paid_by === "plan" ? `<p class="muted small center-text">Stays paid by the plan are changed by our team. Call us to cancel.</p>` : ""}`;
}

function mountBooking(root, booking) {
  bindCommon(root);
  bindClick(root, "[data-action=refresh]", async () => app.render());
  bindClick(root, "[data-action=pay]", async () => payBooking(await api("POST", `/bookings/${booking.id}/pay`)));
  bindClick(root, "[data-action=share]", async () => {
    const title = `${booking.hotel_name} · ${stayRange(booking.check_in, booking.nights)}`;
    try {
      await sdk("share", { title, path: `/booking/${booking.id}` });
    } catch (error) {
      if (error.code === "cancelled" || error.name === "AbortError") return;
      await navigator.clipboard?.writeText(`${location.origin}/booking/${booking.id}`).catch(() => null);
      toast("Link copied");
    }
  });
  bindClick(root, "[data-action=cancel]", async () => {
    if (!confirm(`Cancel ${booking.id} and refund ${money(booking.quote.total)} to your Biti wallet?`)) return;
    await api("POST", `/bookings/${booking.id}/cancel`);
    toast(`${money(booking.quote.total)} refunded to your wallet`);
    app.render();
  });
  bindClick(root, "[data-action=hold]", async () => {
    const hold = await api("POST", "/deposit", { booking_id: booking.id });
    await sdk("requestHold", { hold_id: hold.hold_id, return_url: `${location.origin}/booking/${booking.id}` });
    const status = await api("GET", `/deposit/${hold.hold_id}`);
    toast(status.status === "held" ? `${money(status.amount)} held` : `Deposit is ${status.status}`);
    app.render();
  });
  bindClick(root, "[data-action=hold-status]", async () => {
    await api("GET", `/deposit/${booking.deposit.hold_id}`);
    app.render();
  });
  bindClick(root, "[data-action=release]", async () => {
    await api("POST", `/deposit/${booking.deposit.hold_id}/release`);
    toast("Deposit released");
    app.render();
  });
  bindClick(root, "[data-action=capture]", async () => {
    await api("POST", `/deposit/${booking.deposit.hold_id}/capture`, { amount: 10 });
    toast("$10 kept, the rest went back");
    app.render();
  });
}

function notFound(message, needsSignIn = false) {
  return {
    html: `${header("Daryeel Stays")}<div class="center pad"><b class="lg">${esc(message)}</b>${needsSignIn ? `<button class="btn app" data-action="signin">${isInBiti() ? "Sign in with Biti" : "Connect your Biti wallet"}</button>` : ""}<button class="btn sec" data-go="/">Back to hotels</button></div><div data-error></div>`,
    mount: bindCommon,
  };
}

function openDatesSheet() {
  const { checkIn, nights } = app.search;
  const today = new Date().toISOString().slice(0, 10);
  openSheet(`<h3>When do you stay?</h3>
    <label class="field">Check-in<input id="d-in" type="date" min="${today}" value="${checkIn}"></label>
    <label class="field">Nights<select id="d-n">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option ${n === nights ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <button class="btn app" id="d-ok">Done</button>`);
  document.getElementById("d-ok").addEventListener("click", () => {
    const value = document.getElementById("d-in").value;
    if (value && value >= today) app.search.checkIn = value;
    app.search.nights = Number(document.getElementById("d-n").value);
    closeSheet();
    app.render();
  });
}

/** Wires actions every screen can have: sign in, sign out, close. Navigation is global. */
function bindCommon(root) {
  bindClick(root, "[data-action=signin]", async () => signIn());
  bindClick(root, "[data-action=logout]", async () => {
    app.me = await api("POST", "/logout");
    app.render();
  });
  bindClick(root, "[data-action=close]", async () => sdk("close"));
}

