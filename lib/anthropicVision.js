// Prototype -> real: reads a numeric % value off a Bitmovin/Crashlytics
// dashboard screenshot via Claude vision, for a human to review before it's
// written to the sheet (routes/tvn.js does the writing, this only reads).
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

const PROMPTS = {
  bitmovin: (platform) => `This is a screenshot from the Bitmovin analytics dashboard, showing an Error Session % chart for the platform "${platform}". Read the exact Error Session percentage value shown on the dashboard - use a precise numeric label or stat if one is visible, not the position of a line on a trend chart. Respond with that number as a plain percentage, e.g. 3.97 for "3.97%".`,
  crashlytics: (platform) => `This is a screenshot from the Firebase Crashlytics dashboard, showing the Crash-free Users % for the platform "${platform}". Read the exact Crash-free users percentage value shown - use the precise numeric stat, not the position of a line on the trend chart above it. Respond with that number as a plain percentage, e.g. 99.83 for "99.83%".`,
};

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('รูปภาพต้องเป็น data URL รูปแบบ image/* (เช่น ที่ได้จาก FileReader.readAsDataURL)');
  return { mediaType: match[1], data: match[2] };
}

async function readValueFromScreenshot({ tool, platform, imageDataUrl }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY ยังไม่ถูกตั้งค่า - เพิ่มใน .env (local) และ Vercel Environment Variables (production)');
  }
  const promptFn = PROMPTS[tool];
  if (!promptFn) throw new Error(`ไม่รู้จัก tool "${tool}" (ต้องเป็น "bitmovin" หรือ "crashlytics")`);
  if (!platform) throw new Error('ไม่ได้ระบุ platform');
  const { mediaType, data } = parseDataUrl(imageDataUrl);

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              value: { type: 'number', description: 'The percentage value read from the dashboard, e.g. 99.83' },
              note: { type: 'string', description: 'Any uncertainty or caveat about the reading, or an empty string if confident' },
            },
            required: ['value', 'note'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: promptFn(platform) },
          ],
        },
      ],
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error?.message || `Anthropic API error (HTTP ${response.status})`);
  }
  if (json.stop_reason === 'refusal') {
    throw new Error('Claude ปฏิเสธที่จะอ่านภาพนี้ - ลองภาพอื่น หรือครอปเฉพาะส่วนกราฟ/สถิติ');
  }

  const textBlock = (json.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('ไม่ได้รับข้อความตอบกลับจาก Claude');

  const parsed = JSON.parse(textBlock.text);
  return { value: parsed.value, note: parsed.note || '' };
}

module.exports = { readValueFromScreenshot };
