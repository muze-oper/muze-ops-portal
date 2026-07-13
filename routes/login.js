const router = require('express').Router();
const path = require('path');
const { buildAuthUrl, exchangeCodeForTokens } = require('../auth/google');
const { createSessionCookie, clearSessionCookie } = require('../auth/session');
const { saveRefreshToken } = require('../auth/calendarTokens');

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
    createSessionCookie(res, payload);
    if (refreshToken) {
      // Best-effort - a failed save here shouldn't block login, just the
      // Planner's "Run" sync until the next successful one
      saveRefreshToken(payload.email, refreshToken).catch(err =>
        console.error('Failed to save calendar refresh token:', err.message)
      );
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
