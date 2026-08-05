const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { searchKtcCases, formatIssueRaw } = require('../services/jiraKtc');
const { findRelevantSections, splitRootCauseResolution } = require('../services/ktcHandoverSearch');

const HANDOVER_DOC = fs.readFileSync(path.join(__dirname, '..', 'data', 'ktc-handover.md'), 'utf8');
const JIRA_SITE = (process.env.JIRA_BASE_URL || 'https://mymuze.atlassian.net').replace(/\/$/, '');

router.get('/ktc-chat', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'ktc-chat.html'));
});

// No LLM involved by design (avoids a per-query Anthropic API cost). Instead
// of a flat dump of whatever matched, the top handover-doc match's own
// Resolution text is surfaced first as the recommendation — that text was
// already written as "what to do", it just wasn't being led with. Everything
// else (other matches, raw Jira cases) follows as supporting reference.
router.post('/api/ktc-chat', async (req, res) => {
  const question = (req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });

  let issues = [];
  try {
    issues = await searchKtcCases(question, 5);
  } catch (err) {
    console.error('[ktc-chat] Jira search failed:', err);
    return res.status(500).json({ error: `ค้นหาเคสใน Jira ไม่สำเร็จ: ${err.message}` });
  }

  const docSections = findRelevantSections(question, HANDOVER_DOC, 3);

  if (!issues.length && !docSections.length) {
    return res.json({
      answer: 'ไม่พบเคสก่อนหน้าที่เกี่ยวข้องกับคำถามนี้ ทั้งใน Jira (project KTC) และ Handover Document\n\nแนะนำให้เปิดเคสใหม่ใน Jira เพื่อให้ทีมตรวจสอบเพิ่มเติม',
      sources: [],
    });
  }

  const parts = [];
  const [topSection, ...restSections] = docSections;

  if (topSection) {
    const { rootCause, resolution } = splitRootCauseResolution(topSection.body);
    parts.push(`**เรื่องนี้ตรงกับ:** ${topSection.heading}`);
    parts.push(`**แนะนำให้ทำ**\n${resolution || rootCause}`);
    if (resolution) parts.push(`**สาเหตุ (Root Cause)**\n${rootCause}`);
  } else {
    parts.push('**หมายเหตุ:** ไม่พบหัวข้อสำเร็จรูปใน Handover Document สำหรับเรื่องนี้ — ลองพิจารณาจากเคส Jira ที่ใกล้เคียงด้านล่าง');
  }

  if (restSections.length) {
    parts.push('**หัวข้อใกล้เคียงอื่นๆ ใน Handover Document**');
    parts.push(...restSections.map((s) => `**${s.heading}**\n${s.body}`));
  }
  if (issues.length) {
    parts.push('**เคสใน Jira ที่ใกล้เคียงที่สุด (อ้างอิงประกอบ)**');
    parts.push(...issues.map(formatIssueRaw));
  }

  res.json({
    answer: parts.join('\n\n---\n\n'),
    sources: issues.map((i) => ({
      key: i.key,
      summary: i.fields?.summary || '',
      url: `${JIRA_SITE}/browse/${i.key}`,
    })),
  });
});

module.exports = router;
