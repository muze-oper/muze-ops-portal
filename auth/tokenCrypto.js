const crypto = require('crypto');

// Shared AES-256-GCM helper for any refresh token this app needs to store at
// rest (session.js's Calendar refresh_token riding in the cookie, and now
// the 5 Gmail mailbox refresh tokens in Drive storage) — same derivation,
// one place, so there's a single thing to get right instead of two copies
// drifting apart.
function keyFrom(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptToken(token, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decryptToken(blob, secret) {
  try {
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { encryptToken, decryptToken };
