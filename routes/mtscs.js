const router = require('express').Router();
const path = require('path');
const { fetchSheetRows, rowsToObjects } = require('../storage/googleSheets');

const SHEET_ID = process.env.MTSCS_SHEET_ID;
const SHEET_RANGE = process.env.MTSCS_SHEET_RANGE || 'JiraData!A:Z';
const JIRA_BASE_URL = process.env.JIRA_BASE_URL || '';
const CACHE_MS = 30 * 60 * 1000;

let cache = { data: null, lastUpdated: 0 };

// Aggregation (status/priority/first-tier breakdowns, month filtering) happens
// client-side in mtscs.html so the month filter doesn't need a server round trip.
async function loadData() {
  const rows = await fetchSheetRows(SHEET_ID, SHEET_RANGE);
  const tickets = rowsToObjects(rows);

  return {
    tickets,
    jiraBaseUrl: JIRA_BASE_URL,
    lastUpdated: new Date().toISOString(),
  };
}

router.get('/api/mtscs', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'MTSCS_SHEET_ID is not configured' });
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

router.get('/mtscs', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mtscs.html'));
});

module.exports = router;
