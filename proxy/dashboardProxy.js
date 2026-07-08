const router = require('express').Router();
const proxyRequest = require('./proxyRequest');

// No prefix stripping - muze-jira-dashboard's frontend calls root-relative
// paths (/api/dashboard, /api/tickets, ...), not paths nested under /dashboard/.
function forward(req, res) {
  proxyRequest(req, res, {
    targetBase: process.env.DASHBOARD_BASE_URL,
    stripPrefix: '',
    injectQuery: { token: process.env.DASHBOARD_SECRET },
    timeoutMs: 15000,
    // Safe to pass unconditionally: proxyRequest only injects into actual
    // text/html responses, so this has no effect on the /api/* JSON calls
    // that share this same forward() function.
    bannerLabel: 'ITSM Dashboard',
  });
}

router.all('/dashboard', forward);
router.all('/dashboard/*splat', forward);
router.all('/api/*splat', forward);

module.exports = router;
