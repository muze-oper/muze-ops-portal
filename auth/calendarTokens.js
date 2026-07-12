const { put, list, get: blobGet } = require('@vercel/blob');

// Stores each user's Calendar refresh_token so the Daily Planner's "Run"
// sync can call the Calendar API later, outside of the login request.
function blobPath(email) {
  return `auth/calendar-refresh-tokens/${email}.json`;
}

async function saveRefreshToken(email, refreshToken) {
  await put(blobPath(email), JSON.stringify({ refreshToken }), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
  });
}

async function getRefreshToken(email) {
  const { blobs } = await list({ prefix: blobPath(email) });
  if (!blobs[0]) return null;
  const r = await blobGet(blobs[0].url, { access: 'private' });
  if (r.statusCode !== 200) return null;
  const chunks = [];
  for await (const chunk of r.stream) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return data.refreshToken || null;
}

module.exports = { saveRefreshToken, getRefreshToken };
