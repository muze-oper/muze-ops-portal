const router = require('express').Router();
const path = require('path');
const { fetchSheetRows, resolveSheetTitleByGid } = require('../storage/googleSheets');

const SHEET_ID = process.env.TVN_SHEET_ID;
// The tab's gid is stable; its name isn't - it was renamed from "BitMovin
// Error Sessions in 24 Hours" to "BitMovin Error" while this was being built,
// with the same gid throughout. TVN_SHEET_RANGE can still override this
// entirely (e.g. to point at a different tab), but by default we resolve the
// current name from the gid on every cache refresh instead of hardcoding it.
const SHEET_GID = 1205219259;
const CACHE_MS = 30 * 60 * 1000;

// Column D onward, matching the sheet's own header row - see
// tvn-dashboard/Code.gs (DEFAULT_PLATFORM_COLUMNS) in the Daily Tasks repo,
// which writes into these same columns.
const PLATFORMS = ['iOS Mobile', 'Android Mobile', 'Apple TV', 'Android TV', 'Tizen', 'LG', 'Vidaa'];

let cache = { data: null, lastUpdated: 0 };

async function resolveRange() {
  if (process.env.TVN_SHEET_RANGE) return process.env.TVN_SHEET_RANGE;
  const title = await resolveSheetTitleByGid(SHEET_ID, SHEET_GID);
  return `'${title}'!A1:K200`;
}

// The sheet packs two different tables into the same columns: rows 2-6 are a
// granular multi-time-per-day log (col A "Action Date" filled in), rows 7+
// are the weekly rollup this page cares about (col A blank, col B has a
// "Mon-3-Aug" style label, one platform column filled in per week). We only
// chart the weekly rollup - the granular rows are a different granularity
// and don't belong on the same trend line.
async function loadData() {
  const range = await resolveRange();
  const rows = await fetchSheetRows(SHEET_ID, range);
  if (rows.length < 2) {
    return { series: {}, platforms: PLATFORMS, lastUpdated: new Date().toISOString() };
  }

  const header = rows[0];
  const platformCol = {};
  PLATFORMS.forEach(name => {
    const idx = header.indexOf(name);
    if (idx !== -1) platformCol[name] = idx;
  });

  const series = {};
  PLATFORMS.forEach(name => { series[name] = []; });

  rows.slice(1).forEach(row => {
    const actionDate = (row[0] || '').toString().trim();
    const dateLabel = (row[1] || '').toString().trim();
    if (actionDate || !dateLabel) return; // skip granular rows and any fully-blank row

    PLATFORMS.forEach(name => {
      const idx = platformCol[name];
      if (idx === undefined) return;
      const raw = row[idx];
      if (raw === undefined || raw === '' || raw === 'N/A') return;
      // values.get's default FORMATTED_VALUE render option returns the
      // display string for percent-formatted cells (e.g. "2.56%"), already
      // scaled - not the underlying 0.0256 fraction, so no *100 here.
      const num = parseFloat(String(raw).replace('%', '').trim());
      if (isNaN(num)) return;
      series[name].push({ date: dateLabel, percent: num });
    });
  });

  return { series, platforms: PLATFORMS, lastUpdated: new Date().toISOString() };
}

router.get('/api/tvn', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  try {
    const forceRefresh = req.query.refresh === '1';
    if (forceRefresh || !cache.data || (Date.now() - cache.lastUpdated) > CACHE_MS) {
      cache.data = await loadData();
      cache.lastUpdated = Date.now();
    }
    res.json(cache.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tvn', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tvn.html'));
});

module.exports = router;
