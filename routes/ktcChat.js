const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { searchKtcCases, formatIssueRaw } = require('../services/jiraKtc');
const { findRelevantSections } = require('../services/ktcHandoverSearch');

const HANDOVER_DOC = fs.readFileSync(path.join(__dirname, '..', 'data', 'ktc-handover.md'), 'utf8');
const JIRA_SITE = (process.env.JIRA_BASE_URL || 'https://mymuze.atlassian.net').replace(/\/$/, '');

router.get('/ktc-chat', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'ktc-chat.html'));
});

// No LLM involved by design (avoids a per-query Anthropic API cost) — this
// searches Jira + the handover doc and shows the raw matches for a human to
// read and adapt, rather than synthesizing a ready-to-send answer.
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

  const docSections = findRelevantSections(question, HANDOVER_DOC, 2);

  if (!issues.length && !docSections.length) {
    return res.json({
      answer: 'ไม่พบเคสก่อนหน้าที่เกี่ยวข้องกับคำถามนี้ ทั้งใน Jira (project KTC) และ Handover Document\n\nแนะนำให้เปิดเคสใหม่ใน Jira เพื่อให้ทีมตรวจสอบเพิ่มเติม',
      sources: [],
    });
  }

  const parts = [];
  if (docSections.length) {
    parts.push('**หัวข้อที่เกี่ยวข้องใน Handover Document**');
    parts.push(...docSections.map((s) => `**${s.heading}**\n${s.body}`));
  }
  if (issues.length) {
    parts.push('**เคสใน Jira ที่ใกล้เคียงที่สุด**');
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
