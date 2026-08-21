const router = require('express').Router();
const path = require('path');
const {
  fetchSheetRows, resolveSheetTitleByGid, updateSheetRow, updateSheetGrid,
  insertSheetRows, setCellBackgrounds,
} = require('../storage/googleSheets');
const { readValueFromScreenshot } = require('../lib/anthropicVision');

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
const ACTION_DATE_COL_IDX = 0; // column A - filled in once a weekly row is complete (see below)
const TIME_CHECK_COL_IDX = 2; // column C - same
const LOG_BY_COL_IDX = 10; // column K ("Log by") - tagged "Claude" for anything this tool writes

const WEEKLY_DAYS = 7; // "Today-7 to Today" window shown on /tvn
const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DAY_MS = 24 * 60 * 60 * 1000;

// The automated hourly log (rows 2-6 today, but that block can grow) always
// writes a bare hour number here ("14.00", "18.00", ...). Our own weekly
// rows leave Time Check blank until complete, then get a "HH:MM" timestamp
// (see the completeness check in POST /api/tvn/record below) - never a bare
// hour number. This is what tells the two kinds of rows apart now, NOT
// whether Action Date is blank, since a finished weekly row gets Action
// Date filled in too.
function isGranularTimeCheck(v) {
  return /^\d{1,2}(\.\d{1,2})?$/.test(String(v || '').trim());
}

// Parses a "Mon-3-Aug" style label into a real UTC date, inferring the year
// from whichever of (this year, ±1) lands closest to `reference` - the
// sheet never records a year, and rollups can span a Dec/Jan boundary.
function parseWeeklyLabel(label, reference) {
  const m = /^[A-Za-z]{3}-(\d{1,2})-([A-Za-z]{3})$/.exec(String(label || '').trim());
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTH_INDEX[m[2].toLowerCase()];
  if (month === undefined) return null;

  const year = reference.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month, day));
  const diffDays = (candidate - reference) / DAY_MS;
  if (diffDays > 200) candidate = new Date(Date.UTC(year - 1, month, day));
  else if (diffDays < -200) candidate = new Date(Date.UTC(year + 1, month, day));
  return candidate;
}

// "Today" as a UTC-midnight date, computed from the calendar date in
// Bangkok (where the team is) rather than the server's own timezone.
function todayInBangkok() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
    .reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

function nowInBangkok() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return { date, time };
}

// The sheet packs two different tables into the same columns: the automated
// hourly log (identified by isGranularTimeCheck) and the weekly rollup this
// page cares about (one row per day, one platform column filled per week).
// Only the last WEEKLY_DAYS+1 days ("Today-7 to Today") are returned - older
// rows stay in the sheet but drop off the displayed table.
async function loadData() {
  const { rows, platformCol } = await fetchTitleAndRows();
  if (rows.length < 2) {
    return { series: {}, platforms: PLATFORMS, lastUpdated: new Date().toISOString() };
  }

  const today = todayInBangkok();
  const windowStart = new Date(today.getTime() - WEEKLY_DAYS * DAY_MS);

  const series = {};
  PLATFORMS.forEach(name => { series[name] = []; });

  rows.slice(1).forEach(row => {
    const dateLabel = (row[DATE_COL_IDX] || '').toString().trim();
    const timeCheck = (row[TIME_CHECK_COL_IDX] || '').toString().trim();
    if (!dateLabel || isGranularTimeCheck(timeCheck)) return; // skip the hourly log and any fully-blank row

    const parsed = parseWeeklyLabel(dateLabel, today);
    if (parsed && (parsed < windowStart || parsed > today)) return; // outside the Today-7..Today window

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

// /tvn is now 3 separate pages (BitMovin Error Sessions / BitMovin Top
// Error Codes / Firebase Crashlytics), sharing tvn-shared.css/js - not tabs
// switched by JS. /tvn itself stays the Error Sessions page since that's
// what the landing-page card already links to.
router.get('/tvn', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tvn.html'));
});

// Top Error Codes is now a view inside /tvn rather than its own page - keep
// the old URL working for anyone who bookmarked it.
router.get('/tvn/top-error-codes', (req, res) => {
  res.redirect('/tvn');
});

router.get('/tvn/crashlytics', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tvn-crashlytics.html'));
});

// This app has no express.static mount - every public/ asset needs its own
// route (see the *.html routes above). These two are shared by all 3 /tvn
// pages, so they get routes of their own instead of being inlined 3x.
router.get('/tvn-shared.css', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tvn-shared.css'));
});

router.get('/tvn-shared.js', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tvn-shared.js'));
});

// Reference screenshot for the Crashlytics page's Step 1 (which project +
// filter to select in the Firebase console before reading any values).
router.get('/assets/crashlytics-filter-guide.png', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'assets', 'crashlytics-filter-guide.png'));
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
    // block only, same isGranularTimeCheck filter loadData uses. Sheet rows
    // are 1-indexed and rows[0] is the header, so array index i -> sheet row i+1.
    const dateRow = new Map();
    rows.forEach((row, i) => {
      const dateLabel = (row[DATE_COL_IDX] || '').toString().trim();
      const timeCheck = (row[TIME_CHECK_COL_IDX] || '').toString().trim();
      if (i > 0 && dateLabel && !isGranularTimeCheck(timeCheck)) dateRow.set(dateLabel.toLowerCase(), i + 1);
    });
    let nextNewRow = rows.length + 1;

    const lines = String(entries || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลให้บันทึก' });
    }

    const platformColLetter = colLetter(platformIdx);
    const dateColLetter = colLetter(DATE_COL_IDX);
    const logByColLetter = colLetter(LOG_BY_COL_IDX);
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
      let rowNum;
      if (existingRow) {
        await updateSheetRow(SHEET_ID, `'${title}'!${platformColLetter}${existingRow}:${platformColLetter}${existingRow}`, [value]);
        await updateSheetRow(SHEET_ID, `'${title}'!${logByColLetter}${existingRow}:${logByColLetter}${existingRow}`, ['Claude']);
        results.push(`${dateLabel}: อัปเดต ${platformColLetter}${existingRow} = ${parts[1]}`);
        rowNum = existingRow;
      } else {
        const newRow = nextNewRow++;
        await updateSheetRow(SHEET_ID, `'${title}'!${dateColLetter}${newRow}:${dateColLetter}${newRow}`, [dateLabel]);
        await updateSheetRow(SHEET_ID, `'${title}'!${platformColLetter}${newRow}:${platformColLetter}${newRow}`, [value]);
        await updateSheetRow(SHEET_ID, `'${title}'!${logByColLetter}${newRow}:${logByColLetter}${newRow}`, ['Claude']);
        results.push(`${dateLabel}: ไม่เจอแถวเดิม เพิ่มแถวใหม่ที่แถว ${newRow}`);
        dateRow.set(dateLabel.toLowerCase(), newRow);
        rowNum = newRow;
      }

      // ถ้าทุก platform ในแถวนี้มีค่าครบแล้ว (ใช้ข้อมูลที่ fetch มาตอนต้น request บวกค่าที่
      // เพิ่งเขียนไปด้านบน) ประทับเวลาที่ครบไว้ที่ Action Date + Time Check - ใช้ Time Check
      // แบบมีทวิภาค "HH:MM" เจตนา เพื่อให้ isGranularTimeCheck() ยังแยกแถวนี้ออกจาก log
      // อัตโนมัติได้ถูกต้องต่อไป แม้ Action Date จะไม่ว่างแล้วก็ตาม
      const existingRowData = rows[rowNum - 1] || [];
      const isRowComplete = Object.values(platformCol).every(idx => {
        if (idx === platformIdx) return true; // เพิ่งเขียนค่านี้ไปเมื่อกี้ ถือว่ามีค่าแล้ว
        const v = existingRowData[idx];
        return v !== undefined && v !== '' && v !== 'N/A';
      });
      if (isRowComplete) {
        const { date: nowDate, time: nowTime } = nowInBangkok();
        const actionDateColLetter = colLetter(ACTION_DATE_COL_IDX);
        const timeCheckColLetter = colLetter(TIME_CHECK_COL_IDX);
        await updateSheetRow(SHEET_ID, `'${title}'!${actionDateColLetter}${rowNum}:${actionDateColLetter}${rowNum}`, [nowDate]);
        await updateSheetRow(SHEET_ID, `'${title}'!${timeCheckColLetter}${rowNum}:${timeCheckColLetter}${rowNum}`, [nowTime]);
        results.push(`${dateLabel}: ครบทุก platform แล้ว - ประทับเวลา ${nowDate} ${nowTime}`);
      }
    }

    cache.data = null; // force the next /api/tvn read to pick up what was just written
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- BitMovin Error Sessions, hourly grid tab: a second, separate tab (same
// title "BitMovin Error" as the weekly-rollup one above, but a different
// gid - always resolve/write by gid, never by title, since the titles
// collide). One row per platform: Filters, Platform name, Date label, 24
// hour-of-day columns (Bangkok time, "10.00".."24.00","1.00".."9.00" - a
// full day starting at 10:00, midnight written as "24.00" not "0.00"),
// then a trailing "Average" column that's a sheet formula - never write to
// it. Each sync inserts a new row on top of the platform's existing rows,
// so the tab is a dated history - the newest row per platform is what the
// dashboard shows, and older days stay untouched below it.
const HOURLY_SHEET_GID = 1338052572;
const HOUR_COLUMNS = [
  '10.00', '11.00', '12.00', '13.00', '14.00', '15.00', '16.00', '17.00', '18.00', '19.00', '20.00',
  '21.00', '22.00', '23.00', '24.00', '1.00', '2.00', '3.00', '4.00', '5.00', '6.00', '7.00', '8.00', '9.00',
];
// Marks an hour cell that the sync had no data for, so a blank cell (nothing
// synced yet) reads differently from one the sheet's own formulas or a human
// left empty on purpose.
const NO_SYNC_DATA_COLOR = { red: 0.788, green: 0.855, blue: 0.973 }; // #c9daf8
const HOURLY_FILTERS_COL_IDX = 0; // column A
const HOURLY_PLATFORM_COL_IDX = 1; // column B
const HOURLY_DATE_COL_IDX = 2; // column C
const HOURLY_FIRST_HOUR_COL_IDX = 3; // column D - HOUR_COLUMNS[0] ("10.00")
// column D+23 = AA is the last hour column, then three trailing formula
// columns - all read-only from here, never written back:
const HOURLY_AVERAGE_COL_IDX = 27; // column AB
const HOURLY_PEAK_COL_IDX = 28; // column AC
const HOURLY_PEAK_TIME_COL_IDX = 29; // column AD

async function fetchHourlyTitleAndRows() {
  const title = await resolveSheetTitleByGid(SHEET_ID, HOURLY_SHEET_GID);
  const rows = await fetchSheetRows(SHEET_ID, `'${title}'!A1:AD2000`);
  return { title, rows };
}

// "Thu-13-Aug" - same weekday-day-month label style used elsewhere in this
// sheet, computed from the Bangkok calendar date (not the server's own TZ).
function formatBangkokWeekdayLabel() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short' })
    .formatToParts(new Date())
    .reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.weekday}-${parts.day}-${parts.month}`;
}

router.get('/api/tvn/error-sessions-hourly', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  try {
    const { rows } = await fetchHourlyTitleAndRows();
    const platforms = rows
      .slice(1)
      .map(row => {
        const values = {};
        HOUR_COLUMNS.forEach((label, i) => { values[label] = row[HOURLY_FIRST_HOUR_COL_IDX + i] || ''; });
        return {
          platform: row[HOURLY_PLATFORM_COL_IDX] || '',
          filters: row[HOURLY_FILTERS_COL_IDX] || '',
          date: row[HOURLY_DATE_COL_IDX] || '',
          average: row[HOURLY_AVERAGE_COL_IDX] || '',
          peak: row[HOURLY_PEAK_COL_IDX] || '',
          peakTime: row[HOURLY_PEAK_TIME_COL_IDX] || '',
          values,
        };
      })
      .filter(p => p.platform);

    // Rows are newest-first within each platform (sync inserts on top), so
    // the first one seen wins - the heatmap shows one row per platform and
    // must stay scroll-free however much history piles up below. Every row
    // still goes out as `history`, which is what the cumulative summary
    // needs to look back across days.
    const latest = [];
    const seen = new Set();
    platforms.forEach(p => {
      const key = p.platform.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      latest.push(p);
    });
    res.json({ platforms: latest, history: platforms, hourColumns: HOUR_COLUMNS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Overwrites only the hours present in `values` for one platform's row,
// merging with (not replacing) whatever's already in the other hour cells -
// a partial-day CSV export shouldn't blank out hours it doesn't cover.
// `dateLabel` should be the earliest Bangkok-time date actually present in
// the imported file (computed client-side from the CSV's own timestamps),
// not "today" - the file's data usually spans a UTC day boundary, so
// "today" at sync time is often one day ahead of what the data represents.
// Falls back to today only if the caller doesn't supply one. Never touches
// the "Average" formula column.
router.post('/api/tvn/error-sessions-hourly/record', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  const { platform, values, dateLabel } = req.body || {};
  try {
    const { title, rows } = await fetchHourlyTitleAndRows();
    const rowIdx = rows.findIndex(
      (row, i) => i > 0 && (row[HOURLY_PLATFORM_COL_IDX] || '').trim().toLowerCase() === String(platform || '').trim().toLowerCase()
    );
    if (rowIdx === -1) {
      return res.status(400).json({ error: `ไม่รู้จัก platform "${platform}" ในแท็บ hourly` });
    }

    const topRow = rows[rowIdx] || [];
    const rowNum = rowIdx + 1;
    const date = String(dateLabel || '').trim() || formatBangkokWeekdayLabel();

    // Every sync pushes the platform's existing rows down and takes the freed
    // top row. No case updates a row in place - re-syncing a date it already
    // has leaves both attempts in the sheet, newest on top, rather than
    // rewriting the earlier one.
    await insertSheetRows(SHEET_ID, HOURLY_SHEET_GID, rowNum, 1, [HOURLY_AVERAGE_COL_IDX, HOURLY_PEAK_TIME_COL_IDX + 1]);

    // The row is brand new, so hours the CSV didn't cover stay blank - there
    // is no previous value on this row to preserve. Built by walking
    // HOUR_COLUMNS and looking each one up in `values`, not the other way
    // around - any key in `values` that isn't exactly one of these 24 hour
    // labels (a typo, a stale format, a client-side bug) is never read and
    // so never written anywhere: it's flushed rather than risking a write to
    // the wrong column.
    let updatedCount = 0;
    const merged = HOUR_COLUMNS.map(label => {
      const provided = values ? values[label] : undefined;
      if (provided !== undefined && provided !== '') {
        updatedCount++;
        return String(provided);
      }
      return '';
    });

    const filtersColLetter = colLetter(HOURLY_FILTERS_COL_IDX);
    const dateColLetter = colLetter(HOURLY_DATE_COL_IDX);
    const firstColLetter = colLetter(HOURLY_FIRST_HOUR_COL_IDX);
    const lastColLetter = colLetter(HOURLY_FIRST_HOUR_COL_IDX + HOUR_COLUMNS.length - 1);
    // Filters and Platform are copied from the row that got pushed down -
    // they're what keeps the new row part of this platform's run, which is
    // how the next sync finds where to insert.
    await updateSheetRow(SHEET_ID, `'${title}'!${filtersColLetter}${rowNum}:${dateColLetter}${rowNum}`, [
      topRow[HOURLY_FILTERS_COL_IDX] || '',
      topRow[HOURLY_PLATFORM_COL_IDX] || '',
      date,
    ]);
    await updateSheetRow(SHEET_ID, `'${title}'!${firstColLetter}${rowNum}:${lastColLetter}${rowNum}`, merged);

    // The inserted row starts out blank, but insertSheetRows pulls its cell
    // formatting from the platform's previous top row (now pushed down one
    // row) - which may itself be colored blue from an earlier sync's gaps.
    // Every hour cell is set explicitly here, not just the blank ones, so
    // none of that stale color survives onto an hour this sync did fill.
    const rowIndex0 = rowNum - 1;
    await setCellBackgrounds(SHEET_ID, HOURLY_SHEET_GID, merged.map((v, i) => ({
      row: rowIndex0,
      col: HOURLY_FIRST_HOUR_COL_IDX + i,
      color: v ? null : NO_SYNC_DATA_COLOR,
    })));

    // Row 1 is never touched by a sync: the sheet's own "Peak Time" formula
    // is `=INDEX($D$1:$Y$1, MATCH(MAX(...), ..., 0))` - it reads the hour
    // label straight out of this row, so anything beyond the bare "10.00"
    // style label (a D/D+1 prefix, a date, a newline) corrupts every
    // platform's Peak Time into that same garbled text. The D/D+1 grouping
    // shown on the Dashboard is rendered client-side from this route's own
    // `hourColumns` list, not from row 1's cell contents, so it doesn't need
    // row 1 to hold anything beyond the plain hour labels it started with.

    res.json({ result: `${platform}: แทรกแถวใหม่ ${date} ที่แถว ${rowNum} (ของเดิมเลื่อนลง) — ${updatedCount} ช่วงเวลา` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- BitMovin Top Error Codes tab: laid out as one fixed block of rows per
// platform, with Filters (A) and Platform (B) already filled in by hand. This
// only ever writes Date/Player Version/Error Code/Approx Session (C-F) into an
// existing block; it never adds rows or touches A/B.
const TOP_ERROR_CODES_SHEET_GID = 1613893186;
const TEC_FILTERS_COL_IDX = 0; // column A
const TEC_PLATFORM_COL_IDX = 1; // column B
const TEC_DATE_COL_IDX = 2; // column C - first of the four written columns (C:F)
const TEC_WRITE_COLS = 4; // Date, Player Version, Error Code, Approx Session

async function fetchTopErrorCodesTitleAndRows() {
  const title = await resolveSheetTitleByGid(SHEET_ID, TOP_ERROR_CODES_SHEET_GID);
  const rows = await fetchSheetRows(SHEET_ID, `'${title}'!A1:F5000`);
  return { title, rows };
}

// Derives each platform's row span from the sheet's own Platform column
// rather than hardcoding row numbers, so re-sizing a block in the sheet (or
// adding a platform) needs no code change here. Blocks are runs of
// consecutive rows carrying the same platform name.
function groupTopErrorCodeBlocks(rows) {
  const blocks = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const platform = (row[TEC_PLATFORM_COL_IDX] || '').trim();
    if (!platform) continue;
    const rowNum = i + 1; // sheet rows are 1-based and row 1 is the header
    const last = blocks[blocks.length - 1];
    if (last && last.platform === platform && last.endRow === rowNum - 1) {
      last.endRow = rowNum;
      last.entries.push(readTopErrorCodeEntry(row));
    } else {
      blocks.push({
        platform,
        filters: (row[TEC_FILTERS_COL_IDX] || '').trim(),
        startRow: rowNum,
        endRow: rowNum,
        entries: [readTopErrorCodeEntry(row)],
      });
    }
  }
  return blocks;
}

function readTopErrorCodeEntry(row) {
  return {
    date: row[TEC_DATE_COL_IDX] || '',
    playerVersion: row[TEC_DATE_COL_IDX + 1] || '',
    errorCode: row[TEC_DATE_COL_IDX + 2] || '',
    approxSession: row[TEC_DATE_COL_IDX + 3] || '',
  };
}

router.get('/api/tvn/top-error-codes', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  try {
    const { rows } = await fetchTopErrorCodesTitleAndRows();
    res.json({ blocks: groupTopErrorCodeBlocks(rows) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Inserts the new snapshot at the top of the platform's block and pushes the
// existing rows down. Nothing already in the sheet is ever rewritten or
// removed, including a re-sync of a date the block already holds - both
// attempts stay, newest first.
const TEC_MAX_ROWS_PER_SYNC = 50;

router.post('/api/tvn/top-error-codes/record', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  const { platform, entries, dateLabel } = req.body || {};
  try {
    const { title, rows } = await fetchTopErrorCodesTitleAndRows();
    const wanted = String(platform || '').trim().toLowerCase();
    const block = groupTopErrorCodeBlocks(rows).find(b => b.platform.toLowerCase() === wanted);
    if (!block) {
      return res.status(400).json({ error: `ไม่รู้จัก platform "${platform}" ในแท็บ Top Error Codes` });
    }

    const list = (Array.isArray(entries) ? entries : []).filter(
      e => e && (String(e.playerVersion || '').trim() || String(e.errorCode || '').trim() || String(e.approxSession || '').trim())
    );
    if (!list.length) {
      return res.status(400).json({ error: `${platform}: ไม่มีข้อมูลให้บันทึก` });
    }
    if (list.length > TEC_MAX_ROWS_PER_SYNC) {
      return res.status(400).json({ error: `${platform}: รับได้สูงสุด ${TEC_MAX_ROWS_PER_SYNC} แถวต่อครั้ง (ส่งมา ${list.length})` });
    }

    const date = String(dateLabel || '').trim() || formatBangkokWeekdayLabel();

    await insertSheetRows(SHEET_ID, TOP_ERROR_CODES_SHEET_GID, block.startRow, list.length);

    // Filters and Platform go on every row - they're what groups the rows
    // into a block, so a row missing them would split the platform's run.
    const grid = list.map(e => [
      block.filters,
      block.platform,
      date,
      String(e.playerVersion || '').trim(),
      String(e.errorCode || '').trim(),
      String(e.approxSession || '').trim(),
    ]);
    const lastCol = colLetter(TEC_DATE_COL_IDX + TEC_WRITE_COLS - 1);
    const endRow = block.startRow + list.length - 1;
    await updateSheetGrid(SHEET_ID, `'${title}'!A${block.startRow}:${lastCol}${endRow}`, grid);

    res.json({ result: `${platform}: แทรก ${list.length} error code วันที่ ${date} ที่แถว ${block.startRow}-${endRow} (ของเดิมเลื่อนลง)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Firebase Crashlytics "Crashlytics Issue Log" tab: Top Issues list,
// grouped exactly like the BitMovin Top Error Codes tab above - one block
// of consecutive rows per platform, this only ever inserts new rows at the
// top of a block (newest snapshot first), never rewrites/removes what's
// already there. Column order/count has already drifted twice (originally
// Filters/Platform/Date Check/Issue/Versions/Trends/Events/Users; then
// Trends dropped and Date Check/Platform moved to the front; now a new
// "ช่วงเวลาที่ตรวจสอบ" column has been inserted after the date), so
// columns are read by their own fixed index here rather than assumed from
// Firebase's UI order - re-check against the live sheet before trusting
// this if it looks stale.
const CRASHLYTICS_ERR_SHEET_GID = 570219984;
const CRASHLYTICS_ERR_DATE_COL_IDX = 0; // column A - "วันที่ตรวจ"
const CRASHLYTICS_ERR_PERIOD_COL_IDX = 1; // column B - "ช่วงเวลาที่ตรวจสอบ"
const CRASHLYTICS_ERR_PLATFORM_COL_IDX = 2; // column C
const CRASHLYTICS_ERR_FILTERS_COL_IDX = 3; // column D
const CRASHLYTICS_ERR_ISSUE_COL_IDX = 4; // column E - first of the four written data columns (E:H)
const CRASHLYTICS_ERR_WRITE_COLS = 4; // Issue, Versions, Events, Users

async function fetchCrashlyticsErrorsTitleAndRows() {
  const title = await resolveSheetTitleByGid(SHEET_ID, CRASHLYTICS_ERR_SHEET_GID);
  const rows = await fetchSheetRows(SHEET_ID, `'${title}'!A1:H5000`);
  return { title, rows };
}

function readCrashlyticsErrorEntry(row) {
  return {
    date: row[CRASHLYTICS_ERR_DATE_COL_IDX] || '',
    period: row[CRASHLYTICS_ERR_PERIOD_COL_IDX] || '',
    issue: row[CRASHLYTICS_ERR_ISSUE_COL_IDX] || '',
    versions: row[CRASHLYTICS_ERR_ISSUE_COL_IDX + 1] || '',
    events: row[CRASHLYTICS_ERR_ISSUE_COL_IDX + 2] || '',
    users: row[CRASHLYTICS_ERR_ISSUE_COL_IDX + 3] || '',
  };
}

function groupCrashlyticsErrorBlocks(rows) {
  const blocks = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const platform = (row[CRASHLYTICS_ERR_PLATFORM_COL_IDX] || '').trim();
    if (!platform) continue;
    const rowNum = i + 1; // sheet rows are 1-based and row 1 is the header
    const last = blocks[blocks.length - 1];
    if (last && last.platform === platform && last.endRow === rowNum - 1) {
      last.endRow = rowNum;
      last.entries.push(readCrashlyticsErrorEntry(row));
    } else {
      blocks.push({
        platform,
        filters: (row[CRASHLYTICS_ERR_FILTERS_COL_IDX] || '').trim(),
        startRow: rowNum,
        endRow: rowNum,
        entries: [readCrashlyticsErrorEntry(row)],
      });
    }
  }
  return blocks;
}

router.get('/api/tvn/crashlytics-errors', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  try {
    const { rows } = await fetchCrashlyticsErrorsTitleAndRows();
    res.json({ blocks: groupCrashlyticsErrorBlocks(rows) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const CRASHLYTICS_ERR_MAX_ROWS_PER_SYNC = 50;

router.post('/api/tvn/crashlytics-errors/record', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  const { platform, entries, dateLabel, filter } = req.body || {};
  try {
    const platformName = String(platform || '').trim();
    if (!platformName) {
      return res.status(400).json({ error: 'ไม่ได้ระบุ platform' });
    }
    const { title, rows } = await fetchCrashlyticsErrorsTitleAndRows();
    let block = groupCrashlyticsErrorBlocks(rows).find(b => b.platform.toLowerCase() === platformName.toLowerCase());
    if (!block) {
      // Same fallback as the Crash-free % record endpoint - the app's own
      // platform list is fixed independent of whichever blocks currently
      // exist in the sheet, so a missing platform gets a fresh block
      // appended at the bottom instead of failing outright.
      const newRow = rows.length + 1;
      block = { platform: platformName, filters: '', startRow: newRow, endRow: newRow, entries: [] };
    }

    const list = (Array.isArray(entries) ? entries : []).filter(e => e && String(e.issue || '').trim());
    if (!list.length) {
      return res.status(400).json({ error: `${platformName}: ไม่มีข้อมูลให้บันทึก` });
    }
    if (list.length > CRASHLYTICS_ERR_MAX_ROWS_PER_SYNC) {
      return res.status(400).json({ error: `${platformName}: รับได้สูงสุด ${CRASHLYTICS_ERR_MAX_ROWS_PER_SYNC} แถวต่อครั้ง (ส่งมา ${list.length})` });
    }

    const defaultDate = String(dateLabel || '').trim() || formatBangkokWeekdayLabel();
    const defaultFilters = filter || block.filters || '';

    await insertSheetRows(SHEET_ID, CRASHLYTICS_ERR_SHEET_GID, block.startRow, list.length);

    // Each row writes its own Date/Period/Platform/Filters if the table
    // carried one (the paste format includes all 8 sheet columns, editable
    // before sync - what's in the table is what gets written), falling
    // back to the batch-level default only when a row left one blank.
    // Platform is what groups the rows into a block, so a row missing it
    // falls back to the block's own platform rather than staying empty.
    const grid = list.map(e => [
      String(e.date || '').trim() || defaultDate,
      String(e.period || '').trim(),
      String(e.platform || '').trim() || block.platform,
      String(e.filters || '').trim() || defaultFilters,
      String(e.issue || '').trim(),
      String(e.versions || '').trim(),
      String(e.events || '').trim(),
      String(e.users || '').trim(),
    ]);
    const lastCol = colLetter(CRASHLYTICS_ERR_ISSUE_COL_IDX + CRASHLYTICS_ERR_WRITE_COLS - 1);
    const endRow = block.startRow + list.length - 1;
    await updateSheetGrid(SHEET_ID, `'${title}'!A${block.startRow}:${lastCol}${endRow}`, grid);

    res.json({ result: `${block.platform}: แทรก ${list.length} issue ที่แถว ${block.startRow}-${endRow} (ของเดิมเลื่อนลง)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Firebase Crashlytics tab ("Crashlytics Crash Free User", gid 0).
// Restructured by hand on 2026-08-21: it used to be one row per reading
// (Sync Date | Filters | Platform | Date Monitor | % Crash Free Users), it is
// now one row per monitored DAY with a Crash-free % column per checkpoint
// hour:
//   A Sync Date | B Platform | C Filter (Versions) | D Date Monitor | E.. hours
// Two things changed at once - Platform/Filter swapped columns, and the
// single value column became many - so any code still assuming the old A-E
// layout is stale. The hour labels are read from the header row instead of
// being hardcoded, so adding or removing a checkpoint column in the sheet
// needs no change here.
const CRASHLYTICS_SHEET_GID = 0;
const CR_SYNC_DATE_COL_IDX = 0;      // column A - the calendar date the sync ran
const CR_PLATFORM_COL_IDX = 1;       // column B
const CR_FILTER_COL_IDX = 2;         // column C - versions being monitored
const CR_DATE_MONITOR_COL_IDX = 3;   // column D - the day the readings are about
const CR_FIRST_HOUR_COL_IDX = 4;     // column E onward - one per checkpoint hour
const CR_FIRST_DATA_ROW = 2;         // row 1 is the header; new days are inserted here, on top

// "17-Aug-26" style, matching the existing cells in this tab (different from
// BitMovin Error's "Mon-3-Aug" and the CAB tracker's "17 Aug 2026").
function formatBangkokShortDate() {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit' }).format(now);
  const month = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', month: 'short' }).format(now);
  const year = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: '2-digit' }).format(now);
  return `${day}-${month}-${year}`;
}

async function fetchCrashlyticsTitleAndRows() {
  const title = await resolveSheetTitleByGid(SHEET_ID, CRASHLYTICS_SHEET_GID);
  const rows = await fetchSheetRows(SHEET_ID, `'${title}'!A1:Z2000`);
  return { title, rows };
}

// The checkpoint hours, straight off the header row ("9.00", "12.00", ...
// "3.00", "6.00", "8.00" - the tail of that list belongs to the following
// morning, same D/D+1 convention the BitMovin hourly heatmap uses).
function crashlyticsHours(rows) {
  const header = (rows[0] || []).slice(CR_FIRST_HOUR_COL_IDX).map(h => String(h || '').trim());
  // Stops at the first empty header cell rather than filtering blanks out:
  // the tab still carries leftovers of the pre-2026-08-21 layout far to the
  // right (a stray " % Crash Free Users" header in column V and its old
  // values below it), and filtering blanks would drag that in as a 10th
  // checkpoint column.
  const end = header.indexOf('');
  return (end === -1 ? header : header.slice(0, end)).filter(Boolean);
}

// "11-Aug-26" / "11 Aug 26" / "11-Aug-2026" - the Date Monitor column has been
// written by hand as well as by this app, so both separators show up. Returns
// an ISO "2026-08-11" (sortable, and what the dashboard groups columns by) or
// '' when the cell isn't a date at all.
function parseDateCheckToIso(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})$/);
  if (!m) return '';
  const month = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()];
  if (month === undefined) return '';
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const day = Number(m[1]);
  if (!day || day > 31) return '';
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseCrashlyticsValue(raw) {
  const v = parseFloat(String(raw === undefined || raw === null ? '' : raw).replace('%', '').trim());
  return isNaN(v) ? null : v;
}

// One entry per sheet row: the day it's about plus one slot per checkpoint
// hour, `null` where that checkpoint hasn't been recorded yet (a day in
// progress is a normal, expected state here).
function readCrashlyticsEntry(row, rowNum, hours) {
  return {
    rowNum,
    syncDate: row[CR_SYNC_DATE_COL_IDX] || '',
    platform: (row[CR_PLATFORM_COL_IDX] || '').trim(),
    filter: row[CR_FILTER_COL_IDX] || '',
    date: row[CR_DATE_MONITOR_COL_IDX] || '',
    iso: parseDateCheckToIso(row[CR_DATE_MONITOR_COL_IDX]),
    values: hours.map((_, i) => parseCrashlyticsValue(row[CR_FIRST_HOUR_COL_IDX + i])),
  };
}

// A run of consecutive rows carrying the same Platform value - same block
// shape the Top Error Codes tab uses, so a re-sized or reordered block in the
// sheet needs no code change here.
// Every data row that names a platform, in sheet order (newest first, since
// new days are inserted at the top).
function readCrashlyticsRows(rows, hours) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!(row[CR_PLATFORM_COL_IDX] || '').trim()) continue;
    out.push(readCrashlyticsEntry(row, i + 1, hours)); // sheet rows are 1-based, row 1 is the header
  }
  return out;
}

// Grouped by platform NAME rather than by a contiguous run of rows: a
// platform's days no longer sit together now that each new day is inserted at
// the top of the sheet, so contiguity would split one platform into several
// blocks (and show it several times on the dashboard).
function groupCrashlyticsBlocks(rows, hours) {
  const blocks = [];
  readCrashlyticsRows(rows, hours).forEach(entry => {
    let block = blocks.find(b => b.platform.toLowerCase() === entry.platform.toLowerCase());
    if (!block) {
      block = { platform: entry.platform, history: [] };
      blocks.push(block);
    }
    block.history.push(entry);
  });
  return blocks;
}

// The newest actually-recorded checkpoint of a platform: the last day that
// carries any value, and within it the last filled hour. That pair is what
// the entry form shows as "ล่าสุดที่บันทึกไว้".
function latestCrashlyticsReading(history, hours) {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    for (let h = entry.values.length - 1; h >= 0; h--) {
      if (entry.values[h] !== null) return { date: entry.date, hour: hours[h], value: entry.values[h] };
    }
  }
  return null;
}

router.get('/api/tvn/crashlytics', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  try {
    const { rows } = await fetchCrashlyticsTitleAndRows();
    const hours = crashlyticsHours(rows);
    const platforms = groupCrashlyticsBlocks(rows, hours).map(b => {
      // Sheet order is newest-first (new days are inserted at the top) and
      // rows get hand-edited too, so the series is sorted by date here rather
      // than trusted - the dashboard plots it in this order, oldest to
      // newest.
      const history = b.history
        .filter(e => e.iso && e.values.some(v => v !== null))
        .sort((a, b2) => a.iso.localeCompare(b2.iso))
        .map(({ rowNum, platform, ...rest }) => rest);
      const latest = latestCrashlyticsReading(history, hours);
      const newest = history[history.length - 1] || b.history[b.history.length - 1] || {};
      // Newest *non-empty* filter, not simply the newest row's - a day added
      // from the quick single-checkpoint entry doesn't always carry one.
      const lastFilter = [...b.history]
        .sort((a, c) => (c.iso || '').localeCompare(a.iso || ''))
        .find(e => String(e.filter || '').trim());
      return {
        platform: b.platform,
        filter: (lastFilter && lastFilter.filter) || newest.filter || '',
        syncDate: newest.syncDate || '',
        dateCheck: latest ? latest.date : '',
        hour: latest ? latest.hour : '',
        value: latest ? latest.value : '',
        history,
      };
    });
    res.json({ hours, platforms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Both entry flows on the page post the same shape now:
//   { platform, filter, entries: [{ date, values: [{ hour, value }] }] }
// the day-to-day one sending a single entry with a single hour, the backfill
// box sending several days with every hour it could read. Each entry is an
// UPSERT on (platform, Date Monitor): an existing row for that day has just
// the given hours filled in (the rest of the row is left exactly as it was,
// which is what makes checking in again at 15.00 add to the 9.00/12.00
// readings instead of replacing them), and a day with no row yet gets one
// appended to the end of that platform's block.
router.post('/api/tvn/crashlytics/record', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  const { platform, entries, filter } = req.body || {};
  try {
    const platformName = String(platform || '').trim();
    if (!platformName) return res.status(400).json({ error: 'ไม่ได้ระบุ platform' });

    const { title, rows } = await fetchCrashlyticsTitleAndRows();
    const hours = crashlyticsHours(rows);
    if (!hours.length) return res.status(500).json({ error: 'อ่านหัวตาราง (ชั่วโมง) จากชีตไม่ได้' });
    const lastCol = colLetter(CR_FIRST_HOUR_COL_IDX + hours.length - 1);

    // Only hours the sheet actually has a column for, and only numeric
    // values - a blank cell in the pasted row means "not checked yet", not 0.
    const list = (Array.isArray(entries) ? entries : []).map(e => {
      const date = String(e.date || '').trim();
      const values = (Array.isArray(e.values) ? e.values : [])
        .map(v => ({ hourIdx: hours.indexOf(String(v.hour || '').trim()), value: parseCrashlyticsValue(v.value) }))
        .filter(v => v.hourIdx !== -1 && v.value !== null);
      // Per-row Sync Date/Filter win over the batch-level ones: the backfill
      // table lets both be edited per row, and what's in that table is what
      // gets written.
      return {
        date,
        iso: parseDateCheckToIso(date),
        syncDate: String(e.syncDate || '').trim(),
        filter: String(e.filter || '').trim(),
        values,
      };
    }).filter(e => e.date && e.values.length);

    if (!list.length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้ sync (ต้องมีวันที่ + ค่าอย่างน้อย 1 ช่วงเวลา)' });

    const syncDate = formatBangkokShortDate();
    const sheetRows = rows.map(r => [...(r || [])]);
    const written = [];

    // Oldest first, so that with every new row going in at the top the newest
    // day of a multi-day paste ends up above the older ones no matter which
    // order they were pasted in.
    const ordered = [...list].sort((a, b) => (a.iso || '').localeCompare(b.iso || ''));

    for (const entry of ordered) {
      const blocks = groupCrashlyticsBlocks(sheetRows, hours);
      const block = blocks.find(b => b.platform.toLowerCase() === platformName.toLowerCase());
      // Same day already recorded for this platform -> fill the missing
      // checkpoints in place, wherever that row happens to sit. Matched on
      // the parsed date where possible so "20-Aug-26" and "20 Aug 26" are the
      // same day, falling back to the raw label for a cell that isn't a
      // recognisable date at all.
      const existing = block && block.history.find(h => (entry.iso && h.iso ? h.iso === entry.iso : h.date.trim() === entry.date));

      const base = existing ? [...(sheetRows[existing.rowNum - 1] || [])] : [];
      const values = existing ? [...existing.values] : hours.map(() => null);
      entry.values.forEach(v => { values[v.hourIdx] = v.value; });

      const row = [];
      row[CR_SYNC_DATE_COL_IDX] = entry.syncDate || syncDate;
      row[CR_PLATFORM_COL_IDX] = block ? block.platform : platformName;
      // Falls back to whatever this platform last recorded, so a quick
      // single-checkpoint sync doesn't leave the Filter cell blank.
      const lastFilter = block && [...block.history]
        .sort((a, b) => (b.iso || '').localeCompare(a.iso || ''))
        .find(e => String(e.filter || '').trim());
      row[CR_FILTER_COL_IDX] = entry.filter || filter || (existing && existing.filter) || (lastFilter && lastFilter.filter) || '';
      row[CR_DATE_MONITOR_COL_IDX] = existing ? existing.date : entry.date;
      hours.forEach((_, i) => { row[CR_FIRST_HOUR_COL_IDX + i] = values[i] === null ? '' : values[i]; });
      // Anything the sheet carries beyond the hour columns (a note column
      // added by hand, say) is left untouched rather than blanked.
      for (let i = CR_FIRST_HOUR_COL_IDX + hours.length; i < base.length; i++) row[i] = base[i];

      let rowNum;
      if (existing) {
        rowNum = existing.rowNum;
      } else {
        // Newest on top: a new day always goes in at row 2 and pushes
        // everything below it down, rather than being appended after the
        // last used row. Appending was also fragile - this tab still carries
        // leftover values from the old layout out in column V, which made
        // "the last used row" row 22 even with no real data in A:M.
        rowNum = CR_FIRST_DATA_ROW;
        await insertSheetRows(SHEET_ID, CRASHLYTICS_SHEET_GID, rowNum, 1);
        sheetRows.splice(rowNum - 1, 0, []);
      }
      await updateSheetGrid(SHEET_ID, `'${title}'!A${rowNum}:${lastCol}${rowNum}`, [row.slice(0, CR_FIRST_HOUR_COL_IDX + hours.length).map(c => (c === undefined ? '' : c))]);
      sheetRows[rowNum - 1] = row;

      const filled = entry.values.map(v => `${hours[v.hourIdx]}=${v.value}%`).join(', ');
      written.push(`${entry.date} → แถว ${rowNum}${existing ? ' (เติมช่องที่ว่าง)' : ' (แถวใหม่บนสุด ของเดิมเลื่อนลง)'}: ${filled}`);
    }

    res.json({ result: `${platformName}: บันทึก ${list.length} วัน — ${written.join(' · ')}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reads a value off an uploaded chart screenshot via Claude vision - review-only,
// does NOT write anything. The caller (either tab's UI) writes via the existing
// /api/tvn/record (BitMovin) or /api/tvn/crashlytics/record (Crashlytics) endpoint
// once the human has confirmed the value.
router.post('/api/tvn/vision-read', async (req, res) => {
  const { tool, platform, imageDataUrl } = req.body || {};
  try {
    const result = await readValueFromScreenshot({ tool, platform, imageDataUrl });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
