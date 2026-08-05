const { readSession } = require('./session');

function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  req.user = session;
  next();
}

// Populates req.user from the session cookie when present, but never
// redirects/blocks — for routes mounted before requireAuth (secret-header
// endpoints also called by the logged-in browser, e.g. digest holidays/train).
// Without this, req.user is always undefined on those routes even for a
// fully logged-in browser, since requireAuth never runs for them.
function optionalAuth(req, res, next) {
  const session = readSession(req);
  if (session) req.user = session;
  next();
}

module.exports = requireAuth;
module.exports.optionalAuth = optionalAuth;
