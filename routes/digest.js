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

function statusKey(account, msgId) {
  return `emailstatus_${account.replace(/@|\./g, '_')}_${msgId}`;
}

// Activity log — who changed what, when. One file per day so reads/writes
// stay small regardless of how much history accumulates.
function logFilename(date) {
  return `activitylog_${date}.json`;
}

async function appendLog(entry) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const file = logFilename(date);
    const existing = await drive.readFile(file).catch(() => null);
    const entries = existing?.entries || [];
    entries.push({ ...entry, at: new Date().toISOString() });
    await drive.writeFile(file, { entries });
  } catch (e) {
    console.error('appendLog failed:', e.message); // never block the actual mutation on log failure
  }
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
//
// Carries forward any 🔴/🟡 email that drops out of the new fetch (read on
// Gmail, aged past maxResults, etc.) as long as its status isn't Done/Ignore
// yet — otherwise an item a user hasn't finished triaging could silently
// vanish from the dashboard just because someone opened it or a day rolled
// over. ⚪ แจ้งเตือนอัตโนมัติ is excluded entirely — automated notifications
// don't need triage, so they should just disappear normally instead of
// piling up. "Ignore" remains the escape valve for the other two categories.
router.post('/api/digest/live', async (req, res) => {
  const secret = req.headers['x-digest-secret'];
  if (secret !== DIGEST_SECRET) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { counts, updatedAt } = req.body;
    const existing = await drive.readFile(LIVE_FILENAME).catch(() => null);

    const merged = {};
    for (const [acc, entry] of Object.entries(counts || {})) {
      if (!entry) { merged[acc] = entry; continue; }
      const newEmails = entry.emails || [];
      const newIds = new Set(newEmails.map(e => e.msgId));
      const oldEmails = existing?.counts?.[acc]?.emails || [];
      const candidates = oldEmails.filter(e =>
        e.msgId && !newIds.has(e.msgId) && e.category !== '⚪ แจ้งเตือนอัตโนมัติ'
      );

      const carried = (await Promise.all(candidates.map(async e => {
        const statusData = await drive.readFile(statusKey(acc, e.msgId)).catch(() => null);
        const status = statusData?.status || 'To Do';
        return (status === 'Done' || status === 'Ignore') ? null : { ...e, carried: true };
      }))).filter(Boolean);

      merged[acc] = { counts: entry.counts, emails: [...newEmails, ...carried] };
    }

    await drive.writeFile(LIVE_FILENAME, { counts: merged, updatedAt });
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
    appendLog({ type: 'train', by: req.user?.email, from, subjectKeyword, category, applyToSimilar: !!applyToSimilar });
    res.json({ ok: true, rule: newRule, totalRules: rules.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/digest/emailstatus — save per-email status, tracking resolution timing:
// inProgressSince is stamped the moment status first leaves "To Do", resolvedAt
// when it reaches "Done". Moving back to "To Do" resets both — a genuine restart,
// not a continuation. Reopening from "Done" to anything else clears resolvedAt
// only, since the item is no longer considered resolved but has been in progress
// the whole time.
router.post('/api/digest/emailstatus', async (req, res) => {
  try {
    const { msgId, account, status } = req.body;
    if (!msgId || !account) return res.status(400).json({ error: 'msgId and account required' });
    const key = statusKey(account, msgId);
    const previous = await drive.readFile(key).catch(() => null);
    const previousStatus = previous?.status || 'To Do';

    let inProgressSince = previous?.inProgressSince || null;
    let resolvedAt = previous?.resolvedAt || null;
    if (status === 'To Do') {
      inProgressSince = null;
      resolvedAt = null;
    } else {
      if (previousStatus === 'To Do' && !inProgressSince) inProgressSince = new Date().toISOString();
      resolvedAt = status === 'Done' ? new Date().toISOString() : null;
    }

    await drive.writeFile(key, {
      msgId, account, status, inProgressSince, resolvedAt,
      updatedAt: new Date().toISOString(), updatedBy: req.user?.email,
    });
    appendLog({ type: 'status', by: req.user?.email, account, msgId, from: previousStatus, to: status });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/emailstatus — get all email statuses (+ resolution timing) for an account
router.get('/api/digest/emailstatus', async (req, res) => {
  try {
    const account = req.query.account;
    if (!account) return res.status(400).json({ error: 'account required' });
    const prefix = `emailstatus_${account.replace(/@|\./g, '_')}_`;
    const files = await drive.listFiles(prefix);
    // One shared access token + read-by-id (listFiles already returns id) —
    // drive.readFile(name) does its OWN token refresh + a redundant name
    // search per call, which measured ~1-2s for an account with a handful of
    // files (mostly token-refresh overhead, not file count).
    const accessToken = await drive.getAdminAccessToken();
    const statuses = await Promise.all(files.map(f => drive.readFileById(f.id, accessToken).catch(() => null)));
    const map = {}, timings = {};
    statuses.filter(Boolean).forEach(s => {
      map[s.msgId] = s.status;
      if (s.inProgressSince || s.resolvedAt) {
        timings[s.msgId] = { inProgressSince: s.inProgressSince || null, resolvedAt: s.resolvedAt || null };
      }
    });
    res.json({ statuses: map, timings });
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
    const previous = await drive.readFile(key).catch(() => null);
    const data = {
      msgId, account, assigneeEmail,
      assigneeName: assignee?.name || assigneeEmail,
      expectedAction, dueDate, status: status || 'To Do',
      emailSubject, emailFrom,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user?.email,
    };
    await drive.writeFile(key, data);
    appendLog({
      type: 'assign', by: req.user?.email, account, msgId,
      from: previous ? { assigneeEmail: previous.assigneeEmail, expectedAction: previous.expectedAction, dueDate: previous.dueDate } : null,
      to: { assigneeEmail, expectedAction, dueDate },
    });

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

// GET /api/digest/activitylog — who changed what, when (last N days, newest first)
router.get('/api/digest/activitylog', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET && !req.user) return res.status(403).end();
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    const dates = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    });
    const files = await Promise.all(dates.map(d => drive.readFile(logFilename(d)).catch(() => null)));
    const entries = files.filter(Boolean).flatMap(f => f.entries || []);
    entries.sort((a, b) => a.at < b.at ? 1 : -1); // newest first
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/assignments — list assignments for an account
router.get('/api/digest/assignments', async (req, res) => {
  try {
    const account = req.query.account || 'nissan-ma@muze.co.th';
    const prefix = `assignment_${account.replace(/@|\./g, '_')}_`;
    const files = await drive.listFiles(prefix);
    // Same fix as emailstatus: one shared token + read-by-id instead of each
    // read doing its own token refresh + redundant name search.
    const accessToken = await drive.getAdminAccessToken();
    const assignments = await Promise.all(files.map(f => drive.readFileById(f.id, accessToken).catch(() => null)));
    res.json({ assignments: assignments.filter(Boolean), assignees: ASSIGNEES, expectedActions: EXPECTED_ACTIONS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/heatmap — daily email counts from snapshots
router.get('/api/digest/heatmap', async (req, res) => {
  try {
    const { from, to } = req.query;
    const daily = {};

    // Cached exact daily totals (see /api/digest/daily-totals) — read these
    // FIRST so the dates they already cover can be excluded before doing any
    // expensive per-snapshot-file work below, not just overridden after the
    // fact. Computing-then-discarding was wasted work on every single
    // request for every already-backfilled date in the window, and was the
    // actual reason this endpoint got slower/more inconsistent over time as
    // more days got backfilled — not the file count itself.
    const cached = await drive.readFile('dailytotals.json').catch(() => null);
    const cachedDates = new Set();
    if (cached?.totals) {
      for (const [date, total] of Object.entries(cached.totals)) {
        if ((!from || date >= from) && (!to || date <= to)) {
          daily[date] = total;
          cachedDates.add(date);
        }
      }
    }

    const files = await drive.listFiles(SNAPSHOT_PREFIX);
    let withDates = files
      .map(f => ({ f, date: (f.name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] })) // digestsnapshot_2026-08-02T...
      .filter(x => x.date);

    // The calendar only ever shows one 6-week grid at a time — restrict to
    // that window (free: filename-only, no Drive call) instead of reading
    // every snapshot ever taken. Falls back to "all" if the caller omits
    // from/to, but the frontend always sends them. Also skip anything the
    // cache above already answered — only un-backfilled dates (normally
    // just today) still need the per-snapshot summing.
    if (from) withDates = withDates.filter(x => x.date >= from);
    if (to) withDates = withDates.filter(x => x.date <= to);
    withDates = withDates.filter(x => !cachedDates.has(x.date));

    // One access token reused across every read, and reads run in bounded
    // parallel batches instead of one-at-a-time — with 300+ snapshot files,
    // sequential drive.readFile() (each doing its OWN token refresh + a
    // name-search lookup before the actual read) took 900+ round trips and
    // reliably timed out the serverless function, leaving the heatmap blank.
    if (withDates.length) {
      const accessToken = await drive.getAdminAccessToken();
      const CONCURRENCY = 20;
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
    }

    const holidayData = await drive.readFile('holidays.json').catch(() => null);
    res.json({ daily, holidays: holidayData?.holidays || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digest/daily-totals — cached exact per-day email totals (secret or logged-in)
router.get('/api/digest/daily-totals', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET && !req.user) return res.status(403).end();
  try {
    const data = await drive.readFile('dailytotals.json').catch(() => null);
    res.json(data || { totals: {} });
  } catch (err) { res.json({ totals: {} }); }
});

// POST /api/digest/daily-totals — merge in newly-computed per-day totals.
// Merges rather than replaces: backfills run incrementally over time (one
// batch of past dates at a time), so a later call must not wipe out totals
// an earlier call already cached.
router.post('/api/digest/daily-totals', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET && !req.user) return res.status(403).end();
  try {
    const { totals } = req.body; // { 'YYYY-MM-DD': number, ... }
    if (!totals || typeof totals !== 'object' || Array.isArray(totals)) {
      return res.status(400).json({ error: 'totals must be an object of date -> number' });
    }
    const existing = await drive.readFile('dailytotals.json').catch(() => null);
    const merged = { ...(existing?.totals || {}), ...totals };
    await drive.writeFile('dailytotals.json', { totals: merged, updatedAt: new Date().toISOString(), updatedBy: req.user?.email });
    res.json({ ok: true, count: Object.keys(merged).length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/digest/holidays — list holidays (secret or logged-in)
router.get('/api/digest/holidays', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET && !req.user) return res.status(403).end();
  try {
    const data = await drive.readFile('holidays.json').catch(() => null);
    res.json(data || { holidays: [] });
  } catch (err) { res.json({ holidays: [] }); }
});

// POST /api/digest/holidays — save holidays list. Each entry is either a
// plain 'MM-DD'/'YYYY-MM-DD' string (legacy — manual entry, no name) or
// {date, name} (the calendar sync, which has real names). Normalized to
// {date, name} on write so every reader gets one consistent shape.
router.post('/api/digest/holidays', async (req, res) => {
  if (req.headers['x-digest-secret'] !== DIGEST_SECRET && !req.user) return res.status(403).end();
  try {
    const { holidays } = req.body;
    if (!Array.isArray(holidays)) return res.status(400).json({ error: 'holidays must be array' });
    const normalized = holidays.map(h => typeof h === 'string' ? { date: h, name: '' } : { date: h.date, name: h.name || '' });
    await drive.writeFile('holidays.json', { holidays: normalized, updatedAt: new Date().toISOString(), updatedBy: req.user?.email });
    res.json({ ok: true, count: normalized.length });
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
