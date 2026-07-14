const { OAuth2Client } = require('google-auth-library');

// All app data (Digest + Planner) lives in the admin account's hidden Drive
// "App Data Folder" - invisible in their normal Drive UI, scoped per-app by
// Google automatically. One admin refresh_token backs everything, mirroring
// how a single Vercel Blob store used to back everything (just swapped to
// a storage backend that doesn't require a paid plan).
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function getAdminAccessToken() {
  const refreshToken = process.env.DRIVE_ADMIN_REFRESH_TOKEN;
  if (!refreshToken) {
    const err = new Error('DRIVE_ADMIN_REFRESH_TOKEN is not configured');
    err.code = 'NO_ADMIN_DRIVE_TOKEN';
    throw err;
  }
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  return token;
}

function escapeQueryValue(name) {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFile(accessToken, name) {
  const q = encodeURIComponent(`name = '${escapeQueryValue(name)}' and trashed = false`);
  const url = `${DRIVE_API}/files?q=${q}&spaces=appDataFolder&fields=files(id,name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Drive list ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.files && data.files[0]) || null;
}

// Writes (creating or overwriting) a JSON file by exact name.
async function writeFile(name, jsonContent) {
  const accessToken = await getAdminAccessToken();
  const existing = await findFile(accessToken, name);
  const body = JSON.stringify(jsonContent);

  if (existing) {
    const res = await fetch(`${DRIVE_UPLOAD_API}/files/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Drive update ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return existing.id;
  }

  const boundary = `muzeopsportal${Date.now()}`;
  const metadata = JSON.stringify({ name, parents: ['appDataFolder'] });
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n${body}\r\n` +
    `--${boundary}--`;

  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });
  if (!res.ok) throw new Error(`Drive create ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.id;
}

// Reads a JSON file by exact name. Returns null if it doesn't exist.
async function readFile(name) {
  const accessToken = await getAdminAccessToken();
  const existing = await findFile(accessToken, name);
  if (!existing) return null;
  const res = await fetch(`${DRIVE_API}/files/${existing.id}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive read ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Lists files whose name contains the given substring, most-recently
// modified first.
async function listFiles(nameContains) {
  const accessToken = await getAdminAccessToken();
  const q = encodeURIComponent(`name contains '${escapeQueryValue(nameContains)}' and trashed = false`);
  const url = `${DRIVE_API}/files?q=${q}&spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=1000`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Drive list ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const files = data.files || [];
  files.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  return files;
}

module.exports = { writeFile, readFile, listFiles };
