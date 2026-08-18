const router = require('express').Router();
const path = require('path');
const { fetchSheetRows, listSheetTitles } = require('../storage/googleSheets');

// Read-only - this sheet (the CAB deploy tracker) is edited by hand
// elsewhere, this page only ever displays it, never writes back.
const SHEET_ID = process.env.APP_RELEASES_SHEET_ID;

// The sheet has one tab per report date (e.g. "17 Aug 2026") plus a handful
// of unrelated tabs ("Example 1", "deploy status") that don't use this
// layout at all - those are skipped naturally below since their Topic
// column either doesn't exist or never matches one of these 4 values.
// Matched case-insensitively against the Topic column, exact match (not a
// substring) since the sheet also logs non-platform topics like "Admin
// Portal" or "Membership update flow event purchase".
const PLATFORM_KEYWORDS = ['apple tv', 'android tv', 'ios mobile', 'android mobile'];
const DISPLAY_NAME = {
  'apple tv': 'Apple TV',
  'android tv': 'Android TV',
  'ios mobile': 'iOS Mobile',
  'android mobile': 'Android Mobile',
};

// Header names as they appear in each tab's own row 1 (looked up by name,
// lowercased/trimmed - see loadFromTab for why this can't be a fixed column
// letter like "M").
const COL_TOPIC = 'topic';
const COL_DEPLOY_TAG = 'deploy tag';
const COL_REPORT_DATE = 'report date';
const COL_EXPECTED_DEPLOY_DATE = 'expected deploy date';

const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// "17 Aug 2026" / "07 Aug 2026" / "21 Jul 2026" - this sheet's own date
// style (different from the "DD.MM.YYYY" the old Apps Releases sheet used).
// Returns a sortable YYYYMMDD number, or -1 for blank/unparseable so those
// always lose to a real date.
function parseSheetDate(value) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(String(value || '').trim());
  if (!m) return -1;
  const [, day, monthName, year] = m;
  const month = MONTH_INDEX[monthName.slice(0, 3).toLowerCase()];
  if (month === undefined) return -1;
  return Number(year) * 10000 + (month + 1) * 100 + Number(day);
}

// Reads one tab and returns its matching platform rows. Every tab's header
// is read fresh and columns are found by name rather than a fixed index -
// "Deploy Tag" has actually lived in columns L, M and N at different points
// in this sheet's history (older tabs also carry "Target Repository" /
// "Target Commit Hash" columns the newer ones dropped), so a hardcoded
// "column M" would silently read the wrong field on anything but the
// newest few tabs.
async function loadFromTab(title) {
  const rows = await fetchSheetRows(SHEET_ID, `'${title}'!A1:AH3000`);
  if (rows.length < 2) return [];

  const header = rows[0].map(h => (h || '').toString().trim().toLowerCase());
  const topicIdx = header.indexOf(COL_TOPIC);
  if (topicIdx === -1) return []; // not a deploy-tracker tab (e.g. "deploy status")
  const tagIdx = header.indexOf(COL_DEPLOY_TAG);
  const reportIdx = header.indexOf(COL_REPORT_DATE);
  const expectedIdx = header.indexOf(COL_EXPECTED_DEPLOY_DATE);

  const entries = [];
  rows.slice(1).forEach(row => {
    const topic = (row[topicIdx] || '').toString().trim().toLowerCase();
    if (!PLATFORM_KEYWORDS.includes(topic)) return;

    const reportDate = reportIdx === -1 ? '' : (row[reportIdx] || '').toString().trim();
    const expectedDate = expectedIdx === -1 ? '' : (row[expectedIdx] || '').toString().trim();

    entries.push({
      platform: DISPLAY_NAME[topic],
      version: tagIdx === -1 ? '' : (row[tagIdx] || '').toString().trim(),
      releaseDate: expectedDate,
      submitDate: reportDate,
      // "Latest" is decided by Expected Deploy Date first, falling back to
      // Report Date when a deploy hasn't happened yet - same fallback shape
      // the old sheet's release/submit date logic used.
      sortKey: Math.max(parseSheetDate(expectedDate), parseSheetDate(reportDate)),
    });
  });
  return entries;
}

// Scans every worksheet in the spreadsheet (this sheet gets a new dated tab
// per report cycle, so there's no single "current" tab/gid to read) and
// keeps, per platform, the row with the newest date plus its 2 runners-up as
// `recentVersions` - the Crashlytics page's Step 1 needs "current + the two
// before it" to know which builds are still worth monitoring.
async function loadLatestPerPlatform() {
  const tabs = await listSheetTitles(SHEET_ID);
  const byPlatform = new Map();

  for (const tab of tabs) {
    const entries = await loadFromTab(tab.title);
    entries.forEach(e => {
      if (!byPlatform.has(e.platform)) byPlatform.set(e.platform, []);
      byPlatform.get(e.platform).push(e);
    });
  }

  // Fixed keyword order rather than Map insertion order, so the table's row
  // order doesn't depend on which tab happened to be scanned first.
  return PLATFORM_KEYWORDS
    .map(k => DISPLAY_NAME[k])
    .filter(platform => byPlatform.has(platform))
    .map(platform => {
      // Descending by date; ties keep whichever was scanned first, which is
      // the newest tab since listSheetTitles returns tabs newest-first.
      const sorted = [...byPlatform.get(platform)].sort((a, b) => b.sortKey - a.sortKey);
      const latest = sorted[0];
      return {
        platform: latest.platform,
        version: latest.version,
        releaseDate: latest.releaseDate,
        submitDate: latest.submitDate,
        recentVersions: sorted.slice(0, 3).map(e => e.version).filter(Boolean),
      };
    });
}

router.get('/api/app-releases', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'APP_RELEASES_SHEET_ID is not configured' });
  try {
    const platforms = await loadLatestPerPlatform();
    res.json({ platforms, lastUpdated: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/app-releases', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'app-releases.html'));
});

module.exports = router;
