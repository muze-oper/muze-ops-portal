const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const COOKIE_NAME = 'portal_session';

// Derives a 32-byte AES-256 key from SESSION_SECRET - avoids needing a
// separate secret just to encrypt the Calendar refresh_token riding along
// inside the session JWT.
function encryptionKey() {
  return crypto.createHash('sha256').update(process.env.SESSION_SECRET).digest();
}

function encryptRefreshToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decryptRefreshToken(blob) {
  try {
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

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
