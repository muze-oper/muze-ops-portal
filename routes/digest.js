const router = require('express').Router();
const path = require('path');
const { put, list, get: blobGet } = require('@vercel/blob');

const DIGEST_SECRET = process.env.DIGEST_SECRET;

async function fetchBlob(url) {
  const r = await blobGet(url, { access: 'private' });
  if (r.statusCode !== 200) throw new Error(`Blob fetch ${r.statusCode}`);
  const chunks = [];
  for await (const chunk of r.stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// POST /api/digest — no SSO, protected by shared secret
router.post('/api/digest', async (req, res) => {
  const secret = req.headers['x-digest-secret'];
  if (secret !== DIGEST_SECRET) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { title, html, accounts, sentAt } = req.body;
    const timestamp = sentAt || new Date().toISOString();
    const filename = `digests/${timestamp.replace(/[:.]/g, '-')}.json`;

    const result = await put(filename, JSON.stringify({ title, html, accounts, sentAt: timestamp }), {
      access: 'private',
      contentType: 'application/json',
    });

    console.log(`Digest stored: ${title} → ${result.url}`);
    res.json({ ok: true, url: result.url, pathname: result.pathname });
  } catch (err) {
    console.error('Blob put error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/debug — debug (secret protected)
router.get('/api/digest/debug', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET) return res.status(403).end();
  try {
    const result = await list({ prefix: 'digests/' });
    const first = result.blobs[0];
    let contentTest = null;
    if (first) {
      try {
        const data = await fetchBlob(first.url);
        contentTest = { ok: true, keys: Object.keys(data) };
      } catch (e) {
        contentTest = { error: e.message };
      }
    }
    res.json({ blobCount: result.blobs.length, first, contentTest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/list — list stored digests
router.get('/api/digest/list', async (req, res) => {
  try {
    const { blobs } = await list({ prefix: 'digests/' });
    const sorted = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).slice(0, 48);
    res.json(sorted.map((b, i) => ({ index: i, pathname: b.pathname, uploadedAt: b.uploadedAt })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const SHARED_ACCOUNTS = ['support@muze.co.th','support-mea@muze.co.th','support-tvn@muze.co.th','nissan-ma@muze.co.th','ktc@muze.co.th'];

// GET /api/digest/:index — get digest content by index (filtered by logged-in user)
router.get('/api/digest/:index', async (req, res) => {
  try {
    const { blobs } = await list({ prefix: 'digests/' });
    const sorted = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    const blob = sorted[parseInt(req.params.index)];
    if (!blob) return res.status(404).json({ error: 'Not found' });

    const data = await fetchBlob(blob.url);

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
