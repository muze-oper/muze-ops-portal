const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { searchKtcCases, formatIssueForContext } = require('../services/jiraKtc');
const { askClaude } = require('../services/anthropicClient');

const HANDOVER_DOC = fs.readFileSync(path.join(__dirname, '..', 'data', 'ktc-handover.md'), 'utf8');
const JIRA_SITE = (process.env.JIRA_BASE_URL || 'https://mymuze.atlassian.net').replace(/\/$/, '');

const SYSTEM_PROMPT = `คุณคือผู้ช่วยฝ่าย Support ของโปรเจกต์ KTC Website (Muze Innovation)
หน้าที่: อ่านคำถาม/ปัญหาที่ลูกค้าแจ้งเข้ามา แล้วตอบโดยอ้างอิงจาก "เคส Jira ที่เกี่ยวข้อง" และ "Handover Document" ที่แนบมาให้ในบริบทเท่านั้น

กติกา:
- ห้ามตอบจากความรู้ทั่วไปถ้าไม่มีบริบทด้านล่างรองรับ — ถ้าไม่พบเคสหรือเอกสารที่เกี่ยวข้องเลย ให้บอกตรงๆ ว่าไม่พบเคสก่อนหน้าที่เกี่ยวข้อง และแนะนำให้เปิดเคสใหม่ / ส่งต่อทีมพัฒนา อย่าเดาคำตอบเอง
- ตอบเป็นภาษาไทย กระชับ ใช้โครงสร้าง Markdown: **สรุปปัญหา**, **สาเหตุที่เป็นไปได้ (Root Cause)**, **วิธีแก้ไข/คำตอบที่แนะนำ**, **อ้างอิงเคส** (ระบุ Jira key เช่น KTC-123 หรือหัวข้อใน Handover Document ที่ใช้)
- ถ้าเคสที่เจอมี status/คอมเมนต์บ่งว่าแก้ถาวรไปแล้ว (เช่น deploy fix แล้ว) ให้ระบุด้วยว่าปัจจุบันแก้ไขถาวรแล้วหรือยังเป็นแค่ workaround ชั่วคราว
- ถ้าเป็นปัญหาระดับ Technical/Urgent (เช่น เว็บล่ม, timeout) ให้ระบุชัดว่าควร escalate ต่อทีมไหน`;

router.get('/ktc-chat', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'ktc-chat.html'));
});

router.post('/api/ktc-chat', async (req, res) => {
  const question = (req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });

  let issues = [];
  try {
    issues = await searchKtcCases(question, 8);
  } catch (err) {
    console.error('[ktc-chat] Jira search failed:', err);
    return res.status(500).json({ error: `ค้นหาเคสใน Jira ไม่สำเร็จ: ${err.message}` });
  }

  const context = [
    '## Handover Document (Operation Report)',
    HANDOVER_DOC,
    '',
    issues.length
      ? '## เคส Jira ที่เกี่ยวข้อง (ค้นจาก project KTC)'
      : '## เคส Jira ที่เกี่ยวข้อง\n(ไม่พบเคสที่ตรงกับคำถามนี้ใน Jira)',
    ...issues.map(formatIssueForContext),
  ].join('\n\n');

  try {
    const answer = await askClaude({
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `บริบท:\n\n${context}\n\n---\n\nคำถามจากลูกค้า:\n${question}` },
      ],
      maxTokens: 1500,
    });

    res.json({
      answer,
      sources: issues.map((i) => ({
        key: i.key,
        summary: i.fields?.summary || '',
        url: `${JIRA_SITE}/browse/${i.key}`,
      })),
    });
  } catch (err) {
    console.error('[ktc-chat] Claude synthesis failed:', err);
    res.status(500).json({ error: `สร้างคำตอบไม่สำเร็จ: ${err.message}` });
  }
});

module.exports = router;
