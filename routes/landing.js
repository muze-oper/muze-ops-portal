const router = require('express').Router();
const path = require('path');
const drive = require('../storage/googleDrive');
const { searchRecentTickets } = require('../services/jiraKtc');

const DIGEST_LIVE_FILENAME = 'digestlivecounts.json';
const ACTION_CATEGORY = '🔴 ต้อง Action';
const MUSTREAD_CATEGORY = '🟡 ควรรับรู้';
const DIGEST_STATUS_BADGE = {
  [ACTION_CATEGORY]: { label: 'ต้อง Action', tone: 'red' },
  [MUSTREAD_CATEGORY]: { label: 'ควรรับรู้', tone: 'yellow' },
};

// Reformats digest.js's "06Aug26 14:30" into "6 Aug 2026" for display.
function formatDigestDateLabel(dateStr) {
  const m = /^(\d{2})([A-Za-z]{3})(\d{2})/.exec(dateStr || '');
  return m ? `${+m[1]} ${m[2]} 20${m[3]}` : (dateStr || '');
}

function formatKtcDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Jira's real status names, mapped to the Thai badge labels ops actually
// think in. Anything not listed falls back to showing the raw status name -
// no fabricated status, just an unstyled badge.
const JIRA_STATUS_BADGE = {
  'To Do': { label: 'รอตอบ', tone: 'yellow' },
  'Open': { label: 'รอตอบ', tone: 'yellow' },
  'Waiting for support': { label: 'รอตอบ', tone: 'yellow' },
  'In Progress': { label: 'กำลังดำเนินการ', tone: 'blue' },
  'Escalated': { label: 'กำลังดำเนินการ', tone: 'blue' },
};
function jiraStatusBadge(status) {
  return JIRA_STATUS_BADGE[status] || { label: status || '-', tone: 'gray' };
}

function cleanPreview(text, limit = 160) {
  if (!text) return '';
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}

// Groups a digest email's inbox account under the client project it belongs
// to. Accounts that don't clearly match a known project (support@,
// support-mea@) are shown under their own address instead of guessed.
function projectForAccount(account) {
  const a = (account || '').toLowerCase();
  if (a.includes('nissan')) return 'Nissan';
  if (a.includes('tvn')) return 'TVN';
  if (a.includes('ktc')) return 'KTC';
  return account || 'Other';
}

// Turns digest.js's "06Aug26 14:30" into a real, sortable ISO timestamp
// (Bangkok is a fixed UTC+7, no DST) - the display label stays separate.
function digestSortKey(dateStr) {
  const m = /^(\d{2})([A-Za-z]{3})(\d{2}) (\d{2}):(\d{2})$/.exec(dateStr || '');
  if (!m) return '';
  const MONTHS = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  return `20${m[3]}-${MONTHS[m[2]] || '01'}-${m[1]}T${m[4]}:${m[5]}:00+07:00`;
}

// Pulls together "what's new/needs attention" for the landing page's
// hot-issues summary:
// - Email Digest: every 🔴 ต้อง Action / 🟡 ควรรับรู้ email currently on the
//   Live dashboard (same default view/categories as digest.html itself,
//   ⚪ Auto excluded, no date cutoff - a pending item stays until resolved)
// - KTC: still-open Jira tickets created in the last 2 days
// MTS, Nissan, and TVN's OWN ticket sources (Google Sheet exports / an
// external Apps Script, separate from their email accounts above) are
// excluded - no per-ticket created/updated date field to filter by, only a
// month tag embedded in the ticket summary text.
router.get('/api/hot-issues', async (req, res) => {
  const items = [];

  try {
    const data = await drive.readFile(DIGEST_LIVE_FILENAME);
    for (const [account, entry] of Object.entries(data?.counts || {})) {
      for (const e of entry?.emails || []) {
        // Every email the Live dashboard shows by default (🔴 Action + 🟡
        // ควรรับรู้, ⚪ Auto excluded) - no date restriction, so anything
        // still pending/carried-forward on the dashboard shows here too.
        const badge = DIGEST_STATUS_BADGE[e.category];
        if (!badge) continue;
        items.push({
          source: 'digest', key: null, title: e.subject || '(no subject)',
          dateLabel: formatDigestDateLabel(e.date), status: badge,
          meta: account, preview: cleanPreview(e.snippet), replyCount: null,
          project: projectForAccount(account), sortKey: digestSortKey(e.date),
        });
      }
    }
  } catch (err) {
    console.error('hot-issues digest fetch failed:', err.message);
  }

  try {
    const issues = await searchRecentTickets(2, 10);
    for (const i of issues) {
      const f = i.fields || {};
      const comments = (f.comment && f.comment.comments) || [];
      const last = comments[comments.length - 1];
      items.push({
        source: 'ktc', key: i.key, title: f.summary || '',
        dateLabel: formatKtcDate(f.created), status: jiraStatusBadge(f.status?.name),
        meta: f.assignee?.displayName || 'ยังไม่มอบหมาย',
        preview: last ? cleanPreview(last.body) : '', replyCount: comments.length,
        project: 'KTC', sortKey: f.created || '',
      });
    }
  } catch (err) {
    console.error('hot-issues KTC fetch failed:', err.message);
  }

  res.json({ items, excludedProjects: ['mtscs', 'nissan-mn', 'tvn'] });
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
