const router = require('express').Router();
const path = require('path');

// Vercel's serverless functions ship neither .git nor a git binary, so these
// dates can't be computed at request time in production - they're baked into
// this file at commit time instead (see scripts/update-card-info.js).
function readCardInfo() {
  delete require.cache[require.resolve('../card-info.json')];
  return require('../card-info.json');
}

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'landing.html'));
});

router.get('/api/me', (req, res) => {
  res.json({ email: req.user?.email || null });
});

router.get('/api/last-updated', (req, res) => {
  const { _portal } = readCardInfo();
  res.json(_portal || { author: null, date: null });
});

router.get('/api/card-info', (req, res) => {
  const { _portal, ...cards } = readCardInfo();
  res.json(cards);
});

module.exports = router;
