// Plain keyword matching over the static Handover Document — no LLM call,
// so this has zero incremental cost. Splits the doc into its "### heading"
// incident sections and scores each by how much a question overlaps with it.
const { significantWords, scoreText, isRelevant } = require('./textRelevance');

function parseSections(markdown) {
  const lines = markdown.split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^### (.+)/);
    if (heading) {
      if (current) sections.push(current);
      current = { heading: heading[1].trim(), body: [] };
    } else if (/^## /.test(line)) {
      // A "## Category" divider between sections — not part of either
      // section's body, so don't let it get appended to the previous one.
      continue;
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ heading: s.heading, body: s.body.join('\n').trim() }));
}

function findRelevantSections(question, markdown, maxSections = 2) {
  const words = significantWords(question);
  if (!words.length && !question.trim()) return [];

  const scored = parseSections(markdown)
    .map((s) => {
      const score = scoreText(words, question, `${s.heading} ${s.body}`);
      return { ...s, ...score, score: score.total };
    })
    .filter(isRelevant)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];

  // Beyond the top hit, only keep others that are still clearly in the same
  // ballpark — a distant second match (e.g. scoring a third of the top hit)
  // reads as noise next to a strong lead, not a genuine alternative.
  const topScore = scored[0].score;
  return scored.filter((s) => s.score >= topScore * 0.5).slice(0, maxSections);
}

// Splits a section's body into its Root Cause / Resolution halves so the
// route can lead with "what to do" instead of dumping the whole block —
// the raw text already has both, just not visually prioritized.
function splitRootCauseResolution(body) {
  const lines = body.split('\n');
  const resolutionStart = lines.findIndex((l) => /^resolution/i.test(l.trim()));
  if (resolutionStart === -1) return { rootCause: body.trim(), resolution: null };

  const rootCause = lines.slice(0, resolutionStart).join('\n').trim()
    // Strip the bare "Root Cause:" label — redundant once shown under its
    // own bolded Thai header. Keep parenthetical variants like
    // "Resolution (ถาวร):" as-is below, since the distinction matters there.
    .replace(/^root cause\s*:\s*/i, '');
  const resolution = lines.slice(resolutionStart).join('\n').trim()
    .replace(/^resolution\s*:\s*/i, '');

  return { rootCause, resolution };
}

module.exports = { findRelevantSections, splitRootCauseResolution };
