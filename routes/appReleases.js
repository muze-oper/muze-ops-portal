const router = require('express').Router();
const path = require('path');
const { fetchSheetRows, resolveSheetTitleByGid } = require('../storage/googleSheets');

const SHEET_ID = process.env.APP_RELEASES_SHEET_ID;
const SHEET_GID = 0;

// Header names as they appear in the sheet's own row 1 - looked up by name
// (not hardcoded index) so a reordered column doesn't silently break this.
const COL_SUBMIT_DATE = 'Submit Dates';
const COL_RELEASE_DATE = 'Release Dates';
const COL_VERSION = 'Version';
const COL_PLATFORM = 'Platforms';

async function fetchTitleAndRows() {
  const title = await resolveSheetTitleByGid(SHEET_ID, SHEET_GID);
  const rows = await fetchSheetRows(SHEET_ID, `'${title}'!A1:D5000`);
  const header = rows[0] || [];
  const col = {
    submitDate: header.indexOf(COL_SUBMIT_DATE),
    releaseDate: header.indexOf(COL_RELEASE_DATE),
    version: header.indexOf(COL_VERSION),
    platform: header.indexOf(COL_PLATFORM),
  };
  return { title, rows, col };
}

// Sheet dates are "DD.MM.YYYY" strings - parsed to a sortable number
// (YYYYMMDD) so "latest" can be decided by actual date rather than by
// trusting the sheet's row order. Returns -1 for blank/unparseable values so
// they always lose to a real date.
function parseSheetDate(value) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(value || '').trim());
  if (!m) return -1;
  const [, day, month, year] = m;
  return Number(year) * 10000 + Number(month) * 100 + Number(day);
}

// One row is logged per release per platform. "Latest" is decided by Release
// Date first (falling back to Submit Date when a release hasn't happened
// yet), not by row position - the sheet is appended-to in order in practice,
// but nothing enforces that, so trusting dates directly is more robust.
// Platform names aren't normalized in the sheet (e.g. "LG/VIDAA" later became
// "LG/VIDAA/SAMS"), so this reports whatever exact string is on the winning
// row rather than trying to merge historical name variants.
async function loadLatestPerPlatform() {
  const { rows, col } = await fetchTitleAndRows();
  const latest = new Map(); // platform (lowercased) -> {entry, sortKey, rowIndex}

  rows.slice(1).forEach((row, i) => {
    const platform = (row[col.platform] || '').toString().trim();
    if (!platform) return;

    const releaseDate = (row[col.releaseDate] || '').toString().trim();
    const submitDate = (row[col.submitDate] || '').toString().trim();
    const sortKey = Math.max(parseSheetDate(releaseDate), parseSheetDate(submitDate));

    const key = platform.toLowerCase();
    const existing = latest.get(key);
    // Later row wins ties (equal or unparseable dates), same direction the
    // sheet's own append order already goes in.
    if (existing && existing.sortKey > sortKey) return;

    latest.set(key, {
      sortKey,
      rowIndex: i,
      entry: {
        platform,
        version: (row[col.version] || '').toString().trim(),
        releaseDate,
        submitDate,
      },
    });
  });

  return Array.from(latest.values()).map(v => v.entry);
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
