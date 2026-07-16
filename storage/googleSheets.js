const { google } = require('googleapis');

function getAuth() {
  if (process.env.GOOGLE_SHEETS_CREDENTIALS_BASE64) {
    const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SHEETS_CREDENTIALS_BASE64, 'base64').toString());
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  }
  return new google.auth.GoogleAuth({ keyFile: './google-sheets-credentials.json', scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
}

async function fetchSheetRows(spreadsheetId, range) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
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

module.exports = { fetchSheetRows, rowsToObjects };
