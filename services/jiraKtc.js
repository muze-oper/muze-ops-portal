// Searches the KTC Jira project for cases related to a customer's question.
// Uses API-token Basic Auth (a real user/service account, not OAuth) since
// this runs server-side with no interactive login. REST API v2 is used
// deliberately over v3: v2 returns description/comment bodies as plain
// strings (Jira wiki markup) instead of ADF JSON, which is far simpler to
// hand to an LLM as context.
const JIRA_SITE = (process.env.JIRA_BASE_URL || 'https://mymuze.atlassian.net').replace(/\/$/, '');
const JIRA_API_EMAIL = process.env.JIRA_API_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const PROJECT_KEY = process.env.JIRA_KTC_PROJECT_KEY || 'KTC';
const FIELDS = ['summary', 'description', 'comment', 'status', 'created', 'issuetype'];

function authHeader() {
  return `Basic ${Buffer.from(`${JIRA_API_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;
}

function escapeJqlString(s) {
  return s.replace(/["\\]/g, '\\$&');
}

// Atlassian's enhanced JQL endpoint (token-paginated) is the current one;
// fall back to the older endpoint in case a site hasn't rolled it out.
const SEARCH_ENDPOINTS = ['/rest/api/2/search/jql', '/rest/api/2/search'];

async function runSearch(jql, maxResults) {
  let lastErr;
  for (const endpoint of SEARCH_ENDPOINTS) {
    try {
      const res = await fetch(`${JIRA_SITE}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ jql, maxResults, fields: FIELDS }),
      });
      if (!res.ok) {
        lastErr = new Error(`Jira search failed (${res.status}) via ${endpoint}: ${(await res.text()).slice(0, 500)}`);
        continue;
      }
      const data = await res.json();
      return data.issues || [];
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Jira search failed');
}

function significantWords(text) {
  return Array.from(new Set(
    text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)
  ));
}

// Searches the full question first (Jira's `text ~` operator already does
// tokenized/fuzzy matching), then falls back to individual keywords if that
// phrase matched nothing — e.g. a question mixing an uncommon typo/product
// name with common words.
async function searchKtcCases(question, maxResults = 8) {
  if (!JIRA_API_EMAIL || !JIRA_API_TOKEN) {
    throw new Error('JIRA_API_EMAIL / JIRA_API_TOKEN is not configured');
  }

  const trimmed = question.trim().slice(0, 200);
  let issues = await runSearch(`project = ${PROJECT_KEY} AND text ~ "${escapeJqlString(trimmed)}"`, maxResults);

  if (!issues.length) {
    const words = significantWords(trimmed).slice(0, 5);
    for (const word of words) {
      if (issues.length >= maxResults) break;
      const found = await runSearch(`project = ${PROJECT_KEY} AND text ~ "${escapeJqlString(word)}"`, maxResults);
      for (const issue of found) {
        if (!issues.some((i) => i.key === issue.key)) issues.push(issue);
      }
    }
  }

  return issues.slice(0, maxResults);
}

function cleanText(text, limit = 4000) {
  if (!text) return '(none)';
  const cleaned = String(text).replace(/\n{3,}/g, '\n\n').trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}\n...(truncated)` : cleaned;
}

function formatIssueForContext(issue) {
  const f = issue.fields || {};
  const comments = (f.comment && f.comment.comments) || [];
  const commentText = comments
    .map((c) => `  - (${c.author?.displayName || 'unknown'}, ${c.created}): ${cleanText(c.body, 1500)}`)
    .join('\n');

  return [
    `### ${issue.key}: ${f.summary || ''}`,
    `Status: ${f.status?.name || ''} | Created: ${f.created || ''}`,
    `Link: ${JIRA_SITE}/browse/${issue.key}`,
    `Description: ${cleanText(f.description)}`,
    comments.length ? `Comments:\n${commentText}` : 'Comments: (none)',
  ].join('\n');
}

module.exports = { searchKtcCases, formatIssueForContext };
