require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const requireAuth = require('./auth/requireAuth');
const loginRoutes = require('./routes/login');
const landingRoutes = require('./routes/landing');
const digestRoutes = require('./routes/digest');
const plannerRoutes = require('./routes/planner');
const mtscsRoutes = require('./routes/mtscs');
const nissanMnRoutes = require('./routes/nissanMn');
const ktcChatRoutes = require('./routes/ktcChat');

const app = express();
app.use(cookieParser());

// POST /api/digest and /api/planner — public endpoints (no SSO), each protected
// by their own shared-secret header. Must be before requireAuth and before
// body-consuming middleware used by proxies.
app.use(express.json({ limit: '2mb' }));

// These routes accept EITHER a secret header (scripts) OR a logged-in session
// (the digest.html browser page). Since they're mounted before the real
// requireAuth gate, req.user must be populated here or it will never be set
// for these paths — optionalAuth does that without forcing a redirect.
app.use(requireAuth.optionalAuth);
app.post('/api/digest', digestRoutes);
app.get('/api/digest/debug', digestRoutes);
app.post('/api/digest/live', digestRoutes);
app.get('/api/digest/training-rules', digestRoutes);
app.post('/api/digest/train', digestRoutes);
app.get('/api/digest/holidays', digestRoutes);
app.post('/api/digest/holidays', digestRoutes);
app.get('/api/digest/daily-totals', digestRoutes);
app.post('/api/digest/daily-totals', digestRoutes);
app.post('/api/digest/gmail-tokens', digestRoutes);
app.get('/api/digest/gmail-tokens', digestRoutes);
app.post('/api/planner', plannerRoutes);

// Public routes - must be registered before requireAuth
app.use(loginRoutes);

// Everything below this line requires a valid session
app.use(requireAuth);

app.use(landingRoutes);
app.use(digestRoutes);
app.use(plannerRoutes);
app.use(mtscsRoutes);
app.use(nissanMnRoutes);
app.use(ktcChatRoutes);

module.exports = app;
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`muze-ops-portal running on http://localhost:${port}`));
}
