import { api, explain, sdk } from "./client.js";
import { alertBox, app, config, esc, header, isoDate, money, openSheet, statusPill, toast } from "./ui.js";
import { bindClick } from "./views.js";

const GROUPS = [
  ["Connect", ["connect-request", "connect-status", "exchange-login-code", "connected-wallet"]],
  ["Wallet & top-up", ["get-topup-methods", "create-topup", "get-topup-status"]],
  ["Payment requests & orders", ["create-payment-request", "create-order", "get-order-status"]],
  ["Splits", ["release-splits"]],
  ["Bulk send", ["quote-bulk-send", "create-bulk-send", "get-bulk-send-status"]],
  ["Mandates", ["create-mandate", "charge-mandate", "get-mandate-status"]],
  ["Holds", ["create-hold", "capture-hold", "release-hold", "get-hold-status"]],
  ["Refunds", ["refund-order"]],
  ["Payouts & statement", ["get-payout-methods", "create-payout", "get-payout-status", "get-statement"]],
  ["Onboarding", ["onboard-customer", "onboard-verify", "onboard-status"]],
  ["Bills", ["billpay-push-bill", "billpay-cancel-bill", "billpay-bill-status", "billpay-confirm-account"]],
];

function daysFromNow(days) {
  return isoDate(new Date(Date.now() + days * 24 * 3600 * 1000));
}

/** Example request bodies, built when the sheet opens so references stay unique. */
function exampleBody(endpoint) {
  const stamp = Date.now();
  const examples = {
    "connect-request": { phone: "+252610000001", scopes: config.loginScopes.join(",") },
    "connect-status": { request_token: "crq_..." },
    "exchange-login-code": { code: "lc_..." },
    "connected-wallet": {},
    "get-topup-methods": {},
    "create-topup": { method_id: "LA-0001", amount: 1, currency: "USD", reference: `TU-${stamp}` },
    "get-topup-status": { reference: "TU-..." },
    "create-payment-request": { amount: 1, currency: "USD", reference: `PR-${stamp}`, mode: "request", description: "Playground payment request" },
    "create-order": { amount: 1, currency: "USD", reference: `PG-${stamp}`, description: "Playground order" },
    "get-order-status": { order_id: "MPO-..." },
    "release-splits": { order_id: "MPO-...", refs: ["store-A"] },
    "quote-bulk-send": { reference: `BS-${stamp}`, currency: "USD", items: [{ ref: "item-1", method: "biti", number: "610000001@biti", amount: 1 }] },
    "create-bulk-send": { reference: `BS-${stamp}`, currency: "USD", label: "Playground bulk send", items: [{ ref: "item-1", method: "biti", number: "610000001@biti", amount: 1 }] },
    "get-bulk-send-status": { batch_id: "MBS-..." },
    "create-mandate": { max_amount: 50, currency: "USD", period: "month", reference: `MD-${stamp}`, description: "Playground mandate" },
    "charge-mandate": { mandate_id: "MMD-...", amount: 1, reference: `CH-${stamp}` },
    "get-mandate-status": { mandate_id: "MMD-..." },
    "create-hold": { amount: 5, currency: "USD", reference: `DEP-${stamp}`, release_by: `${daysFromNow(3)}T12:00:00`, description: "Playground hold" },
    "capture-hold": { hold_id: "MHD-...", amount: 1 },
    "release-hold": { hold_id: "MHD-..." },
    "get-hold-status": { hold_id: "MHD-..." },
    "refund-order": { order_id: "MPO-...", amount: 1, reason: "Playground refund", reference: `RF-${stamp}` },
    "get-payout-methods": {},
    "create-payout": { to_wallet: "610000001@biti", amount: 1, currency: "USD", reference: `PO-${stamp}`, description: "Playground payout" },
    "get-payout-status": { payout_id: "MPY-..." },
    "get-statement": { from_date: daysFromNow(-7), to_date: daysFromNow(0), format: "json" },
    "onboard-customer": { phone: "+252610000002", reference: "drv-demo", full_name: "Hodan Ali", scopes: ["profile.read", "wallet.read"] },
    "onboard-verify": { onboarding_id: "ONB-...", otp: "000000" },
    "onboard-status": { reference: "drv-demo" },
    "billpay-push-bill": { account_number: "DS-1001", external_id: `INV-${stamp}`, title: "Playground bill", amount: 1, min_amount: 1, due_date: daysFromNow(14) },
    "billpay-cancel-bill": { external_id: "INV-..." },
    "billpay-bill-status": { external_id: "INV-..." },
    "billpay-confirm-account": { account_number: "DS-1001", approved: true },
  };
  return examples[endpoint] ?? {};
}

const BODY_KEY = "daryeel.playground.";

function savedBody(endpoint) {
  try {
    return sessionStorage.getItem(BODY_KEY + endpoint);
  } catch {
    return null;
  }
}

function saveBody(endpoint, text) {
  try {
    sessionStorage.setItem(BODY_KEY + endpoint, text);
  } catch {
    // Storage blocked: the example is used next time.
  }
}

function json(value) {
  return `<pre class="json">${esc(JSON.stringify(value, null, 2))}</pre>`;
}

function answerHtml(answer) {
  const tone = answer.ok ? "g" : "r";
  const label = `${answer.ok ? "OK" : "Failed"} · ${answer.status ?? "—"}${answer.code ? ` · ${answer.code}` : ""}`;
  return `<div class="card"><p class="nomargin"><span class="pill ${tone}">${esc(label)}</span></p>${answer.error ? alertBox(answer.error) : ""}${json(answer.data ?? answer)}</div>`;
}

function devOffNote() {
  return config.devTools ? "" : alertBox("The playground is off on this server. Start it with DEV_TOOLS=1 to use it.", "info");
}

const SDK_ACTIONS = [
  ["getContext", "Where the page runs and who is signed in", () => undefined],
  ["login", `Ask for ${config.loginScopes.join(", ")}`, () => ({ scopes: config.loginScopes })],
  ["requestPayment", "Pay an order", (root) => ({ order_id: root.querySelector("#sdk-order").value.trim(), return_url: `${location.origin}/dev` })],
  ["requestApproval", "Approve a mandate", (root) => ({ mandate_id: root.querySelector("#sdk-mandate").value.trim(), return_url: `${location.origin}/dev` })],
  ["requestHold", "Approve a hold", (root) => ({ hold_id: root.querySelector("#sdk-hold").value.trim(), return_url: `${location.origin}/dev` })],
  ["share", "Share this page", () => ({ title: "Daryeel Stays", path: "/dev" })],
  ["close", "Go back to Biti", () => undefined],
];

const SDK_INPUTS = {
  requestPayment: `<label class="field">Order id<input id="sdk-order" class="mono" placeholder="MPO-..."></label><button class="chip" data-action="test-order">Create a test order</button>`,
  requestApproval: `<label class="field">Mandate id<input id="sdk-mandate" class="mono" placeholder="MMD-..."></label>`,
  requestHold: `<label class="field">Hold id<input id="sdk-hold" class="mono" placeholder="MHD-..."></label>`,
};

function sdkSection() {
  const rows = SDK_ACTIONS.map(([method, hint]) => `${SDK_INPUTS[method] ?? ""}<button class="row" data-sdk="${method}"><span class="tx"><b class="mono">biti.${method}()</b><small>${esc(hint)}</small></span><span class="go">›</span></button>`);
  return `<p class="sec-t">In the Biti app</p><div class="stack">${rows.join("")}</div><div id="sdk-result"></div>`;
}

function mountSdk(root) {
  const result = root.querySelector("#sdk-result");
  SDK_ACTIONS.forEach(([method, , params]) => bindClick(root, `[data-sdk=${method}]`, async () => {
    result.innerHTML = "";
    try {
      const answer = await sdk(method, params(root));
      result.innerHTML = `<div class="card"><b class="mono">biti.${method}()</b>${json(answer ?? null)}</div>`;
    } catch (error) {
      result.innerHTML = `<div class="card"><b class="mono">biti.${method}()</b>${alertBox(explain(error))}${error.code ? `<small class="muted mono">code: ${esc(error.code)}</small>` : ""}</div>`;
    }
  }));
  bindClick(root, "[data-action=test-order]", async () => {
    const answer = await api("POST", "/playground/create-order", { body: exampleBody("create-order") });
    if (!answer.ok) throw new Error(answer.error || `create-order failed (${answer.status})`);
    root.querySelector("#sdk-order").value = answer.data?.order_id ?? "";
    toast(`Order ${answer.data?.order_id} created`);
  });
}

function groupEndpoints(endpoints) {
  const known = new Set(GROUPS.flatMap(([, names]) => names));
  const groups = GROUPS.map(([title, names]) => [title, endpoints.filter((item) => names.includes(item.endpoint))]);
  groups.push(["Other", endpoints.filter((item) => !known.has(item.endpoint))]);
  return groups.filter(([, items]) => items.length);
}

function endpointRow(item) {
  return `<button class="row" data-endpoint="${esc(item.endpoint)}"><span class="tx"><b>${esc(item.method)}</b><small class="mono">${esc(item.endpoint)}</small></span>${item.token ? `<span class="pill n">token</span>` : ""}<span class="go">›</span></button>`;
}

function openEndpointSheet(item) {
  const text = savedBody(item.endpoint) ?? JSON.stringify(exampleBody(item.endpoint), null, 2);
  openSheet(`<h3>${esc(item.method)}</h3>
    <p class="muted small center-text mono">POST /partner/v1/${esc(item.endpoint)}${item.token ? " · with the session token" : ""}</p>
    <label class="field">Body (JSON)<textarea id="pg-body" class="code" rows="9" spellcheck="false">${esc(text)}</textarea></label>
    <div class="btns"><button class="btn sec" id="pg-reset">Example</button><button class="btn app" id="pg-send">Send</button></div>
    <div id="pg-answer"></div>`);
  const box = document.getElementById("pg-body");
  const out = document.getElementById("pg-answer");
  document.getElementById("pg-reset").addEventListener("click", () => {
    box.value = JSON.stringify(exampleBody(item.endpoint), null, 2);
  });
  const send = document.getElementById("pg-send");
  send.addEventListener("click", async () => {
    let body;
    try {
      body = JSON.parse(box.value || "{}");
    } catch (error) {
      out.innerHTML = alertBox(`The body is not valid JSON: ${error.message}`);
      return;
    }
    saveBody(item.endpoint, box.value);
    send.disabled = true;
    out.innerHTML = `<div class="center"><div class="spin sm"></div></div>`;
    try {
      out.innerHTML = answerHtml(await api("POST", `/playground/${encodeURIComponent(item.endpoint)}`, { body }));
    } catch (error) {
      out.innerHTML = alertBox(explain(error));
    } finally {
      send.disabled = false;
    }
  });
}

async function partnerSection() {
  let endpoints;
  try {
    const data = await api("GET", "/playground");
    endpoints = Array.isArray(data) ? data : data.endpoints || [];
  } catch (error) {
    return { html: `<p class="sec-t">Partner API (server)</p>${alertBox(explain(error))}`, endpoints: [] };
  }
  const groups = groupEndpoints(endpoints).map(([title, items]) => `<p class="sec-t">${esc(title)}</p><div class="stack">${items.map(endpointRow).join("")}</div>`);
  return { html: `<p class="sec-t">Partner API (server)</p><p class="muted small">Your server calls Biti with its client secret. Tap an endpoint to send a request.</p>${groups.join("")}`, endpoints };
}

function billRow(bill) {
  const id = bill.id || bill.external_id;
  const paid = bill.paid_amount ? ` · paid ${money(bill.paid_amount)}` : "";
  return `<div class="card"><div class="line"><b>${esc(bill.title)}</b>${statusPill(bill.status)}</div>
    <small class="muted">${esc(id)} · ${esc(bill.account_number)} · ${money(bill.amount)}${bill.min_amount ? ` (min ${money(bill.min_amount)})` : ""}${bill.due_date ? ` · due ${esc(bill.due_date)}` : ""}${paid}</small>
    <div class="btns"><button class="btn sec" data-refresh="${esc(id)}">Refresh status</button><button class="btn danger" data-cancel="${esc(id)}">Cancel</button></div></div>`;
}

function connectRow(request) {
  const account = request.account_number;
  const who = request.customer_name || request.customer?.full_name || request.customer?.phone || request.customer || "";
  return `<div class="card"><b>${esc(account)}</b><small class="muted">${esc(typeof who === "string" ? who : JSON.stringify(who))}${request.requested_at ? ` · ${esc(new Date(request.requested_at).toLocaleString())}` : ""}</small>
    <div class="btns"><button class="btn danger" data-confirm="${esc(account)}" data-approved="0">Refuse</button><button class="btn app" data-confirm="${esc(account)}" data-approved="1">Approve</button></div></div>`;
}

function billForm(accounts) {
  const options = accounts.map((account) => `<option value="${esc(account.account_number)}">${esc(account.account_number)} · ${esc(account.customer_name || "")}</option>`).join("");
  return `<div class="card"><b>Push a bill</b>
    <label class="field">Account<select id="bill-account">${options || `<option>DS-1001</option>`}</select></label>
    <label class="field">Title<input id="bill-title" value="Room invoice"></label>
    <div class="btns"><label class="field grow">Amount<input id="bill-amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="25"></label><label class="field grow">Min amount<input id="bill-min" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Optional"></label></div>
    <label class="field">Due date<input id="bill-due" type="date" value="${daysFromNow(14)}"></label>
    <button class="btn app" data-action="push-bill">Push bill</button></div>`;
}

function readBillForm(root) {
  const body = {
    account_number: root.querySelector("#bill-account").value,
    title: root.querySelector("#bill-title").value.trim(),
    amount: Number(root.querySelector("#bill-amount").value),
  };
  const min = root.querySelector("#bill-min").value;
  const due = root.querySelector("#bill-due").value;
  if (min) body.min_amount = Number(min);
  if (due) body.due_date = due;
  return body;
}

function webhookEntry(event) {
  const key = `hook-${event.id ?? event.received_at}`;
  const tone = event.result === "ignored" ? "" : /error|fail/.test(event.result || "") ? "bad" : "good";
  return `<details class="entry ${tone}" data-key="${esc(key)}"><summary><span class="k">${esc(event.event)}</span> · ${esc(event.result)} <em>${esc(event.id ?? "")} · ${esc(event.received_at ? new Date(event.received_at).toLocaleTimeString() : "")}</em></summary>${json(event.data ?? event)}</details>`;
}

function callEntry(call, index) {
  const failed = call.status >= 400 || call.error;
  return `<details class="entry ${failed ? "bad" : "good"}" data-key="call-${index}-${esc(call.name)}"><summary><span class="k">biti</span> ${esc(call.name)} → ${esc(call.status ?? "network error")}${call.with_token || call.withToken ? " · token" : ""} <em>${esc(call.ms)}ms</em></summary><pre class="json">→ ${esc(JSON.stringify(call.request, null, 2))}</pre><pre class="json">← ${esc(JSON.stringify(call.response ?? call.error, null, 2))}</pre></details>`;
}

async function renderLog(box) {
  const open = new Set([...box.querySelectorAll("details[open]")].map((node) => node.dataset.key));
  let data;
  try {
    data = await api("GET", "/dev/log");
  } catch (error) {
    box.innerHTML = alertBox(explain(error));
    return;
  }
  box.innerHTML = `<p class="sec-t">Webhooks received</p>${(data.webhooks || []).map(webhookEntry).join("") || `<p class="muted small">No webhooks yet.</p>`}
    <p class="sec-t">Server → Biti</p>${(data.server_calls || []).map(callEntry).join("") || `<p class="muted small">No calls yet.</p>`}`;
  box.querySelectorAll("details").forEach((node) => { node.open = open.has(node.dataset.key); });
}

export const devViews = {
  async dev() {
    const partner = await partnerSection();
    return {
      html: `${header("SDK playground")}${devOffNote()}${sdkSection()}${partner.html}`,
      mount(root) {
        mountSdk(root);
        root.querySelectorAll("[data-endpoint]").forEach((node) => node.addEventListener("click", () => {
          openEndpointSheet(partner.endpoints.find((item) => item.endpoint === node.dataset.endpoint));
        }));
      },
    };
  },

  async devBills() {
    let data;
    try {
      data = await api("GET", "/bills");
    } catch (error) {
      return { html: `${header("Bills (biller side)", "/dev")}${alertBox(explain(error))}<button class="btn sec" data-action="reload">Try again</button>`, mount: (root) => bindClick(root, "[data-action=reload]", async () => app.render()) };
    }
    const accounts = data.accounts || [];
    const requests = data.connect_requests || [];
    const bills = data.bills || [];
    return {
      html: `${header("Bills (biller side)", "/dev")}
        <p class="muted small">Daryeel Stays as a Biti bill provider. Customers find these bills in Biti, Bills.</p>
        <p class="sec-t">Demo accounts</p>
        <div class="card">${accounts.map((account) => `<div class="line"><span class="mono">${esc(account.account_number)}</span><span>${esc(account.customer_name || "")}${account.area ? ` · ${esc(account.area)}` : ""}</span></div>`).join("") || `<p class="muted small">No accounts.</p>`}</div>
        ${requests.length ? `<p class="sec-t">Connect requests</p>${requests.map(connectRow).join("")}` : ""}
        <div data-error></div>
        ${billForm(accounts)}
        <p class="sec-t">Bills</p>${bills.map(billRow).join("") || `<p class="muted small">No bills yet. Push one above.</p>`}`,
      mount(root) {
        bindClick(root, "[data-action=push-bill]", async () => {
          const bill = await api("POST", "/bills", readBillForm(root));
          toast(`Bill ${bill.external_id || bill.id || ""} pushed`);
          app.render();
        });
        bindClick(root, "[data-refresh]", async (button) => {
          const bill = await api("GET", `/bills/${encodeURIComponent(button.dataset.refresh)}`);
          toast(`${button.dataset.refresh}: ${bill.status}`);
          app.render();
        });
        bindClick(root, "[data-cancel]", async (button) => {
          if (!confirm(`Cancel bill ${button.dataset.cancel}?`)) return;
          await api("POST", `/bills/${encodeURIComponent(button.dataset.cancel)}/cancel`);
          toast("Bill cancelled");
          app.render();
        });
        bindClick(root, "[data-confirm]", async (button) => {
          const approved = button.dataset.approved === "1";
          await api("POST", `/bills/connect/${encodeURIComponent(button.dataset.confirm)}`, { approved });
          toast(approved ? "Account connected" : "Request refused");
          app.render();
        });
      },
    };
  },

  async devWebhooks() {
    return {
      html: `${header("Webhooks", "/dev")}${devOffNote()}<p class="muted small">Updates every 5 seconds while this page is open.</p><div id="hook-log" class="devlog"><p class="muted small">Loading…</p></div>`,
      mount(root) {
        const box = root.querySelector("#hook-log");
        renderLog(box);
        const timer = setInterval(() => {
          if (location.pathname !== "/dev/webhooks" || !box.isConnected) return clearInterval(timer);
          if (document.visibilityState === "visible") renderLog(box);
        }, 5000);
      },
    };
  },
};
