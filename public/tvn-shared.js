// Shared across the three /tvn pages (Error Sessions, Top Error Codes,
// Crashlytics): generic helpers + the screenshot-insert box + the
// copy-table-as-image helper. Page-specific data/rendering logic stays in
// each page's own inline <script>.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function slug(platform) {
  return platform.toLowerCase().replace(/\s+/g, '-');
}

// --- Heatmap: two-part scale, split at 2.00% -----------------------------
// <=2.00%: green (0%) -> yellow (2.00%). >2.00%: light red (just over
// 2.00%) -> dark red (>=6.00%, the same ceiling the old single-gradient
// scale used). Used by the BitMovin Error Sessions hourly table.
const HEAT_SPLIT = 2.00;
const HEAT_MAX = 6.00;
const HEAT_GREEN = [46, 125, 50];
const HEAT_YELLOW = [230, 184, 0];
const HEAT_LIGHT_RED = [239, 154, 154];
const HEAT_DARK_RED = [136, 14, 14];

function heatLerpColor(c1, c2, t) {
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  return [r, g, b];
}

function heatColorForValue(value) {
  if (value === null || value === undefined || isNaN(value)) return null;
  const v = Math.max(0, value);
  const rgb = v <= HEAT_SPLIT
    ? heatLerpColor(HEAT_GREEN, HEAT_YELLOW, v / HEAT_SPLIT)
    : heatLerpColor(HEAT_LIGHT_RED, HEAT_DARK_RED, Math.min(1, (v - HEAT_SPLIT) / (HEAT_MAX - HEAT_SPLIT)));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// Picks readable text color (near-black or white) against a heatmap
// background by perceived luminance - the yellow/light-red mid-tones read
// better with dark text than the white used everywhere else in this scale.
function heatTextColorFor(rgbCss) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgbCss || '');
  if (!m) return '#fff';
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#16211D' : '#fff';
}

function heatLegendHtml() {
  const labels = ['0.00', '1.00', '2.00', '3.00', '4.00', '5.00', '≥6.00'];
  const values = [0, 1, 2, 3, 4, 5, 6];
  return `<div class="heat-legend">` + labels.map((label, i) => {
    const color = heatColorForValue(values[i]);
    return `
    <div class="heat-swatch">
      <div class="heat-box" style="background:${color}"></div>
      ${label}
    </div>
  `;
  }).join('') + `</div>`;
}

// ---- Screenshot-insert box: purely a visual reference while filling in
// values by hand or via a Claude Code chat - nothing here reads or
// analyzes the image, it just keeps it visible on screen. ----

function setupPasteArea(areaId) {
  const area = document.getElementById(areaId);
  if (!area || area.dataset.wired) return;
  area.dataset.wired = '1';

  area.addEventListener('click', (e) => {
    if (e.target.closest('.clear-btn')) return;
    if (!area.classList.contains('has-image')) area.focus();
  });

  area.addEventListener('paste', e => {
    const items = (e.clipboardData || window.clipboardData).items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        showPastedImage(area, item.getAsFile());
        e.preventDefault();
        return;
      }
    }
  });

  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('has-image'); });
  area.addEventListener('dragleave', () => { if (!area.dataset.hasImage) area.classList.remove('has-image'); });
  area.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) showPastedImage(area, file);
  });
}

function showPastedImage(area, file) {
  const reader = new FileReader();
  reader.onload = () => {
    area.dataset.hasImage = '1';
    area.classList.add('has-image');
    area.innerHTML = `<img src="${reader.result}" alt="screenshot ที่แนบไว้">
      <button type="button" class="btn-ghost clear-btn" onclick="clearPasteArea('${area.id}')">✕ ลบรูป</button>`;
  };
  reader.readAsDataURL(file);
}

function clearPasteArea(areaId) {
  const area = document.getElementById(areaId);
  if (!area) return;
  delete area.dataset.hasImage;
  area.classList.remove('has-image');
  area.innerHTML = '📋 คลิกที่นี่แล้ววาง (Ctrl/Cmd+V) หรือลากรูป screenshot มาวาง';
}

// ---- Copy a rendered table (or any element) to the clipboard as a PNG -
// used by the Error Sessions table and the Top Error Codes table. Uses
// PNG, not JPG, since the Clipboard API's ClipboardItem only reliably
// supports "image/png" across browsers - that's what actually ends up
// pasteable (into Discord, chat, docs, etc.). Requires a Chromium/Edge-
// class browser and a secure (HTTPS) context - both true for this portal
// in production. ----

async function copyElementAsImage(targetId, resultElId, btnId) {
  const btn = document.getElementById(btnId);
  const resultEl = document.getElementById(resultElId);
  const target = document.getElementById(targetId);

  if (!window.html2canvas) {
    resultEl.textContent = 'Error: โหลด html2canvas ไม่สำเร็จ (เช็คการเชื่อมต่ออินเทอร์เน็ต)';
    return;
  }
  if (!navigator.clipboard || !window.ClipboardItem) {
    resultEl.textContent = 'Error: เบราว์เซอร์นี้ไม่รองรับการ copy รูปภาพเข้า clipboard (ลองใช้ Chrome/Edge)';
    return;
  }

  btn.disabled = true;
  resultEl.textContent = 'กำลังสร้างรูปภาพ...';
  try {
    const canvas = await html2canvas(target, { backgroundColor: '#ffffff', scale: 2 });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('สร้างรูปภาพไม่สำเร็จ');

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    resultEl.textContent = 'Copy รูปภาพเข้า clipboard แล้ว - วาง (Ctrl/Cmd+V) ที่ไหนก็ได้';
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}
