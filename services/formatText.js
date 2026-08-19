// Small text-formatting helpers so the chat's answers read as structured
// notes instead of a wall of text — no LLM rewriting involved, just
// mechanical cleanup of patterns that already exist in the source text.

// Root Cause / Resolution entries often enumerate sub-cases inline as
// "... (1) first thing (2) second thing (3) third thing" in one continuous
// paragraph. Breaking each "(N)" onto its own line turns that into an
// actual scannable list.
function breakEnumeratedClauses(text) {
  if (!text) return text;
  let result = text.replace(/\s*\((\d)\)\s*/g, (_match, n) => `\n(${n}) `);
  // Multi-ticket Resolution text tends to read as "KTC-180 did X KTC-105 did
  // Y KTC-193 did Z" in one run-on line — break before each ticket key that
  // *starts* a new clause (not one already sitting in a trailing "(KTC-180)"
  // citation, which stays attached to what it's citing).
  result = result.replace(/(?<!\()\b(KTC-\d+)\b(?!\))/g, '\n$1');
  return result.trim();
}

// Shortens a Jira ISO timestamp ("2026-07-01T09:52:58.671+0700") down to
// just the date — the exact second a ticket was created isn't useful in a
// support-chat answer and just adds visual noise.
function shortDate(isoString) {
  if (!isoString) return '-';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(isoString);
  return m ? m[1] : isoString;
}

module.exports = { breakEnumeratedClauses, shortDate };
