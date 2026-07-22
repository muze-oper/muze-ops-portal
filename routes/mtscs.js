const router = require('express').Router();
const path = require('path');
const { fetchSheetRows, rowsToObjects } = require('../storage/googleSheets');

const SHEET_ID = process.env.MTSCS_SHEET_ID;
const SHEET_RANGE = process.env.MTSCS_SHEET_RANGE || 'JiraData!A:Z';
const JIRA_BASE_URL = process.env.JIRA_BASE_URL || '';
const CACHE_MS = 30 * 60 * 1000;

let cache = { data: null, lastUpdated: 0 };

function groupBy(tickets, field) {
  const counts = {};
  tickets.forEach(t => {
    const value = t[field] || 'Unknown';
    counts[value] = (counts[value] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

async function loadData() {
  const rows = await fetchSheetRows(SHEET_ID, SHEET_RANGE);
  const tickets = rowsToObjects(rows);
  const doneStatuses = new Set(['resolved', 'done', 'closed']);
  const openCount = tickets.filter(t => !doneStatuses.has((t.status || '').toLowerCase())).length;

  // customfield_11588 = Jira's "First Tier" dropdown (Yes/No)
  const firstTierCount = tickets.filter(t => (t.customfield_11588 || '').toLowerCase() === 'yes').length;
  const firstTierPercent = tickets.length > 0 ? Math.round((firstTierCount / tickets.length) * 100) : 0;

  const latest = [...tickets]
    .sort((a, b) => new Date(b.created) - new Date(a.created))
    .slice(0, 20);

  return {
    total: tickets.length,
    open: openCount,
    firstTierPercent,
    byStatus: groupBy(tickets, 'status'),
    byPriority: groupBy(tickets, 'priority'),
    byIssueType: groupBy(tickets, 'customfield_11703'),
    latest,
    jiraBaseUrl: JIRA_BASE_URL,
    lastUpdated: new Date().toISOString(),
  };
}

router.get('/api/mtscs', async (req, res) => {
  if (!SHEET_ID) return res.status(500).json({ error: 'MTSCS_SHEET_ID is not configured' });
  try {
    if (!cache.data || (Date.now() - cache.lastUpdated) > CACHE_MS) {
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
