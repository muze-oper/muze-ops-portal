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

module.exports = { fetchSheetRows, rowsToObjects, updateSheetRow };
