const router = require('express').Router();
const path = require('path');
const { fetchSheetRows, updateSheetRow, fetchSheetFormatting, colorToHex } = require('../storage/googleSheets');
const { bangkokDateParts } = require('../utils/gmailClassify');

const SHEET_ID = process.env.RESOURCE_PLANNING_SHEET_ID;
const TAB = process.env.RESOURCE_PLANNING_TAB || 'Daily Shortnote';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Matches the sheet's own date-cell format, e.g. "Mon 10 Aug" - no year, no
// leading zero on the day.
function todaySheetDateLabel() {
  const p = bangkokDateParts(new Date());
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday} ${p.day} ${MONTHS[p.month - 1]}`;
}

// Columns B..H in sheet order - matches both rowToItem's row[] indices and
// the column range fetchSheetFormatting is asked for below.
const COLUMN_KEYS = ['startTime', 'endTime', 'status', 'project', 'pic', 'topic', 'link'];

function rowToItem(row, rowNumber, colors) {
  return {
    rowNumber,
    startTime: row[1] || '',
    endTime: row[2] || '',
    status: row[3] || '',
    project: row[4] || '',
    pic: row[5] || '',
    topic: row[6] || '',
    link: row[7] || '',
    colors: colors || {},
  };
}

// The sheet has one row per calendar day (Date filled in column A) followed
// by zero or more blank-Date rows that belong to that same day, until the
// next Date-filled row starts the next day. There's no unique ID column, so
// a row's identity for writing back is just its real 1-indexed sheet row.
router.get('/api/resource-planning/today', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'RESOURCE_PLANNING_SHEET_ID is not configured' });
  try {
    const rows = await fetchSheetRows(SHEET_ID, `${TAB}!A1:H3000`);
    const targetLabel = todaySheetDateLabel();
    const rowNumbers = [];
    let inTodayBlock = false;
    for (let i = 1; i < rows.length; i++) {
      const dateCell = (rows[i][0] || '').trim();
      if (dateCell) inTodayBlock = dateCell === targetLabel;
      if (inTodayBlock) rowNumbers.push(i + 1);
    }

    // Cell colors mirror whatever's actually shown in the sheet (manual fill
    // or a conditional-formatting rule) - fetched only for today's own row
    // range, not the whole 3000-row sheet, so this stays cheap.
    let formatting = [];
    if (rowNumbers.length) {
      const first = rowNumbers[0], last = rowNumbers[rowNumbers.length - 1];
      formatting = await fetchSheetFormatting(SHEET_ID, `${TAB}!B${first}:H${last}`).catch(() => []);
    }

    const items = rowNumbers.map((rowNumber, idx) => {
      const rawRowColors = formatting[idx] || [];
      const colors = {};
      COLUMN_KEYS.forEach((key, colIdx) => {
        const hex = colorToHex(rawRowColors[colIdx]);
        if (hex) colors[key] = hex;
      });
      return rowToItem(rows[rowNumber - 1], rowNumber, colors);
    });

    res.json({ dateLabel: targetLabel, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/resource-planning/row/:rowNumber', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'RESOURCE_PLANNING_SHEET_ID is not configured' });
  const rowNumber = parseInt(req.params.rowNumber, 10);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return res.status(400).json({ error: 'invalid row number' });
  }
  const { startTime, endTime, status, project, pic, topic, link } = req.body || {};
  try {
    await updateSheetRow(SHEET_ID, `${TAB}!B${rowNumber}:H${rowNumber}`, [
      startTime || '', endTime || '', status || '', project || '', pic || '', topic || '', link || '',
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/resource-planning', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'resource-planning.html'));
});

module.exports = router;
