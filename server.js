require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const requireAuth = require('./auth/requireAuth');
const reportProxy = require('./proxy/reportProxy');
const dashboardProxy = require('./proxy/dashboardProxy');
const loginRoutes = require('./routes/login');
const landingRoutes = require('./routes/landing');
const digestRoutes = require('./routes/digest');
const plannerRoutes = require('./routes/planner');

const app = express();
app.use(cookieParser());

// POST /api/digest and /api/planner — public endpoints (no SSO), each protected
// by their own shared-secret header. Must be before requireAuth and before
// body-consuming middleware used by proxies.
app.use(express.json({ limit: '2mb' }));
app.post('/api/digest', digestRoutes);
app.get('/api/digest/debug', digestRoutes);
app.post('/api/planner', plannerRoutes);

// Public routes - must be registered before requireAuth
app.use(loginRoutes);

// Everything below this line requires a valid session
app.use(requireAuth);

app.use(landingRoutes);
app.use(digestRoutes);
app.use(plannerRoutes);
app.use(reportProxy);
app.use(dashboardProxy);

module.exports = app;
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`muze-ops-portal running on http://localhost:${port}`));
}
