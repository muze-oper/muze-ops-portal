const router = require('express').Router();
const proxyRequest = require('./proxyRequest');

function basicAuthHeader() {
  const creds = `${process.env.REPORT_TOOL_BASIC_AUTH_USER}:${process.env.REPORT_TOOL_BASIC_AUTH_PASSWORD}`;
  return `Basic ${Buffer.from(creds).toString('base64')}`;
}

function forward(req, res) {
  proxyRequest(req, res, {
    targetBase: process.env.REPORT_TOOL_BASE_URL,
    stripPrefix: '/report',
    injectHeaders: { Authorization: basicAuthHeader() },
    timeoutMs: 55000,
    bannerLabel: 'Nissan Monthly Report',
  });
}

// The proxied page uses relative asset/form paths (e.g. "export/excel"),
// which the browser resolves against the current URL's directory. Without
// a trailing slash, "/report" has no directory component of its own, so
// relative links would resolve to the gateway root instead of "/report/*".
// Redirect the bare mount point to its trailing-slash form so relative
// resolution works correctly. Checked via req.path (not route matching) -
// Express's default non-strict routing treats "/report" and "/report/" as
// the same route, which would otherwise turn this into a redirect loop.
router.all('/report', (req, res, next) => {
  if (req.path !== '/report' || req.method !== 'GET') return next();
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(302, `/report/${qs}`);
});
router.all('/report/', forward); // index page - *splat below requires >=1 segment, won't match this
router.all('/report/*splat', forward);

module.exports = router;
