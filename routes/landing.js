const router = require('express').Router();
const path = require('path');
const drive = require('../storage/googleDrive');
const { bangkokDateParts } = require('../utils/gmailClassify');
const { searchRecentTickets } = require('../services/jiraKtc');

const DIGEST_LIVE_FILENAME = 'digestlivecounts.json';
const ACTION_CATEGORY = '🔴 ต้อง Action';

// Matches routes/digest.js emails' `date` field, e.g. "06Aug26 14:30" -
// built from the same Bangkok-local parts so string comparison works.
function bangkokDayPrefix(date) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const p = bangkokDateParts(date);
  return `${String(p.day).padStart(2, '0')}${months[p.month - 1]}${String(p.year).slice(-2)}`;
}

// Pulls together "what's new/urgent" for the landing page's hot-issues
// summary. Only sources with real per-item dates are included:
// - Email Digest: 🔴 ต้อง Action emails from today/yesterday (Bangkok time)
// - KTC: Jira tickets created in the last 2 days (real Jira API access)
// MTS, Nissan, and TVN are excluded - their data (Google Sheet exports /
// an external Apps Script) has no per-ticket created/updated date field to
// filter by "today/yesterday" with, only a month tag embedded in the ticket
// summary text.
router.get('/api/hot-issues', async (req, res) => {
  const now = new Date();
  const todayPrefix = bangkokDayPrefix(now);
  const yesterdayPrefix = bangkokDayPrefix(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  let digestActionItems = [];
  try {
    const data = await drive.readFile(DIGEST_LIVE_FILENAME);
    for (const [account, entry] of Object.entries(data?.counts || {})) {
      for (const e of entry?.emails || []) {
        if (e.category !== ACTION_CATEGORY) continue;
        const dayPrefix = (e.date || '').slice(0, 7); // "06Aug26"
        if (dayPrefix === todayPrefix || dayPrefix === yesterdayPrefix) {
          digestActionItems.push({ account, subject: e.subject, from: e.from, date: e.date });
        }
      }
    }
  } catch (err) {
    console.error('hot-issues digest fetch failed:', err.message);
  }

  let ktcTickets = [];
  try {
    const issues = await searchRecentTickets(2, 10);
    ktcTickets = issues.map(i => ({
      key: i.key,
      summary: i.fields?.summary || '',
      status: i.fields?.status?.name || '',
      created: i.fields?.created || '',
    }));
  } catch (err) {
    console.error('hot-issues KTC fetch failed:', err.message);
  }

  res.json({
    digestActionItems,
    ktcTickets,
    excludedProjects: ['mtscs', 'nissan-mn', 'tvn'],
  });
});

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

router.get('/assets/muze-logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'assets', 'muze-logo.png'));
});

// Unused by the current landing page (superseded by the design above), left
// in place in case anything still links to the old asset directly.
router.get('/muze-mark-blue.png', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'muze-mark-blue.png'));
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
