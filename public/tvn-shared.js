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

// --- Heatmap: 10 shades from dark green (<=2.00%) to red (>=6.00%) -----
// Level 0 = <=HEAT_MIN exactly (a flat "good" floor, not part of the even
// split), level 9 = >=HEAT_MAX (flat "bad" ceiling), levels 1-8 split the
// range between them into 8 equal 0.5-point bins. Only the Error Sessions
// page uses this, but it's harmless to load everywhere.
const HEAT_MIN = 2.00;
const HEAT_MAX = 6.00;
const HEAT_STEPS = 10;
const HEAT_GREEN = [11, 110, 47];
const HEAT_RED = [197, 42, 42];

function heatLevel(value) {
  if (value <= HEAT_MIN) return 0;
  if (value >= HEAT_MAX) return HEAT_STEPS - 1;
  const step = (HEAT_MAX - HEAT_MIN) / (HEAT_STEPS - 2); // 8 intermediate bins
  return 1 + Math.floor((value - HEAT_MIN) / step);
}

function heatColorForLevel(level) {
  const t = level / (HEAT_STEPS - 1);
  const r = Math.round(HEAT_GREEN[0] + (HEAT_RED[0] - HEAT_GREEN[0]) * t);
  const g = Math.round(HEAT_GREEN[1] + (HEAT_RED[1] - HEAT_GREEN[1]) * t);
  const b = Math.round(HEAT_GREEN[2] + (HEAT_RED[2] - HEAT_GREEN[2]) * t);
  return `rgb(${r},${g},${b})`;
}

function heatColorForValue(value) {
  if (value === null || value === undefined || isNaN(value)) return null;
  return heatColorForLevel(heatLevel(value));
}

function heatLegendHtml() {
  const labels = ['≤2.00', '2.00-2.50', '2.50-3.00', '3.00-3.50', '3.50-4.00', '4.00-4.50', '4.50-5.00', '5.00-5.50', '5.50-6.00', '≥6.00'];
  return `<div class="heat-legend">` + labels.map((label, i) => `
    <div class="heat-swatch">
      <div class="heat-box" style="background:${heatColorForLevel(i)}"></div>
      ${label}
    </div>
  `).join('') + `</div>`;
}

// Reads whatever's typed in a cell (accepts "2.07" or "2.07%") and applies
// the matching heatmap color live, so it updates as the user edits - not
// just on initial render. Only used on the Error Sessions page.
function applyCellColor(input) {
  const numeric = parseFloat(String(input.value).replace('%', '').trim());
  const color = heatColorForValue(numeric);
  if (color) {
    input.style.backgroundColor = color;
    input.style.color = '#fff';
    input.style.borderColor = color;
  } else {
    input.style.backgroundColor = '';
    input.style.color = '';
    input.style.borderColor = '';
  }
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
