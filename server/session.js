const crypto = require("crypto");

const COOKIE = "daryeel_sid";
const sessions = new Map();

/** Every visitor gets a signed, httpOnly session id. The Biti token stays in server memory. */
function sessionMiddleware(req, res, next) {
  let id = req.signedCookies[COOKIE];
  if (!id || !sessions.has(id)) {
    id = crypto.randomBytes(24).toString("hex");
    sessions.set(id, { id, created_at: new Date().toISOString() });
    res.cookie(COOKIE, id, { httpOnly: true, signed: true, sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
  }
  req.session = sessions.get(id);
  next();
}

function signIn(session, { access_token: token, expires_at: expiresAt, scopes, user }, via) {
  Object.assign(session, { token, expires_at: expiresAt, scopes: scopes || [], user: user || {}, via });
}

function signOut(session) {
  for (const key of ["token", "expires_at", "scopes", "user", "via"]) delete session[key];
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
