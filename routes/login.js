const router = require('express').Router();
const path = require('path');
const { buildAuthUrl, exchangeCodeForTokens } = require('../auth/google');
const { createSessionCookie, clearSessionCookie } = require('../auth/session');

router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

router.get('/auth/google', (req, res) => {
  const next = typeof req.query.next === 'string' ? req.query.next : '/';
  res.redirect(buildAuthUrl(encodeURIComponent(next)));
});

router.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect('/login?error=missing_code');

  try {
    const { payload, refreshToken } = await exchangeCodeForTokens(code);
    createSessionCookie(res, payload, refreshToken);
    // TEMPORARY one-time bootstrap: prints the refresh_token to server logs
    // so it can be copied into DRIVE_ADMIN_REFRESH_TOKEN. Remove this block
    // (and BOOTSTRAP_ADMIN_TOKEN) once that's done.
    if (process.env.BOOTSTRAP_ADMIN_TOKEN === '1' && refreshToken) {
      console.log(`BOOTSTRAP_ADMIN_TOKEN for ${payload.email}: ${refreshToken}`);
    }
    const next = state ? decodeURIComponent(state) : '/';
    res.redirect(next.startsWith('/') ? next : '/');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect('/login?error=domain_not_allowed');
  }
});

router.get('/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/login');
});

module.exports = router;
