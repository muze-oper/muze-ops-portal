// The portal session is a 12h JWT, so an API call can come back 401 with
// {error:'unauthenticated'} in the middle of a form the user already filled
// in. Raw, that string tells them nothing and the obvious reaction - reload -
// throws away the CSV they picked and the table they just checked. So the
// message says what happened and points at a second tab, which keeps this
// page's state intact while they log back in.
async function fetchJson(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON body, handled below */ }
  if (res.status === 401 || data.error === 'unauthenticated') {
    throw new Error('เซสชันหมดอายุแล้ว — เปิด /login ในแท็บใหม่ เข้าสู่ระบบ แล้วกลับมากดอีกครั้ง (ข้อมูลในหน้านี้จะไม่หาย)');
  }
  if (data.error) throw new Error(data.error);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return data;
}

// Shared across the three /tvn pages (Error Sessions, Top Error Codes,
// Crashlytics): generic helpers + the screenshot-insert box + the
// copy-table-as-image helper. Page-specific data/rendering logic stays in
// each page's own inline <script>.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// "Thu-13-Aug" -> "Thu 13 Aug" for display only. The hyphenated form is the
// label the sheet stores and that rows are matched on, so never write this
// back or compare against it.
function prettyDate(label) {
  return String(label || '').replace(/-/g, ' ');
}

// "Thu-13-Aug" -> "Thu.13.Aug". Dots bind the parts into one token, so the
// date reads as a single unit in a narrow column where spaces would let it
// look like three separate words. Display only - never written back.
function compactDate(label) {
  return String(label || '').replace(/-/g, '.');
}

// Every percentage in these tables prints as "12.34%", whatever shape the
// sheet stored it in ("12.34", "12.34%", 12.3). Returns '' for anything
// non-numeric so callers can fall back to a dash.
function formatPct(value) {
  const n = parseFloat(String(value == null ? '' : value).replace('%', '').trim());
  return isNaN(n) ? '' : `${n.toFixed(2)}%`;
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

  // html2canvas captures the element's exact box, so without this the content
  // ends up flush against every edge of the PNG. The padding has to be on the
  // live element (not the clone) because the capture size is measured before
  // cloning - a clone-only change would just get cropped. Reverted below.
  const previousPadding = target.style.padding;
  target.style.padding = '18px 20px';

  try {
    // Read the surface from the tokens so a dark-mode export doesn't come out
    // with light text on a white background.
    const surface = getComputedStyle(document.body).getPropertyValue('--surface').trim() || '#ffffff';
    const canvas = await html2canvas(target, { backgroundColor: surface, scale: 2 });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('สร้างรูปภาพไม่สำเร็จ');

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    resultEl.textContent = 'Copy รูปภาพเข้า clipboard แล้ว - วาง (Ctrl/Cmd+V) ที่ไหนก็ได้';
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
  } finally {
    target.style.padding = previousPadding;
    btn.disabled = false;
  }
}
