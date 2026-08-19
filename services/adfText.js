// Minimal ADF (Atlassian Document Format) -> plain text converter.
// Jira REST API v3 returns description/comment bodies as ADF (a JSON doc
// tree), not plain strings — this walks the common node types well enough
// for support-ticket content (paragraphs, lists, headings, code, line
// breaks) and falls back to just concatenating text nodes for anything
// unrecognized, so it degrades gracefully instead of throwing.
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node; // already plain (e.g. a v2 fallback)

  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';

  const content = Array.isArray(node.content) ? node.content : [];
  const inner = content.map(adfToText).join('');

  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return `${inner}\n`;
    case 'listItem':
      return `- ${inner}\n`;
    case 'codeBlock':
      return `${inner}\n`;
    case 'doc':
      return inner;
    default:
      return inner;
  }
}

function extractText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return adfToText(field).replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { extractText };
