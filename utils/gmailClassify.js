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

// Must be Bangkok-explicit, not host-local Date getters — this runs on the
// portal's Vercel server (UTC), not the requester's machine, so d.getDate()/
// d.getHours() would silently shift every timestamp by 7 hours and, for
// anything before 07:00 Bangkok, onto the wrong calendar day entirely
// (confirmed: a message correctly filtered into a requested date range still
// displayed one calendar day earlier than the range's own start date).
function formatDate(dateStr) {
  const d = new Date(dateStr);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: '2-digit', month: 'numeric', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.day}${months[+p.month - 1]}${p.year} ${hour}:${p.minute}`;
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

// Gmail's body/attachment data is base64url (RFC 4648 URL-safe alphabet, no
// padding) - swap in the standard alphabet before handing it to Buffer.
function decodeBase64Url(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Walks a message's MIME parts for the body text - prefers text/plain,
// falls back to text/html (tags stripped), falls back to a non-multipart
// message's own top-level body. Only ever reads body.data (already inlined
// in the 'full' format response) - never calls attachments.get, so this
// can't accidentally pull a large attachment's bytes.
function extractBody(payload) {
  let plain = null, html = null;
  (function walk(part) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data && !plain) plain = decodeBase64Url(part.body.data);
    else if (part.mimeType === 'text/html' && part.body?.data && !html) html = decodeBase64Url(part.body.data);
    (part.parts || []).forEach(walk);
  })(payload);
  if (plain) return plain;
  if (html) return stripHtml(html);
  if (payload?.body?.data) return decodeBase64Url(payload.body.data);
  return '';
}

// Attachment METADATA only (filename/mimeType/size) - a part with a
// non-empty filename is an attachment in Gmail's MIME representation,
// regardless of whether format:'full' bothered to inline its body.data.
function extractAttachments(payload) {
  const attachments = [];
  (function walk(part) {
    if (!part) return;
    if (part.filename) attachments.push({ filename: part.filename, mimeType: part.mimeType || '', size: part.body?.size || 0 });
    (part.parts || []).forEach(walk);
  })(payload);
  return attachments;
}

module.exports = {
  CAT_LABEL, loadTrainingRules, classify, formatDate,
  bangkokDateParts, bangkokMidnightUTC, gmailQueryYMD,
  extractBody, extractAttachments,
};
