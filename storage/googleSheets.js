const { google } = require('googleapis');

// Full read/write scope - MTS/Nissan only ever call fetchSheetRows (read),
// so widening this is safe; it just lets other callers (Resource Planning)
// write back too.
function getAuth() {
  if (process.env.GOOGLE_SHEETS_CREDENTIALS_BASE64) {
    const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SHEETS_CREDENTIALS_BASE64, 'base64').toString());
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  return new google.auth.GoogleAuth({ keyFile: './google-sheets-credentials.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

// Sheets' read quota is per-minute and per-user, and every route in this
// app shares the same service-account "user" - so a burst (two people, or
// one person reloading) can still trip it even with the call-count fixes
// elsewhere. A 429 is purely transient, so retry it a couple of times
// instead of surfacing Google's raw "Quota exceeded" text to the page.
// Deliberately short: a Vercel function has ~10s to answer, and a long
// backoff would just turn a quota error into a timeout.
const RETRY_DELAYS_MS = [700, 1800, 3200];

function isTransientQuotaError(err) {
  const code = err?.code ?? err?.response?.status;
  if (code === 429 || code === 503) return true;
  return /quota exceeded|rate limit|backendError/i.test(err?.message || '');
}

async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isTransientQuotaError(err)) throw err;
      // Jitter so two concurrent lambdas that hit the wall together don't
      // retry in lockstep and trip it again.
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt] + Math.floor(Math.random() * 300)));
    }
  }
}

// A tab title can legally contain a single quote, which would otherwise
// break out of the quoted A1 range. Matters most for batched reads, where
// one malformed range fails the whole batch, not just its own tab.
function quoteTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

async function fetchSheetRows(spreadsheetId, range) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await withRetry(() => sheets.spreadsheets.values.get({ spreadsheetId, range }));
  return res.data.values || [];
}

// One `values.batchGet` counts as a single read request no matter how many
// ranges it carries, so a caller that would otherwise loop N tabs through
// fetchSheetRows (N reads, which is what kept blowing the per-minute quota
// on the CAB deploy tracker's 36+ tabs) gets the same data for ~1. Returns
// one rows-array per requested range, in the order requested. Chunked
// because every range's values come back in a single response body.
async function fetchSheetRangesBatch(spreadsheetId, ranges, chunkSize = 20) {
  if (!ranges.length) return [];
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const out = [];
  for (let i = 0; i < ranges.length; i += chunkSize) {
    const chunk = ranges.slice(i, i + chunkSize);
    const res = await withRetry(() => sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: chunk }));
    const got = res.data.valueRanges || [];
    chunk.forEach((_, j) => out.push(got[j]?.values || []));
  }
  return out;
}

// Looks up a tab's current name by its stable numeric gid, so callers don't
// break when someone renames the tab (observed happening live on the TVN
// sheet - the tab title changed between two checks a few minutes apart while
// its gid stayed the same).
//
// Cached for a few minutes per (spreadsheetId, gid): every TVN read AND write
// resolves a title first, so with no cache a single page load plus a sync
// burns 2+ reads just on this lookup alone - this is what tipped Sheets API's
// per-minute read quota over in practice ("Quota exceeded ... Read requests
// per minute per user"). A short TTL still self-heals within minutes of a
// rename instead of requiring a server restart.
const titleCache = new Map(); // `${spreadsheetId}:${gid}` -> { title, ts }
const TITLE_CACHE_MS = 5 * 60 * 1000;

async function resolveSheetTitleByGid(spreadsheetId, gid) {
  const key = `${spreadsheetId}:${gid}`;
  const cached = titleCache.get(key);
  if (cached && (Date.now() - cached.ts) < TITLE_CACHE_MS) return cached.title;
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' }));
  const match = (res.data.sheets || []).find(s => s.properties.sheetId === gid);
  if (!match) throw new Error(`ไม่พบแท็บที่มี gid=${gid} ใน spreadsheet ${spreadsheetId}`);
  titleCache.set(key, { title: match.properties.title, ts: Date.now() });
  return match.properties.title;
}

// Metadata only (no cell values) - every tab's title, gid and hidden state,
// in the sheet's own tab order. Lets a caller iterate all worksheets without
// hardcoding a gid per tab, e.g. a CAB tracker that gets a new dated tab
// added every report cycle.
async function listSheetTitles(spreadsheetId) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' }));
  return (res.data.sheets || []).map(s => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
    hidden: !!s.properties.hidden,
  }));
}

// Overwrites a single row range (e.g. "Daily Shortnote!B371:H371") with the
// given cell values, left-to-right matching the range's columns.
async function updateSheetRow(spreadsheetId, range, values) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  }));
}

// Writes a rectangular block (array of rows) in a single call - updateSheetRow
// above only handles one row, so filling an N-row block through it would cost
// N round-trips.
async function updateSheetGrid(spreadsheetId, range, rows) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  }));
}

// Inserts `count` blank rows above `startRow` (1-based), pushing everything
// below it down - the TVN sync paths only ever add rows this way, so nothing
// already in the sheet is rewritten or removed.
//
// inheritFromBefore is false so the new rows take their formatting from the
// row currently at `startRow` (the one being pushed down), not from the row
// above it - inserting at the top of a platform's block would otherwise drag
// the header's or the previous platform's styling in.
//
// insertDimension only carries formatting, never content, so any per-row
// formula columns have to be copied separately: `formulaCols` is a
// [startColIdx, endColIdx) 0-based half-open range that gets PASTE_FORMULA'd
// down from the pushed-down row, which lets Sheets rewrite the relative
// references (the hourly tab's Average/Peak columns are per-row formulas
// over that row's own D:AA).
async function insertSheetRows(spreadsheetId, gid, startRow, count, formulaCols) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const top = startRow - 1; // batchUpdate ranges are 0-based, end-exclusive
  const requests = [{
    insertDimension: {
      range: { sheetId: gid, dimension: 'ROWS', startIndex: top, endIndex: top + count },
      inheritFromBefore: false,
    },
  }];
  if (formulaCols) {
    const [firstCol, endCol] = formulaCols;
    requests.push({
      copyPaste: {
        // After the insert, whatever used to be at `startRow` sits `count`
        // rows lower - that shifted row is the formula template.
        source: { sheetId: gid, startRowIndex: top + count, endRowIndex: top + count + 1, startColumnIndex: firstCol, endColumnIndex: endCol },
        destination: { sheetId: gid, startRowIndex: top, endRowIndex: top + count, startColumnIndex: firstCol, endColumnIndex: endCol },
        pasteType: 'PASTE_FORMULA',
      },
    });
  }
  await withRetry(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }));
}

// Cell background colors for a range - effectiveFormat (not userEnteredFormat)
// so a conditional-formatting rule's color counts the same as a manually-set
// one; either way it's what a person actually sees in the sheet. Returns a 2D
// array [row][col] of {red,green,blue} (0-1 floats) or null for an unset cell.
async function fetchSheetFormatting(spreadsheetId, range) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await withRetry(() => sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [range],
    fields: 'sheets.data.rowData.values.effectiveFormat.backgroundColor',
  }));
  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  return rowData.map(row => (row.values || []).map(cell => cell.effectiveFormat?.backgroundColor || null));
}

// White (the default/unstyled background) is treated as "no color" so a
// plain cell doesn't override the page's own styling with a hard-coded white.
function colorToHex(c) {
  if (!c) return null;
  const r = Math.round((c.red ?? 1) * 255);
  const g = Math.round((c.green ?? 1) * 255);
  const b = Math.round((c.blue ?? 1) * 255);
  if (r >= 250 && g >= 250 && b >= 250) return null;
  return `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

// Sets (or clears) a solid background color on individual cells in one
// batchUpdate call. `cells` is [{ row, col, color }], 0-based row/col;
// `color` is {red,green,blue} (0-1 floats) or falsy to clear back to white.
async function setCellBackgrounds(spreadsheetId, gid, cells) {
  if (!cells.length) return;
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const requests = cells.map(({ row, col, color }) => ({
    repeatCell: {
      range: { sheetId: gid, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: col, endColumnIndex: col + 1 },
      cell: { userEnteredFormat: { backgroundColor: color || { red: 1, green: 1, blue: 1 } } },
      fields: 'userEnteredFormat.backgroundColor',
    },
  }));
  await withRetry(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }));
}

// แถวแรกเป็น header — แปลงแถวที่เหลือเป็น object ตามชื่อคอลัมน์
function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

module.exports = {
  fetchSheetRows, fetchSheetRangesBatch, quoteTitle, rowsToObjects, updateSheetRow, updateSheetGrid,
  insertSheetRows, setCellBackgrounds,
  fetchSheetFormatting, colorToHex, resolveSheetTitleByGid, listSheetTitles,
};
