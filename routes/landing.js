const router = require('express').Router();
const path = require('path');

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'landing.html'));
});

router.get('/api/me', (req, res) => {
  res.json({ email: req.user?.email || null });
});

module.exports = router;
