// Plain keyword matching over the static Handover Document — no LLM call,
// so this has zero incremental cost. Splits the doc into its "### heading"
// incident sections and scores each by how much a question overlaps with it.
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

// Common function words that show up in nearly every section and would
// otherwise dominate the score regardless of topic — e.g. "แล้ว" (already)
// matching every section made an unrelated one outscore the real match in
// testing. Filtering these out lets the actual topic words (redirect, cache,
// CRV, Facebook...) decide the ranking instead.
const STOPWORDS = new Set([
  'และ', 'หรือ', 'แต่', 'ของ', 'กับ', 'ที่', 'ไม่', 'ได้', 'ใน', 'เป็น', 'มี', 'จาก', 'ให้', 'มา', 'ไป',
  'ว่า', 'ก็', 'นี้', 'นั้น', 'อยู่', 'จะ', 'ยัง', 'ต้อง', 'ทำ', 'การ', 'คือ', 'แล้ว', 'ซึ่ง', 'ทั้ง', 'อีก',
  'ทาง', 'ทุก', 'บาง', 'กว่า', 'ลูกค้า', 'แจ้ง', 'ปัญหา', 'สอบถาม', 'กด', 'เข้า', 'หน้า', 'ระบบ', 'อย่าง',
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'this', 'that',
]);

// \p{M} (combining marks) must stay in the "word" character class alongside
// \p{L}/\p{N} — Thai tone marks and vowel signs are separate Unicode code
// points from their base consonant, so splitting on "not letter/number"
// alone chops words apart mid-character (e.g. "แล้ว" -> "แล", "ว").
function significantWords(text) {
  return Array.from(new Set(
    text.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  ));
}

// Word matching alone misses natural Thai sentences, which are typically
// written with no spaces between words at all (unlike this tokenizer's
// space/punctuation-delimited "words") — a whole clause becomes one token
// that will never substring-match anything short. Character 4-grams sidestep
// needing a real Thai word-segmentation dictionary: any 4-character run
// shared between the question and a section counts as a (weak) signal.
function charNgrams(text, n = 4) {
  const chars = Array.from(text.toLowerCase().replace(/\s+/g, ' '));
  const grams = new Set();
  for (let i = 0; i + n <= chars.length; i++) grams.add(chars.slice(i, i + n).join(''));
  return grams;
}

function scoreSection(words, questionGrams, section) {
  const haystack = `${section.heading} ${section.body}`.toLowerCase();
  const wordScore = words.reduce((score, w) => score + (haystack.includes(w) ? 1 : 0), 0);

  const sectionGrams = charNgrams(haystack);
  let gramScore = 0;
  for (const g of questionGrams) if (sectionGrams.has(g)) gramScore++;

  // Word matches are a much stronger signal (a real shared term) than a
  // single shared 4-gram (could be coincidental), so they dominate the sum;
  // n-grams mostly matter when word matching found nothing at all.
  return wordScore * 4 + gramScore;
}

function findRelevantSections(question, markdown, maxSections = 2) {
  const words = significantWords(question);
  const questionGrams = charNgrams(question);
  if (!words.length && !questionGrams.size) return [];

  return parseSections(markdown)
    .map((s) => ({ ...s, score: scoreSection(words, questionGrams, s) }))
    // A real word match alone already scores 4 (wordScore * 4); this floor
    // mainly guards the n-gram-only path from single coincidental overlaps.
    .filter((s) => s.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSections);
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
