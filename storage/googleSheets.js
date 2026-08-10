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

module.exports = { fetchSheetRows, rowsToObjects, updateSheetRow, fetchSheetFormatting, colorToHex, resolveSheetTitleByGid };
