const { OAuth2Client } = require('google-auth-library');

function client() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
}

function buildAuthUrl(state) {
  return client().generateAuthUrl({
    access_type: 'offline', // need a refresh_token so the Planner "Run" sync works outside the login flow
    prompt: 'consent', // force Google to re-issue a refresh_token every time, not just on first-ever consent
    scope: [
      'openid', 'email', 'profile',
      'https://www.googleapis.com/auth/calendar.readonly', // used only by the Daily Planner's "Run" sync
    ],
    hd: process.env.ALLOWED_DOMAIN, // UI hint only, NOT the security boundary
    state,
  });
}

// Exchanges the OAuth code for an ID token and verifies it server-side
// (signature/audience/issuer via Google's public keys), then enforces the
// org-domain restriction on the verified payload. Never trust a client-side
// redirect or decoded JWT for this check.
async function exchangeCodeForTokens(code) {
  const c = client();
  const { tokens } = await c.getToken(code);
  const ticket = await c.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (payload.hd !== process.env.ALLOWED_DOMAIN || payload.email_verified !== true) {
    throw new Error('domain_not_allowed');
  }
  return { payload, refreshToken: tokens.refresh_token || null };
}

module.exports = { buildAuthUrl, exchangeCodeForTokens };
