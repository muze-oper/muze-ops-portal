// Searches the KTC Jira project for cases related to a customer's question.
// Uses API-token Basic Auth (a real user/service account, not OAuth) since
// this runs server-side with no interactive login.
const { significantWords, charNgrams, scoreText, isRelevant } = require('./textRelevance');
const { extractText } = require('./adfText');

const JIRA_SITE = (process.env.JIRA_BASE_URL || 'https://mymuze.atlassian.net').replace(/\/$/, '');
const JIRA_API_EMAIL = process.env.JIRA_API_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const PROJECT_KEY = process.env.JIRA_KTC_PROJECT_KEY || 'KTC';
const FIELDS = ['summary', 'description', 'comment', 'status', 'created', 'issuetype', 'assignee'];

function authHeader() {
  return `Basic ${Buffer.from(`${JIRA_API_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;
}

function escapeJqlString(s) {
  return s.replace(/["\\]/g, '\\$&');
}

// IMPORTANT: only verified directly against `api.atlassian.com/ex/jira/{id}/...`
// (the OAuth gateway a connected Atlassian session goes through) — NOT
// against this file's actual request path, `{site}.atlassian.net/rest/api/...`
// with Basic Auth. Those are different hosts/auth models; a newer endpoint
// being confirmed on one doesn't guarantee it behaves the same on the other.
// The classic `/rest/api/3/search` has been stable for direct-site
// Basic-Auth access for years — try it FIRST, and treat an empty result
// from any endpoint as reason to still try the next one (runSearch below),
// not proof there's really nothing — an endpoint returning 200 with an
// empty/differently-shaped result is indistinguishable from "genuinely no
// matches" otherwise.
const SEARCH_ENDPOINTS = ['/rest/api/3/search', '/rest/api/3/search/jql', '/rest/api/2/search'];

// v3 returns description/comment bodies as ADF (JSON), not plain strings —
// normalize to plain text right here, once, so every caller of runSearch
// (searchKtcCases, searchRecentTickets, and whatever else lands on this
// module later) keeps getting plain strings like before, without each one
// needing to know or care which API version produced the data.
function normalizeIssue(issue) {
  const f = issue.fields || {};
  return {
    ...issue,
    fields: {
      ...f,
      description: extractText(f.description),
      comment: f.comment && {
        ...f.comment,
        comments: (f.comment.comments || []).map((c) => ({ ...c, body: extractText(c.body) })),
      },
    },
  };
}

async function runSearch(jql, maxResults) {
  let lastErr;
  let bestEmptyResult = null; // an endpoint that responded OK but found nothing
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
      const issues = (data.issues || []).map(normalizeIssue);
      if (issues.length) return issues;
      // Responded OK but nothing came back — could be a real "no matches",
      // or this specific endpoint quietly not working as expected for this
      // auth/host combination. Remember it, but keep trying the remaining
      // endpoints in case one of them actually finds something.
      console.warn(`[jiraKtc] ${endpoint} returned 0 issues for: ${jql}`);
      bestEmptyResult = issues;
    } catch (err) {
      lastErr = err;
    }
  }
  if (bestEmptyResult) return bestEmptyResult;
  throw lastErr || new Error('Jira search failed');
}

// Jira's `text ~` operator is a fuzzy/tokenized search — it can return
// issues that only share a common word with the question, especially via
// the per-keyword fallback below (OR-ing single generic words in easily
// pulls unrelated tickets). Re-score every candidate against the actual
// question text ourselves and drop anything that doesn't clear the same
// relevance bar the handover-doc matcher uses, instead of trusting Jira's
// ranking blindly.
function issueScore(words, questionGrams, issue) {
  const f = issue.fields || {};
  const lastComment = f.comment?.comments?.[f.comment.comments.length - 1];
  const haystack = [f.summary, extractText(f.description), extractText(lastComment?.body)]
    .filter(Boolean).join(' ');
  return scoreText(words, questionGrams, haystack);
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

  const words = significantWords(trimmed);
  const questionGrams = charNgrams(trimmed);
  // Score every candidate (attached as __score, same scale as the
  // handover-doc matcher's since both use textRelevance.scoreText) so the
  // route can tell whether Jira's own match is stronger than a doc match —
  // an exact-phrase Jira hit should outrank a merely-topical doc entry, not
  // get buried under it.
  const scored = issues
    .map((issue) => ({ issue, score: issueScore(words, questionGrams, issue) }))
    .filter(({ score }) => isRelevant(score))
    .sort((a, b) => b.score.total - a.score.total);

  return scored.slice(0, maxResults).map(({ issue, score }) => ({ ...issue, __score: score.total }));
}

// Recently-created, still-open cases for the landing page's hot-issues
// summary - unlike searchKtcCases this isn't a question match, just "what
// still needs attention". Excludes Done since a closed ticket isn't "hot".
async function searchRecentTickets(days = 2, maxResults = 10) {
  if (!JIRA_API_EMAIL || !JIRA_API_TOKEN) {
    throw new Error('JIRA_API_EMAIL / JIRA_API_TOKEN is not configured');
  }
  return runSearch(`project = ${PROJECT_KEY} AND created >= -${days}d AND status != Done ORDER BY created DESC`, maxResults);
}

function cleanText(text, limit = 4000) {
  const plain = extractText(text);
  if (!plain) return '(none)';
  return plain.length > limit ? `${plain.slice(0, limit)}\n...(truncated)` : plain;
}

// Renders one issue as-is (no rewriting/summarizing) for direct display in
// the chat: key/status/link, the raw description, and only the most recent
// comment (full comment history is one click away via the link).
function formatIssueRaw(issue) {
  const f = issue.fields || {};
  const comments = (f.comment && f.comment.comments) || [];
  const lastComment = comments[comments.length - 1];

  const lines = [
    `**${issue.key}: ${f.summary || ''}**`,
    `สถานะ: ${f.status?.name || '-'} | เปิดเคสเมื่อ: ${f.created || '-'} | ${JIRA_SITE}/browse/${issue.key}`,
    '',
    `Description: ${cleanText(f.description, 1200)}`,
  ];
  if (lastComment) {
    lines.push('', `Comment ล่าสุด (${lastComment.author?.displayName || 'unknown'}, ${lastComment.created}): ${cleanText(lastComment.body, 1200)}`);
  }
  return lines.join('\n');
}

module.exports = { searchKtcCases, formatIssueRaw, searchRecentTickets };
