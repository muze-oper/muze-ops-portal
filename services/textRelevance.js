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

// wordScore counts real shared terms (strong signal); gramScore counts
// coincidental character overlap (weak signal, mainly useful for unspaced
// Thai sentences where word tokenization found nothing at all).
function scoreText(words, questionGrams, targetText) {
  const haystack = targetText.toLowerCase();
  const wordScore = words.reduce((score, w) => score + (haystack.includes(w) ? 1 : 0), 0);

  const targetGrams = charNgrams(haystack);
  let gramScore = 0;
  for (const g of questionGrams) if (targetGrams.has(g)) gramScore++;

  return { wordScore, gramScore, total: wordScore * 4 + gramScore };
}

// A single real word match (wordScore >= 1) is trustworthy on its own.
// Without any word match, character overlap needs to clear a much higher
// bar before counting as relevant — a handful of coincidental 4-grams
// between two unrelated Thai sentences is common and was previously
// surfacing unrelated entries (e.g. 2-3 stray grams outscoring nothing).
function isRelevant({ wordScore, gramScore }) {
  return wordScore >= 1 || gramScore >= 8;
}

module.exports = { significantWords, charNgrams, scoreText, isRelevant };
