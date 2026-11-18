const METHODS = ["getContext", "login", "requestPayment", "requestApproval", "requestHold", "share", "close"];

export const SDK_ERRORS = {
  cancelled: "You closed the Biti sheet. Nothing was paid.",
  timeout: "Biti did not answer in time. Check the booking before you try again.",
  busy: "Biti is showing another sheet. Finish it first.",
  not_in_biti_app: "Open this app inside Biti to sign in this way.",
  missing_biti_origin: "The SDK has no data-biti-origin, so it can't open the Biti web page.",
  not_supported: "This browser can't share. The link was copied instead.",
  invalid_scopes: "This app asked for scopes that are not on its Mini App record.",
};

export function explainBitiError(error) {
  return SDK_ERRORS[error?.code] || SDK_ERRORS[error?.message] || error?.message || "Something went wrong";
}

export function isInBiti() {
  return Boolean(window.biti && window.biti.isInBitiApp());
}

let sdkPromise = null;

/** Loads biti-sdk.js from the Biti server, with data-biti-origin for the web fallback. Resolves null when it fails. */
export function loadBitiSdk({ sdkUrl, bitiOrigin }) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = sdkUrl;
    script.setAttribute("data-biti-origin", bitiOrigin);
    script.onload = () => resolve(window.biti || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** Calls one window.biti method: getContext, login, requestPayment, requestApproval, requestHold, share or close. */
export async function bitiCall(method, params) {
  if (!METHODS.includes(method)) throw new Error(`Unknown Biti SDK method: ${method}`);
  if (!window.biti) throw Object.assign(new Error("The Biti SDK did not load. Check BITI_BASE_URL."), { code: "sdk_missing" });
  return window.biti[method](params);
}
