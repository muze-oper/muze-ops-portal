const router = require('express').Router();
const path = require('path');
const drive = require('../storage/googleDrive');
const { sendMail } = require('../utils/mailer');

const ASSIGNEES = [
  { name: 'Aum',   email: 'thiranattada.n@muze.co.th' },
  { name: 'Noon',  email: 'waraporn@muze.co.th' },
  { name: 'Beach', email: 'noppasit.k@muze.co.th' },
  { name: 'Aon',   email: 'chartwit.t@muze.co.th' },
  { name: 'Noah',  email: 'jakrapat@muze.co.th' },
];

const EXPECTED_ACTIONS = ['Scope Requirement', 'Setup Meeting', 'Reply Email', 'Handle Ticket', 'Other'];

const DIGEST_SECRET = process.env.DIGEST_SECRET;
const LIVE_FILENAME = 'digestlivecounts.json';
const SNAPSHOT_PREFIX = 'digestsnapshot_';

function digestFilename(timestamp) {
  return `${SNAPSHOT_PREFIX}${timestamp.replace(/[:.]/g, '-')}.json`;
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
    const files = await drive.listFiles(SNAPSHOT_PREFIX);
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
    const files = (await drive.listFiles(SNAPSHOT_PREFIX)).slice(0, 48);
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

// GET /api/digest/training-rules — return classifier training rules (secret-protected for live.js)
router.get('/api/digest/training-rules', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET && !req.user) return res.status(403).end();
  try {
    const data = await drive.readFile('trainingrules.json');
    res.json(data || { rules: [] });
  } catch (err) {
    res.json({ rules: [] });
  }
});

// POST /api/digest/train — save a classifier override rule (auth or secret)
router.post('/api/digest/train', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET && !req.user) return res.status(403).end();
  try {
    const { from, subject, category, applyToSimilar, subjectKeyword: rawKeyword } = req.body;
    if (!from || !category) return res.status(400).json({ error: 'from and category required' });

    // use explicit subjectKeyword if provided, else extract from subject
    let subjectKeyword = rawKeyword || '';
    if (!subjectKeyword) {
      const bracketMatch = subject && subject.match(/\[([^\]]{3,})\]/);
      subjectKeyword = bracketMatch ? bracketMatch[1].replace(/\d{5,}/g, '').trim() : '';
    }

    const existing = await drive.readFile('trainingrules.json').catch(() => null);
    const rules = (existing?.rules || []);

    // upsert: same from + subjectKeyword → overwrite
    const key = r => (r.from || '') + '||' + (r.subjectKeyword || '');
    const newRule = { from, subjectKeyword, category, applyToSimilar: !!applyToSimilar, updatedAt: new Date().toISOString(), updatedBy: req.user?.email };
    const idx = rules.findIndex(r => key(r) === key(newRule));
    if (idx >= 0) rules[idx] = newRule;
    else rules.push(newRule);

    await drive.writeFile('trainingrules.json', { rules });
    res.json({ ok: true, rule: newRule, totalRules: rules.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/digest/emailstatus — save per-email status
router.post('/api/digest/emailstatus', async (req, res) => {
  try {
    const { msgId, account, status } = req.body;
    if (!msgId || !account) return res.status(400).json({ error: 'msgId and account required' });
    const key = `emailstatus_${account.replace(/@|\./g, '_')}_${msgId}`;
    await drive.writeFile(key, { msgId, account, status, updatedAt: new Date().toISOString(), updatedBy: req.user?.email });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/emailstatus — get all email statuses for an account
router.get('/api/digest/emailstatus', async (req, res) => {
  try {
    const account = req.query.account;
    if (!account) return res.status(400).json({ error: 'account required' });
    const prefix = `emailstatus_${account.replace(/@|\./g, '_')}_`;
    const files = await drive.listFiles(prefix);
    const statuses = await Promise.all(files.map(f => drive.readFile(f.name).catch(() => null)));
    const map = {};
    statuses.filter(Boolean).forEach(s => { map[s.msgId] = s.status; });
    res.json({ statuses: map });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/digest/assign — save assignment + send email notification
router.post('/api/digest/assign', async (req, res) => {
  try {
    const { msgId, account, assigneeEmail, expectedAction, dueDate, status, emailSubject, emailFrom } = req.body;
    if (!msgId || !account) return res.status(400).json({ error: 'msgId and account required' });

    const assignee = ASSIGNEES.find(a => a.email === assigneeEmail);
    const key = `assignment_${account.replace(/@|\./g, '_')}_${msgId}`;
    const data = {
      msgId, account, assigneeEmail,
      assigneeName: assignee?.name || assigneeEmail,
      expectedAction, dueDate, status: status || 'To Do',
      emailSubject, emailFrom,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user?.email,
    };
    await drive.writeFile(key, data);

    // send email notification to assignee (non-blocking)
    if (assigneeEmail) {
      const dueTxt = dueDate ? `<b>Due:</b> ${dueDate}<br>` : '';
      const body = `
        <p>สวัสดีค่ะ ${assignee?.name || assigneeEmail},</p>
        <p>มี email ถูก assign ให้คุณจาก <b>${account}</b></p>
        <table style="border-collapse:collapse;margin:12px 0">
          <tr><td style="padding:4px 12px 4px 0;color:#555">จาก</td><td><b>${emailFrom}</b></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">หัวข้อ</td><td><b>${emailSubject}</b></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">Expected Action</td><td><b>${expectedAction}</b></td></tr>
          ${dueDate ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Due Date</td><td><b>${dueDate}</b></td></tr>` : ''}
          <tr><td style="padding:4px 12px 4px 0;color:#555">Status</td><td><b>${data.status}</b></td></tr>
        </table>
        <p>กรุณาดำเนินการตาม action ด้านบนค่ะ</p>
        <p style="color:#888;font-size:12px">— Muze Ops Portal</p>`;
      sendMail({ to: assigneeEmail, subject: `[${account}] ${emailSubject}`, body }).catch(e => console.error('Mail error:', e.message));
    }

    res.json({ ok: true, data });
  } catch (err) {
    console.error('Assign error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/assignments — list assignments for an account
router.get('/api/digest/assignments', async (req, res) => {
  try {
    const account = req.query.account || 'nissan-ma@muze.co.th';
    const prefix = `assignment_${account.replace(/@|\./g, '_')}_`;
    const files = await drive.listFiles(prefix);
    const assignments = await Promise.all(files.map(f => drive.readFile(f.name).catch(() => null)));
    res.json({ assignments: assignments.filter(Boolean), assignees: ASSIGNEES, expectedActions: EXPECTED_ACTIONS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/heatmap — daily email counts from snapshots
router.get('/api/digest/heatmap', async (req, res) => {
  try {
    const files = await drive.listFiles(SNAPSHOT_PREFIX);
    let withDates = files
      .map(f => ({ f, date: (f.name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] })) // digestsnapshot_2026-08-02T...
      .filter(x => x.date);

    // The calendar only ever shows one 6-week grid at a time — restrict to
    // that window (free: filename-only, no Drive call) instead of reading
    // every snapshot ever taken. Falls back to "all" if the caller omits
    // from/to, but the frontend always sends them.
    const { from, to } = req.query;
    if (from) withDates = withDates.filter(x => x.date >= from);
    if (to) withDates = withDates.filter(x => x.date <= to);

    // One access token reused across every read, and reads run in bounded
    // parallel batches instead of one-at-a-time — with 300+ snapshot files,
    // sequential drive.readFile() (each doing its OWN token refresh + a
    // name-search lookup before the actual read) took 900+ round trips and
    // reliably timed out the serverless function, leaving the heatmap blank.
    const accessToken = await drive.getAdminAccessToken();
    const CONCURRENCY = 20;
    const daily = {};
    for (let i = 0; i < withDates.length; i += CONCURRENCY) {
      const batch = withDates.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async ({ f, date }) => {
        try {
          const data = await drive.readFileById(f.id, accessToken);
          let count = 0;
          if (data.emailsByAccount) {
            for (const emails of Object.values(data.emailsByAccount)) count += (emails || []).length;
          } else if (data.accounts) {
            count = data.accounts.length;
          }
          return { date, count };
        } catch {
          return null;
        }
      }));
      results.filter(Boolean).forEach(({ date, count }) => {
        daily[date] = (daily[date] || 0) + count;
      });
    }

    const holidayData = await drive.readFile('holidays.json').catch(() => null);
    res.json({ daily, holidays: holidayData?.holidays || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/holidays — list holidays (secret or logged-in)
router.get('/api/digest/holidays', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET && !req.user) return res.status(403).end();
  try {
    const data = await drive.readFile('holidays.json').catch(() => null);
    res.json(data || { holidays: [] });
  } catch (err) { res.json({ holidays: [] }); }
});

// POST /api/digest/holidays — save holidays list
router.post('/api/digest/holidays', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET && !req.user) return res.status(403).end();
  try {
    const { holidays } = req.body; // array of 'MM-DD' or 'YYYY-MM-DD'
    if (!Array.isArray(holidays)) return res.status(400).json({ error: 'holidays must be array' });
    await drive.writeFile('holidays.json', { holidays, updatedAt: new Date().toISOString(), updatedBy: req.user?.email });
    res.json({ ok: true, count: holidays.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/digest/:index — get digest content by index (filtered by logged-in user)
// MUST stay last: a bare :index param would otherwise shadow every named
// /api/digest/* GET route declared after it (holidays, heatmap, assignments…).
// The RegExp path restricts it to numeric indexes as a second line of defence
// (Express 5 dropped the ':index(\\d+)' inline-regex form, so this must be a RegExp).
router.get(/^\/api\/digest\/(\d+)$/, async (req, res) => {
  try {
    const files = await drive.listFiles(SNAPSHOT_PREFIX);
    const file = files[parseInt(req.params[0])];
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
