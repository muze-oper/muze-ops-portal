const { readSession } = require('./session');

function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) {
    // fetch() calls expect JSON back - redirecting them to the HTML login
    // page just breaks res.json() on the client with a cryptic parse error.
    // Page navigations (everything else) still get the normal redirect.
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'unauthenticated', message: 'Your session has expired - please log in again.' });
    }
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
