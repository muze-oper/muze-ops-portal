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

async function fetchSheetRows(spreadsheetId, range) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

// Looks up a tab's current name by its stable numeric gid, so callers don't
// break when someone renames the tab (observed happening live on the TVN
// sheet - the tab title changed between two checks a few minutes apart while
// its gid stayed the same).
async function resolveSheetTitleByGid(spreadsheetId, gid) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const match = (res.data.sheets || []).find(s => s.properties.sheetId === gid);
  if (!match) throw new Error(`ไม่พบแท็บที่มี gid=${gid} ใน spreadsheet ${spreadsheetId}`);
  return match.properties.title;
}

// Overwrites a single row range (e.g. "Daily Shortnote!B371:H371") with the
// given cell values, left-to-right matching the range's columns.
async function updateSheetRow(spreadsheetId, range, values) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

// Writes a rectangular block (array of rows) in a single call - updateSheetRow
// above only handles one row, so filling an N-row block through it would cost
// N round-trips.
async function updateSheetGrid(spreadsheetId, range, rows) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

// Inserts `count` blank rows above `startRow` (1-based), pushing everything
// below it down - used by the TVN sync paths so a new day's data lands on top
// of the previous day's instead of overwriting it.
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
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

// Removes `count` rows starting at `startRow` (1-based), pulling everything
// below back up. The TVN sync paths only ever call this to shrink a re-synced
// snapshot of the same date - never to drop an older record.
async function deleteSheetRows(spreadsheetId, gid, startRow, count) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId: gid, dimension: 'ROWS', startIndex: startRow - 1, endIndex: startRow - 1 + count },
        },
      }],
    },
  });
}

// Cell background colors for a range - effectiveFormat (not userEnteredFormat)
// so a conditional-formatting rule's color counts the same as a manually-set
// one; either way it's what a person actually sees in the sheet. Returns a 2D
// array [row][col] of {red,green,blue} (0-1 floats) or null for an unset cell.
async function fetchSheetFormatting(spreadsheetId, range) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [range],
    fields: 'sheets.data.rowData.values.effectiveFormat.backgroundColor',
  });
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
  fetchSheetRows, rowsToObjects, updateSheetRow, updateSheetGrid,
  insertSheetRows, deleteSheetRows,
  fetchSheetFormatting, colorToHex, resolveSheetTitleByGid,
};
