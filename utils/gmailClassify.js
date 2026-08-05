const drive = require('../storage/googleDrive');

// Ported from muze-email-digest/live.js — kept in sync manually, there's no
// shared package between the two repos.
const IMPORTANT_KEYWORDS = [
  'urgent','ด่วน','asap','critical','error','failed','ล้มเหลว',
  'action required','deadline','due','ครบกำหนด','approve','อนุมัติ',
  'invoice','payment','ชำระ','meeting','ประชุม','issue','bug',
];

const CAT_LABEL = { action: '🔴 ต้อง Action', mustRead: '🟡 ควรรับรู้', auto: '⚪ แจ้งเตือนอัตโนมัติ' };

function applyTrainingRule(subject, from, rules) {
  for (const rule of rules) {
    if (!rule.applyToSimilar) continue;
    const fromMatch = !rule.from || from.toLowerCase().includes(rule.from.toLowerCase());
    const kwMatch   = !rule.subjectKeyword || subject.toLowerCase().includes(rule.subjectKeyword.toLowerCase());
    if (fromMatch && kwMatch) return rule.category;
  }
  return null;
}

// The portal already has trainingrules.json in Drive — reads it directly
// instead of round-tripping through an HTTP endpoint like live.js has to.
async function loadTrainingRules() {
  const data = await drive.readFile('trainingrules.json').catch(() => null);
  return data?.rules || [];
}

function classify(subject, snippet, from, rules) {
  const trained = applyTrainingRule(subject, from, rules);
  if (trained) return trained;
  const text = (subject + ' ' + snippet).toLowerCase();
  if (IMPORTANT_KEYWORDS.some(k => text.includes(k))) return 'action';
  if (from.includes('jira') || from.includes('notification') || from.includes('noreply')) return 'auto';
  return 'mustRead';
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2,'0')}${months[d.getMonth()]}${String(d.getFullYear()).slice(-2)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// Bangkok timezone helpers — see live.js for the full rationale (Gmail's own
// after:/before: day boundary was confirmed NOT to be Bangkok-local, so every
// caller must query a wide net and then filter precisely by internalDate
// against an exact Bangkok-midnight cutoff computed here).
function bangkokDateParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day };
}

// Bangkok has a fixed UTC+7 offset (no DST), so its local midnight is always
// exactly 7 hours before the UTC instant of the same calendar date.
function bangkokMidnightUTC(date = new Date()) {
  const p = bangkokDateParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - 7 * 3600 * 1000);
}

function gmailQueryYMD(date) {
  const p = bangkokDateParts(date);
  return `${p.year}/${String(p.month).padStart(2,'0')}/${String(p.day).padStart(2,'0')}`;
}

module.exports = {
  CAT_LABEL, loadTrainingRules, classify, formatDate,
  bangkokDateParts, bangkokMidnightUTC, gmailQueryYMD,
};
