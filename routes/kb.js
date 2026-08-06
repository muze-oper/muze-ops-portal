const router = require('express').Router();
const path = require('path');

router.get('/tvs-error-code-kb', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tvs-error-code-kb.html'));
});

module.exports = router;
