// Shared relevance scoring used by both the handover-doc matcher and the
// Jira result filter — kept in one place so "what counts as relevant
// enough to show" is a single decision, not two copies that can drift.

// Common function words that show up in nearly every entry and would
// otherwise dominate the score regardless of topic — e.g. "แล้ว" (already)
// matching everything made an unrelated entry outscore the real match in
// testing. Filtering these out lets the actual topic words (redirect,
// cache, CRV, Facebook...) decide the ranking instead.
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
// shared between the question and a target counts as a (weak) signal.
function charNgrams(text, n = 4) {
  const chars = Array.from(text.toLowerCase().replace(/\s+/g, ' '));
  const grams = new Set();
  for (let i = 0; i + n <= chars.length; i++) grams.add(chars.slice(i, i + n).join(''));
  return grams;
}

// wordScore counts real shared terms (strong signal). gramScore is meant to
// be a SEPARATE, additional signal — mainly for unspaced Thai clauses the
// word tokenizer couldn't break up at all — not just the same matched
// word's own characters restated as n-grams. Without masking, a single
// shared word like "landing" (itself a 7-character run) generates enough
// overlapping 4-grams on its own to look like strong independent evidence,
// letting one weak word match sneak back in twice under different names.
// Masking matched words out of the question before computing grams keeps
// gramScore honestly measuring only the leftover, un-tokenized text.
function scoreText(words, questionText, targetText) {
  const haystack = targetText.toLowerCase();
  const matchedWords = words.filter((w) => haystack.includes(w));
  const wordScore = matchedWords.length;

  let residual = questionText.toLowerCase();
  for (const w of matchedWords) residual = residual.split(w).join(' ');

  const residualGrams = charNgrams(residual);
  const targetGrams = charNgrams(haystack);
  let gramScore = 0;
  for (const g of residualGrams) if (targetGrams.has(g)) gramScore++;

  return { wordScore, gramScore, total: wordScore * 4 + gramScore };
}

// A single shared word isn't enough on its own — this corpus is all KTC
// website support tickets, so plenty of unrelated tickets share one generic
// domain word ("landing", "page", "form", "code") without being about the
// same issue at all. Requiring 2+ distinct shared words, OR one word plus
// genuinely separate corroborating overlap in the rest of the sentence
// (gramScore, now measured only on the un-matched residual — see above),
// cuts that noise while still passing genuine matches.
function isRelevant({ wordScore, gramScore }) {
  return wordScore >= 2 || gramScore >= 9;
}

module.exports = { significantWords, charNgrams, scoreText, isRelevant };
