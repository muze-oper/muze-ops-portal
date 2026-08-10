const router = require('express').Router();
const path = require('path');
const { fetchSheetRows, resolveSheetTitleByGid, updateSheetRow } = require('../storage/googleSheets');

const SHEET_ID = process.env.TVN_SHEET_ID;
// The tab's gid is stable; its name isn't - it was renamed from "BitMovin
// Error Sessions in 24 Hours" to "BitMovin Error" while this was being built,
// with the same gid throughout, so the current title is resolved from the
// gid on every request instead of hardcoding it.
const SHEET_GID = 1205219259;
const CACHE_MS = 30 * 60 * 1000;

// Column D onward, matching the sheet's own header row - see
// tvn-dashboard/Code.gs (DEFAULT_PLATFORM_COLUMNS) in the Daily Tasks repo,
// which writes into these same columns.
const PLATFORMS = ['iOS Mobile', 'Android Mobile', 'Apple TV', 'Android TV', 'Tizen', 'LG', 'Vidaa'];

let cache = { data: null, lastUpdated: 0 };

// Shared by the read path (loadData) and the write path (recordEntries) -
// both need the current title (for building write ranges), the header row
// (to map platform name -> column), and the raw rows.
async function fetchTitleAndRows() {
  const title = await resolveSheetTitleByGid(SHEET_ID, SHEET_GID);
  const rows = await fetchSheetRows(SHEET_ID, `'${title}'!A1:K200`);
  const header = rows[0] || [];
  const platformCol = {};
  PLATFORMS.forEach(name => {
    const idx = header.indexOf(name);
    if (idx !== -1) platformCol[name] = idx;
  });
  return { title, rows, header, platformCol };
}

// 0-based column index -> A1 letter (4 -> 'E')
function colLetter(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const DATE_COL_IDX = 1; // column B

// The sheet packs two different tables into the same columns: rows 2-6 are a
// granular multi-time-per-day log (col A "Action Date" filled in), rows 7+
// are the weekly rollup this page cares about (col A blank, col B has a
// "Mon-3-Aug" style label, one platform column filled in per week). We only
// chart the weekly rollup - the granular rows are a different granularity
// and don't belong on the same trend line.
async function loadData() {
  const { rows, platformCol } = await fetchTitleAndRows();
  if (rows.length < 2) {
    return { series: {}, platforms: PLATFORMS, lastUpdated: new Date().toISOString() };
  }

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

// Same paste-in-lines format as tvn-dashboard/Code.gs's Quick Record tool
// (which this replaces as the primary entry point - that Apps Script is
// still deployable standalone, just no longer linked from the portal).
// Ported here instead of iframing the Apps Script web app, since a
// domain-restricted Apps Script page embedded cross-origin runs into
// third-party-cookie auth issues in an iframe.
router.post('/api/tvn/record', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });

  const { platform, entries } = req.body || {};
  try {
    const { title, rows, platformCol } = await fetchTitleAndRows();
    const platformIdx = platformCol[platform];
    if (platformIdx === undefined) {
      return res.status(400).json({ error: `ไม่รู้จัก platform "${platform}"` });
    }

    // Local copy of (dateLabel -> sheet row number) for the weekly-rollup
    // block only (col A blank), same filter loadData uses. Sheet rows are
    // 1-indexed and rows[0] is the header, so array index i -> sheet row i+1.
    const dateRow = new Map();
    rows.forEach((row, i) => {
      const actionDate = (row[0] || '').toString().trim();
      const dateLabel = (row[DATE_COL_IDX] || '').toString().trim();
      if (i > 0 && !actionDate && dateLabel) dateRow.set(dateLabel.toLowerCase(), i + 1);
    });
    let nextNewRow = rows.length + 1;

    const lines = String(entries || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลให้บันทึก' });
    }

    const platformColLetter = colLetter(platformIdx);
    const dateColLetter = colLetter(DATE_COL_IDX);
    const results = [];

    for (const line of lines) {
      // รองรับคั่นด้วย , หรือ : หรือ tab หรือช่องว่าง 2 ตัวขึ้นไป
      const parts = line.split(/[,:\t]| {2,}/).map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) {
        results.push(`ข้าม "${line}" (อ่านรูปแบบไม่ออก ต้องเป็น "วันที่, ค่า%")`);
        continue;
      }

      const dateLabel = parts[0];
      const numeric = parseFloat(parts[1].replace('%', '').trim());
      if (isNaN(numeric)) {
        results.push(`ข้าม "${dateLabel}" (ค่า "${parts[1]}" ไม่ใช่ตัวเลข)`);
        continue;
      }
      const value = numeric / 100;

      const existingRow = dateRow.get(dateLabel.toLowerCase());
      if (existingRow) {
        await updateSheetRow(SHEET_ID, `'${title}'!${platformColLetter}${existingRow}:${platformColLetter}${existingRow}`, [value]);
        results.push(`${dateLabel}: อัปเดต ${platformColLetter}${existingRow} = ${parts[1]}`);
      } else {
        const newRow = nextNewRow++;
        await updateSheetRow(SHEET_ID, `'${title}'!${dateColLetter}${newRow}:${dateColLetter}${newRow}`, [dateLabel]);
        await updateSheetRow(SHEET_ID, `'${title}'!${platformColLetter}${newRow}:${platformColLetter}${newRow}`, [value]);
        results.push(`${dateLabel}: ไม่เจอแถวเดิม เพิ่มแถวใหม่ที่แถว ${newRow}`);
        dateRow.set(dateLabel.toLowerCase(), newRow);
      }
    }

    cache.data = null; // force the next /api/tvn read to pick up what was just written
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
