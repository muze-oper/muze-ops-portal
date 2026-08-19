const router = require('express').Router();
const path = require('path');

// Static reference page - the contact/system map is compiled by hand from the
// nissan-ma mailbox, so there is no API behind it (same shape as kb.js).
router.get('/nissan-contacts', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'nissan-contacts.html'));
});

module.exports = router;
