const router = require('express').Router();
const path = require('path');
const {
  fetchSheetRows, resolveSheetTitleByGid, updateSheetRow, updateSheetGrid,
  insertSheetRows, deleteSheetRows,
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
    // must stay scroll-free however much history piles up below.
    const latest = [];
    const seen = new Set();
    platforms.forEach(p => {
      const key = p.platform.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      latest.push(p);
    });
    res.json({ platforms: latest, hourColumns: HOUR_COLUMNS, historyRows: platforms.length });
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
    const topDate = (topRow[HOURLY_DATE_COL_IDX] || '').trim();

    // A different date means a new day's snapshot: push the platform's rows
    // down and take the freed top row, so yesterday's hours survive. The same
    // date is the same snapshot being re-synced (a partial CSV topped up, or
    // a correction), so that row is updated in place instead - which is what
    // keeps a mid-day re-sync from leaving two rows for one day.
    const isNewDay = Boolean(topDate) && topDate !== date;
    if (isNewDay) {
      await insertSheetRows(SHEET_ID, HOURLY_SHEET_GID, rowNum, 1, [HOURLY_AVERAGE_COL_IDX, HOURLY_PEAK_TIME_COL_IDX + 1]);
    }

    // An inserted row starts empty, so there is nothing to merge into - only
    // an in-place update keeps the hours the CSV didn't cover.
    const currentRow = isNewDay ? [] : topRow;
    let updatedCount = 0;
    const merged = HOUR_COLUMNS.map((label, i) => {
      const provided = values ? values[label] : undefined;
      if (provided !== undefined && provided !== '') {
        updatedCount++;
        return String(provided);
      }
      const existing = currentRow[HOURLY_FIRST_HOUR_COL_IDX + i];
      return existing === undefined ? '' : existing;
    });

    const filtersColLetter = colLetter(HOURLY_FILTERS_COL_IDX);
    const dateColLetter = colLetter(HOURLY_DATE_COL_IDX);
    const firstColLetter = colLetter(HOURLY_FIRST_HOUR_COL_IDX);
    const lastColLetter = colLetter(HOURLY_FIRST_HOUR_COL_IDX + HOUR_COLUMNS.length - 1);
    // A fresh row needs Filters and Platform written too - they're what makes
    // it part of this platform's run, which is how the next sync finds it.
    if (isNewDay) {
      await updateSheetRow(SHEET_ID, `'${title}'!${filtersColLetter}${rowNum}:${dateColLetter}${rowNum}`, [
        topRow[HOURLY_FILTERS_COL_IDX] || '',
        topRow[HOURLY_PLATFORM_COL_IDX] || '',
        date,
      ]);
    } else {
      await updateSheetRow(SHEET_ID, `'${title}'!${dateColLetter}${rowNum}:${dateColLetter}${rowNum}`, [date]);
    }
    await updateSheetRow(SHEET_ID, `'${title}'!${firstColLetter}${rowNum}:${lastColLetter}${rowNum}`, merged);

    const how = isNewDay ? `แถวใหม่ ${date} (ของเดิมเลื่อนลง)` : `อัปเดตแถว ${date}`;
    res.json({ result: `${platform}: ${how} — ${updatedCount} ช่วงเวลา` });
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
// existing rows down, so earlier days accumulate below instead of being
// overwritten. The one exception is a re-sync of a date that's already at the
// top of the block - that's the same snapshot corrected, so those rows are
// resized and rewritten in place rather than duplicated. Older dates further
// down are never touched.
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

    // How many rows at the top of the block already carry this date - i.e. a
    // previous sync of the same snapshot, which this one supersedes.
    let sameDate = 0;
    while (sameDate < block.entries.length && (block.entries[sameDate].date || '').trim() === date) sameDate++;

    if (list.length > sameDate) {
      await insertSheetRows(SHEET_ID, TOP_ERROR_CODES_SHEET_GID, block.startRow, list.length - sameDate);
    } else if (list.length < sameDate) {
      await deleteSheetRows(SHEET_ID, TOP_ERROR_CODES_SHEET_GID, block.startRow, sameDate - list.length);
    }

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

    const how = sameDate ? `เขียนทับรอบเดิมของวันเดียวกัน` : `แถวใหม่ (ของเดิมเลื่อนลง)`;
    res.json({ result: `${platform}: บันทึก ${list.length} error code วันที่ ${date} — ${how} (แถว ${block.startRow}-${endRow})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Firebase Crashlytics tab: one row per platform, gid is stable (0) but
// resolve the title anyway in case it ever gets renamed like BitMovin Error did.
const CRASHLYTICS_SHEET_GID = 0;
const CRASHLYTICS_PLATFORM_COL_IDX = 0; // column A - "Andriod TV", "Apple TV", "Andriod", "iOS" (sheet's own spelling)
const CRASHLYTICS_FILTER_COL_IDX = 1; // column B
const CRASHLYTICS_ACTION_DATE_COL_IDX = 2; // column C
const CRASHLYTICS_DATE_CHECK_COL_IDX = 3; // column D
const CRASHLYTICS_VALUE_COL_IDX = 4; // column E - plain number, NOT percent-formatted (unlike BitMovin Error's columns)

// "13 Aug 26" style, matching the existing cells in this tab (different from
// BitMovin Error's "Mon-3-Aug" weekly-label format).
function formatBangkokShortDate() {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: 'numeric' }).format(now);
  const month = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', month: 'short' }).format(now);
  const year = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: '2-digit' }).format(now);
  return `${day} ${month} ${year}`;
}

async function fetchCrashlyticsTitleAndRows() {
  const title = await resolveSheetTitleByGid(SHEET_ID, CRASHLYTICS_SHEET_GID);
  const rows = await fetchSheetRows(SHEET_ID, `'${title}'!A1:G20`);
  return { title, rows };
}

router.get('/api/tvn/crashlytics', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  try {
    const { rows } = await fetchCrashlyticsTitleAndRows();
    const platforms = rows
      .slice(1)
      .map((row) => ({
        platform: row[CRASHLYTICS_PLATFORM_COL_IDX] || '',
        filter: row[CRASHLYTICS_FILTER_COL_IDX] || '',
        actionDate: row[CRASHLYTICS_ACTION_DATE_COL_IDX] || '',
        dateCheck: row[CRASHLYTICS_DATE_CHECK_COL_IDX] || '',
        value: row[CRASHLYTICS_VALUE_COL_IDX] || '',
      }))
      .filter((p) => p.platform);
    res.json({ platforms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/tvn/crashlytics/record', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'TVN_SHEET_ID is not configured' });
  const { platform, value, filter } = req.body || {};
  try {
    const { title, rows } = await fetchCrashlyticsTitleAndRows();
    const rowIdx = rows.findIndex(
      (row, i) => i > 0 && (row[CRASHLYTICS_PLATFORM_COL_IDX] || '').trim().toLowerCase() === String(platform || '').trim().toLowerCase()
    );
    if (rowIdx === -1) {
      return res.status(400).json({ error: `ไม่รู้จัก platform "${platform}" ในแท็บ Firebase Crashlytics` });
    }
    const numeric = parseFloat(String(value).replace('%', '').trim());
    if (isNaN(numeric)) {
      return res.status(400).json({ error: `ค่า "${value}" ไม่ใช่ตัวเลข` });
    }

    const rowNum = rowIdx + 1; // rows[] is 0-indexed, sheet rows are 1-indexed - they line up directly
    const dateLabel = formatBangkokShortDate();
    const valueColLetter = colLetter(CRASHLYTICS_VALUE_COL_IDX);
    const actionDateColLetter = colLetter(CRASHLYTICS_ACTION_DATE_COL_IDX);
    const dateCheckColLetter = colLetter(CRASHLYTICS_DATE_CHECK_COL_IDX);

    await updateSheetRow(SHEET_ID, `'${title}'!${valueColLetter}${rowNum}:${valueColLetter}${rowNum}`, [numeric]);
    await updateSheetRow(SHEET_ID, `'${title}'!${actionDateColLetter}${rowNum}:${actionDateColLetter}${rowNum}`, [dateLabel]);
    await updateSheetRow(SHEET_ID, `'${title}'!${dateCheckColLetter}${rowNum}:${dateCheckColLetter}${rowNum}`, [dateLabel]);
    if (filter) {
      const filterColLetter = colLetter(CRASHLYTICS_FILTER_COL_IDX);
      await updateSheetRow(SHEET_ID, `'${title}'!${filterColLetter}${rowNum}:${filterColLetter}${rowNum}`, [filter]);
    }

    res.json({ result: `${platform}: อัปเดต Crash Free User = ${numeric}% (${dateLabel})` });
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
