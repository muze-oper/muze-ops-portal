const jwt = require('jsonwebtoken');
const { encryptToken, decryptToken } = require('./tokenCrypto');

const COOKIE_NAME = 'portal_session';

// Thin wrappers over the shared AES-256-GCM helper (auth/tokenCrypto.js),
// keyed by SESSION_SECRET — kept as named functions here since that's what
// the rest of this file already calls them.
function encryptRefreshToken(token) { return encryptToken(token, process.env.SESSION_SECRET); }
function decryptRefreshToken(blob)  { return decryptToken(blob, process.env.SESSION_SECRET); }

// Stateless signed JWT in an httpOnly cookie - no server-side session store.
// Vercel functions are ephemeral/multi-instance, so an in-memory store would
// silently break across invocations. The Calendar refresh_token (if any)
// rides along encrypted inside the same cookie rather than in external
// storage - it only needs to live as long as the session does, since
// logging back in mints a fresh one anyway.
function createSessionCookie(res, user, refreshToken) {
  const payload = { email: user.email, name: user.name };
  if (refreshToken) payload.rt = encryptRefreshToken(refreshToken);
  const token = jwt.sign(payload, process.env.SESSION_SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    if (payload.rt) payload.refreshToken = decryptRefreshToken(payload.rt);
    return payload;
  } catch {
    return null;
  }
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

module.exports = { createSessionCookie, readSession, clearSessionCookie, COOKIE_NAME };
