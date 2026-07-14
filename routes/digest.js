const router = require('express').Router();
const path = require('path');
const drive = require('../storage/googleDrive');

const DIGEST_SECRET = process.env.DIGEST_SECRET;
const LIVE_FILENAME = 'digest_live.json';

function digestFilename(timestamp) {
  return `digest__${timestamp.replace(/[:.]/g, '-')}.json`;
}

// POST /api/digest — no SSO, protected by shared secret
router.post('/api/digest', async (req, res) => {
  const secret = req.headers['x-digest-secret'];
  if (secret !== DIGEST_SECRET) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { title, html, accounts, sentAt } = req.body;
    const timestamp = sentAt || new Date().toISOString();
    await drive.writeFile(digestFilename(timestamp), { title, html, accounts, sentAt: timestamp });
    console.log(`Digest stored: ${title}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Digest store error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/debug — debug (secret protected)
router.get('/api/digest/debug', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET) return res.status(403).end();
  try {
    const files = await drive.listFiles('digest__');
    const first = files[0];
    let contentTest = null;
    if (first) {
      try {
        const data = await drive.readFile(first.name);
        contentTest = { ok: true, keys: Object.keys(data) };
      } catch (e) {
        contentTest = { error: e.message };
      }
    }
    res.json({ fileCount: files.length, first, contentTest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/list — list stored digests
router.get('/api/digest/list', async (req, res) => {
  try {
    const files = (await drive.listFiles('digest__')).slice(0, 48);
    res.json(files.map((f, i) => ({ index: i, pathname: f.name, uploadedAt: f.modifiedTime })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const SHARED_ACCOUNTS = ['support@muze.co.th','support-mea@muze.co.th','support-tvn@muze.co.th','nissan-ma@muze.co.th','ktc@muze.co.th'];

// POST /api/digest/live — store live unread counts + email list (no SSO, secret-protected)
router.post('/api/digest/live', async (req, res) => {
  const secret = req.headers['x-digest-secret'];
  if (secret !== DIGEST_SECRET) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { counts, updatedAt } = req.body;
    await drive.writeFile(LIVE_FILENAME, { counts, updatedAt });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/live — return live unread counts + emails filtered by logged-in user
router.get('/api/digest/live', async (req, res) => {
  try {
    const data = await drive.readFile(LIVE_FILENAME);
    if (!data) return res.json({ counts: {}, updatedAt: null });
    const userEmail = req.user?.email;
    if (userEmail && data.counts) {
      const allowed = new Set([...SHARED_ACCOUNTS, userEmail]);
      const filtered = {};
      for (const [acc, entry] of Object.entries(data.counts)) {
        if (allowed.has(acc) && entry) filtered[acc] = entry;
      }
      data.counts = filtered;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/:index — get digest content by index (filtered by logged-in user)
router.get('/api/digest/:index', async (req, res) => {
  try {
    const files = await drive.listFiles('digest__');
    const file = files[parseInt(req.params.index)];
    if (!file) return res.status(404).json({ error: 'Not found' });

    const data = await drive.readFile(file.name);

    // server-side: only return accounts the requesting user is allowed to see
    const userEmail = req.user?.email;
    if (userEmail && data.emailsByAccount) {
      const allowed = new Set([...SHARED_ACCOUNTS, userEmail]);
      const filtered = {};
      for (const [acc, emails] of Object.entries(data.emailsByAccount)) {
        if (allowed.has(acc)) filtered[acc] = emails;
      }
      data.emailsByAccount = filtered;
      data.accounts = data.accounts.filter(a => allowed.has(a));
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /digest — serve viewer page
router.get('/digest', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'digest.html'));
});

module.exports = router;
