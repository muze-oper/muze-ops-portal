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
// of a flat dump of whatever matched, the single strongest match — Jira and
// the handover doc are scored on the same scale (services/textRelevance) —
// is surfaced first as "what to do". An exact/near-exact Jira hit is
// concrete, specific evidence and should lead over a merely topical doc
// entry, not get buried under one just because doc sections are listed
// first in the response shape. Everything else follows as supporting
// reference.
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

  const topDocScore = docSections[0]?.score || 0;
  const topIssueScore = issues[0]?.__score || 0;
  const leadWithJira = topIssueScore > topDocScore;

  const parts = [];

  if (leadWithJira) {
    const [topIssue, ...restIssues] = issues;
    parts.push(`**เรื่องนี้ตรงกับเคส Jira:** ${topIssue.key}`);
    parts.push(formatIssueRaw(topIssue));
    if (docSections.length) {
      parts.push('**หัวข้อใกล้เคียงใน Handover Document (อ้างอิงประกอบ)**');
      parts.push(...docSections.map((s) => `**${s.heading}**\n${s.body}`));
    }
    if (restIssues.length) {
      parts.push('**เคส Jira ใกล้เคียงอื่นๆ**');
      parts.push(...restIssues.map(formatIssueRaw));
    }
  } else {
    const [topSection, ...restSections] = docSections;
    const { rootCause, resolution } = splitRootCauseResolution(topSection.body);
    parts.push(`**เรื่องนี้ตรงกับ:** ${topSection.heading}`);
    parts.push(`**แนะนำให้ทำ**\n${resolution || rootCause}`);
    if (resolution) parts.push(`**สาเหตุ (Root Cause)**\n${rootCause}`);
    if (restSections.length) {
      parts.push('**หัวข้อใกล้เคียงอื่นๆ ใน Handover Document**');
      parts.push(...restSections.map((s) => `**${s.heading}**\n${s.body}`));
    }
    if (issues.length) {
      parts.push('**เคสใน Jira ที่ใกล้เคียงที่สุด (อ้างอิงประกอบ)**');
      parts.push(...issues.map(formatIssueRaw));
    }
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
