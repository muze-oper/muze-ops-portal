const router = require('express').Router();
const { fetchSheetRows, rowsToObjects } = require('../storage/googleSheets');

const SHEET_ID = process.env.NISSAN_SHEET_ID;
const SHEET_RANGE = process.env.NISSAN_SHEET_RANGE || 'JiraData!A:Z';
const JIRA_BASE_URL = process.env.JIRA_BASE_URL || '';
const CACHE_MS = 30 * 60 * 1000;

let cache = { data: null, lastUpdated: 0 };

// Columns aren't hardcoded like MTS (customfield_11703 etc.) - the queue's field
// set is only known once the sheet has data, so we derive it from whatever the
// Jira Service Desk queue export actually wrote as headers.
async function loadData() {
  const rows = await fetchSheetRows(SHEET_ID, SHEET_RANGE);
  const tickets = rowsToObjects(rows);
  const columns = tickets.length > 0
    ? Object.keys(tickets[0]).filter(k => k !== 'key' && k !== 'exported_at')
    : [];

  return {
    tickets,
    columns,
    jiraBaseUrl: JIRA_BASE_URL,
    lastUpdated: new Date().toISOString(),
  };
}

router.get('/api/nissan-mn', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'NISSAN_SHEET_ID is not configured' });
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

// The Nissan MN dashboard is now a tab on /mtscs rather than its own page -
// redirect so the URL that was briefly live still works (bookmarks, links).
router.get('/nissan-mn', (req, res) => {
  res.redirect('/mtscs?tab=nissan');
});

module.exports = router;
