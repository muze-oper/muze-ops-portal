const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const drive = require('../storage/googleDrive');
const { decryptToken } = require('../auth/tokenCrypto');

// Deliberately a SEPARATE OAuth client identity from GOOGLE_CLIENT_ID/SECRET
// (used for SSO + the admin Drive token + Calendar) — a refresh_token can
// only be exchanged using the exact client_id/secret that originally issued
// it, and these 5 mailbox tokens were issued to muze-email-digest's
// "installed" app, not the portal's own SSO client.
const CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET;

let _cache = null; // { tokens: {account: encryptedBlob}, loadedAt }

async function loadTokens() {
  if (_cache) return _cache;
  const data = await drive.readFile('gmailtokens.json').catch(() => null);
  _cache = data?.tokens || {};
  return _cache;
}

// Returns an authorized gmail v1 client for the given mailbox, or null if no
// token has been migrated for it yet.
async function getGmailClient(account) {
  const tokens = await loadTokens();
  const blob = tokens[account];
  if (!blob) return null;
  const refreshToken = decryptToken(blob, process.env.SESSION_SECRET);
  if (!refreshToken) return null;
  const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET);
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: client });
}

async function listMigratedAccounts() {
  return Object.keys(await loadTokens());
}

module.exports = { getGmailClient, listMigratedAccounts };
