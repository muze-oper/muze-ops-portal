const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SENDER = 'thiranattada.n@muze.co.th';

async function getAuth() {
  const digestDir = path.join(process.env.HOME || '/root', 'muze-email-digest');
  const credPath  = path.join(digestDir, 'credentials.json');
  const tokenPath = path.join(digestDir, 'tokens', `token_${SENDER.replace('@', '_at_').replace(/\./g, '_')}.json`);

  if (!fs.existsSync(credPath) || !fs.existsSync(tokenPath)) {
    throw new Error('Gmail credentials not available in this environment');
  }

  const credentials = JSON.parse(fs.readFileSync(credPath));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  const token = JSON.parse(fs.readFileSync(tokenPath));
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

function makeRaw({ to, subject, body }) {
  const msg = [
    `From: ${SENDER}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body,
  ].join('\r\n');
  return Buffer.from(msg).toString('base64url');
}

async function sendMail({ to, subject, body }) {
  const auth = await getAuth();
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: makeRaw({ to, subject, body }) },
  });
}

module.exports = { sendMail };
