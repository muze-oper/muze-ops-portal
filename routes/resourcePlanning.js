const router = require('express').Router();
const path = require('path');
const { fetchSheetRows, updateSheetRow, fetchSheetFormatting, colorToHex } = require('../storage/googleSheets');
const { bangkokDateParts } = require('../utils/gmailClassify');

const SHEET_ID = process.env.RESOURCE_PLANNING_SHEET_ID;
const TAB = process.env.RESOURCE_PLANNING_TAB || 'Daily Shortnote';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Matches the sheet's own date-cell format, e.g. "Mon 10 Aug" - no year, no
// leading zero on the day. offsetDays shifts which Bangkok calendar day to
// label (0 = today, 1 = tomorrow).
function sheetDateLabel(offsetDays = 0) {
  const p = bangkokDateParts(new Date(Date.now() + offsetDays * 86400000));
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday} ${p.day} ${MONTHS[p.month - 1]}`;
}

// Columns B..J in sheet order - matches both rowToItem's row[] indices and
// the column range fetchSheetFormatting is asked for below. 'done' has no
// UI field of its own but has to stay in this list so 'link' (column J)
// lines up with the right formatting column.
const COLUMN_KEYS = ['startTime', 'endTime', 'status', 'project', 'pic', 'topic', 'doing', 'done', 'link'];

function rowToItem(row, rowNumber, colors) {
  return {
    rowNumber,
    startTime: row[1] || '',
    endTime: row[2] || '',
    status: row[3] || '',
    project: row[4] || '',
    pic: row[5] || '',
    topic: row[6] || '',
    doing: row[7] || '',
    link: row[9] || '',
    colors: colors || {},
  };
}

// The sheet has one row per calendar day (Date filled in column A) followed
// by zero or more blank-Date rows that belong to that same day, until the
// next Date-filled row starts the next day. There's no unique ID column, so
// a row's identity for writing back is just its real 1-indexed sheet row.
// Scans once and buckets matching rows under each requested date label, so
// today + tomorrow can be pulled from a single pass over the sheet.
function collectDayBlocks(rows, labels) {
  const blocks = {};
  labels.forEach(l => { blocks[l] = []; });
  let currentLabel = null;
  for (let i = 1; i < rows.length; i++) {
    const dateCell = (rows[i][0] || '').trim();
    if (dateCell) currentLabel = dateCell;
    if (currentLabel && blocks[currentLabel]) blocks[currentLabel].push(i + 1);
  }
  return blocks;
}

async function loadDays(labels) {
  const rows = await fetchSheetRows(SHEET_ID, `${TAB}!A1:J3000`);
  const blocks = collectDayBlocks(rows, labels);
  const allRowNumbers = labels.flatMap(l => blocks[l]);

  // Cell colors mirror whatever's actually shown in the sheet (manual fill
  // or a conditional-formatting rule) - fetched only for the covered row
  // range, not the whole 3000-row sheet, so this stays cheap.
  let formatting = [];
  let first = null;
  if (allRowNumbers.length) {
    first = Math.min(...allRowNumbers);
    const last = Math.max(...allRowNumbers);
    formatting = await fetchSheetFormatting(SHEET_ID, `${TAB}!B${first}:J${last}`).catch(() => []);
  }

  return labels.map(dateLabel => ({
    dateLabel,
    items: blocks[dateLabel].map(rowNumber => {
      const rawRowColors = first != null ? (formatting[rowNumber - first] || []) : [];
      const colors = {};
      COLUMN_KEYS.forEach((key, colIdx) => {
        const hex = colorToHex(rawRowColors[colIdx]);
        if (hex) colors[key] = hex;
      });
      return rowToItem(rows[rowNumber - 1], rowNumber, colors);
    }),
  }));
}

router.get('/api/resource-planning/today', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'RESOURCE_PLANNING_SHEET_ID is not configured' });
  try {
    const [today] = await loadDays([sheetDateLabel(0)]);
    res.json(today);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Powers the /resource-planning page's Today + Today(+1) view.
router.get('/api/resource-planning/upcoming', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'RESOURCE_PLANNING_SHEET_ID is not configured' });
  try {
    const days = await loadDays([sheetDateLabel(0), sheetDateLabel(1)]);
    res.json({ days });
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
  const { startTime, endTime, status, project, pic, topic, doing, link } = req.body || {};
  try {
    await updateSheetRow(SHEET_ID, `${TAB}!B${rowNumber}:H${rowNumber}`, [
      startTime || '', endTime || '', status || '', project || '', pic || '', topic || '', doing || '',
    ]);
    // Column I (Done) sits between Doing and Link and isn't managed by this
    // form, so Link is written back separately instead of as one B:J range
    // that would otherwise clobber it.
    await updateSheetRow(SHEET_ID, `${TAB}!J${rowNumber}:J${rowNumber}`, [link || '']);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/resource-planning', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'resource-planning.html'));
});

module.exports = router;
