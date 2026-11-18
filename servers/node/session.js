const crypto = require("crypto");

const COOKIE = "daryeel_sid";

/** Every visitor gets a signed session id cookie. The Biti token stays in the `session` records. */
function sessionMiddleware({ store, secure }) {
  return (req, res, next) => {
    let id = req.signedCookies[COOKIE];
    let data = id ? store.get("session", id) : null;
    if (!data) {
      id = crypto.randomBytes(24).toString("hex");
      data = store.put("session", id, { id });
      res.cookie(COOKIE, id, { httpOnly: true, signed: true, sameSite: "lax", secure, maxAge: 30 * 24 * 3600 * 1000 });
    }
    req.session = data;
    req.saveSession = () => store.put("session", id, req.session);
    next();
  };
}

function signIn(req, { access_token: token, expires_at: expiresAt, scopes, user }, via) {
  Object.assign(req.session, { token, expires_at: expiresAt, scopes: scopes || [], user: user || {}, via });
  req.saveSession();
}

function signOut(req) {
  for (const key of ["token", "expires_at", "scopes", "user", "via"]) delete req.session[key];
  req.saveSession();
}

function isSignedIn(session) {
  return Boolean(session.token) && (!session.expires_at || new Date(session.expires_at) > new Date());
}

/** The customer key for bookings and plans: the phone Biti returned at sign-in. */
function ownerOf(session) {
  return session.user?.phone || session.user?.full_name || session.id;
}

function requireUser(req, res, next) {
  if (!isSignedIn(req.session)) return res.status(401).json({ error: "Sign in with Biti first", code: "sign_in_required" });
  next();
}

module.exports = { sessionMiddleware, signIn, signOut, isSignedIn, ownerOf, requireUser };
