// Muze TDG Dashboard — Code_true.gs
// Deploy: Execute as "Me", Access "Anyone within muze.co.th"

// ⚠️ ใส่ Gemini API Key ที่นี่ (สร้างใหม่จาก aistudio.google.com)
var GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE';
var GEMINI_MODEL   = 'gemini-2.0-flash';
var CACHE_TTL      = 180; // 3 นาที

var TDG_QUERY = 'to:support-tvn@muze.co.th OR cc:support-tvn@muze.co.th OR from:support-tvn@muze.co.th';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index_true')
    .setTitle('Muze TDG Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---- TDG Threads ----
function getThreads(query, start) {
  try {
    var MAX = 50;
    var startVal = start || 0;
    if (startVal === 0) {
      var cache = CacheService.getUserCache();
      var cacheKey = 'threads_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, query)
        .map(function(b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2,'0'); }).join('');
      var cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }
    var threads = GmailApp.search(query, startVal, MAX);
    var result = [];
    for (var i = 0; i < threads.length; i++) {
      var t = threads[i];
      var msgs = t.getMessages();
      var last = msgs[msgs.length - 1];
      result.push({
        id:       t.getId(),
        isUnread: t.isUnread(),
        subject:  t.getFirstMessageSubject(),
        sender:   last.getFrom(),
        snippet:  last.getPlainBody().substring(0, 150),
        date:     last.getDate().toISOString(),
        msgCount: msgs.length
      });
    }
    var payload = { threads: result, hasMore: threads.length === MAX, nextStart: startVal + threads.length };
    if (startVal === 0) {
      try { CacheService.getUserCache().put(cacheKey, JSON.stringify(payload), CACHE_TTL); } catch(e) {}
    }
    return payload;
  } catch(e) { return { error: e.message, threads: [] }; }
}

// ---- Thread Body (for TDG Chat) ----
function getThreadBody(threadId) {
  try {
    var cache = CacheService.getUserCache();
    var cacheKey = 'body_' + threadId;
    var cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
    var thread = GmailApp.getThreadById(threadId);
    if (!thread) return { error: 'Thread not found' };
    var msgs = thread.getMessages();
    var last = msgs[msgs.length - 1];
    var payload = { subject: thread.getFirstMessageSubject(), msgCount: msgs.length, body: last.getPlainBody() };
    try { cache.put(cacheKey, JSON.stringify(payload), CACHE_TTL); } catch(e) {}
    return payload;
  } catch(e) { return { error: e.message }; }
}

// ---- Gemini AI (multi-turn) ----
function askGemini(messages, emailContext) {
  try {
    var systemPrompt = 'คุณเป็น AI ผู้ช่วยสำหรับทีม Muze Innovation ที่ดูแล True Digital Group (TDG) support\n'
      + 'หน้าที่: ช่วยวิเคราะห์ปัญหาใน Zendesk tickets, แนะนำขั้นตอนการตรวจสอบและแก้ไข, สรุปสถานะ tickets\n'
      + 'ตอบเป็นภาษาไทยเสมอ ยกเว้นคำศัพท์เทคนิคที่ควรเป็นภาษาอังกฤษ\n'
      + 'ตอบกระชับและตรงประเด็น';
    if (emailContext) {
      systemPrompt += '\n\n--- ข้อมูล TDG tickets/email ปัจจุบัน ---\n' + emailContext + '\n---';
    }

    var contents = messages.map(function(m) {
      return { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] };
    });

    var res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + GEMINI_API_KEY,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: contents,
          generationConfig: { temperature: 0.5, maxOutputTokens: 1500 }
        }),
        muteHttpExceptions: true
      }
    );

    var data = JSON.parse(res.getContentText());
    if (data.error) return { error: data.error.message };
    if (!data.candidates || !data.candidates[0]) return { error: 'ไม่ได้รับคำตอบจาก AI' };
    return { text: data.candidates[0].content.parts[0].text };
  } catch(e) { return { error: e.message }; }
}

// ---- Current User ----
function getCurrentUser() {
  try {
    var email = '';
    var threads = GmailApp.search('in:sent', 0, 1);
    if (threads.length > 0) {
      var from = threads[0].getMessages()[0].getFrom();
      var m = from.match(/<([^>]+)>/);
      email = m ? m[1] : from.trim();
    }
    if (!email) email = Session.getEffectiveUser().getEmail();
    var name = email ? email.replace(/@.*$/, '').replace(/[._]/g, ' ').trim() : 'User';
    name = name.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    return { email: email, name: name };
  } catch(e) { return { email: '', name: 'User' }; }
}

function markAsRead(threadId) {
  try {
    var t = GmailApp.getThreadById(threadId);
    if (t) t.markRead();
    return { success: true };
  } catch(e) { return { error: e.message }; }
}

// ---- Debug: รันจาก editor เพื่อดู log ----
function debugKBData() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('tvs_kb_v1');
  console.log('cached: ' + (cached === null ? 'null' : 'len=' + cached.length));

  if (cached) {
    try {
      var parsed = JSON.parse(cached);
      console.log('parsed entries: ' + parsed.length);
    } catch(e) {
      console.log('JSON.parse error: ' + e.message);
    }
  }

  try {
    var res = UrlFetchApp.fetch('https://muze-ops-portal.vercel.app/tvs-error-code-kb', { muteHttpExceptions: true });
    console.log('HTTP status: ' + res.getResponseCode());
    var html = res.getContentText();
    console.log('HTML length: ' + html.length);
    var m = html.match(/let DATA\s*=\s*(\[[\s\S]*?\]);\s*(?:const|var|let|\/\/)/);
    console.log('dataMatch: ' + (m ? 'FOUND len=' + m[1].length : 'NOT FOUND'));
  } catch(e) {
    console.log('fetch error: ' + e.message);
  }
}

// ---- TVS KB Cache Pre-warm ----
// รันครั้งเดียวจาก GAS Editor เพื่อตั้ง trigger
function setupKBCacheTrigger() {
  // ลบ trigger เก่าชื่อ warmKBCache ออกก่อน (ป้องกันซ้ำ)
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'warmKBCache') ScriptApp.deleteTrigger(t);
  });
  // สร้าง trigger ใหม่ ทุก 5 ชั่วโมง
  ScriptApp.newTrigger('warmKBCache')
    .timeBased()
    .everyHours(5)
    .create();
  Logger.log('✅ TVS KB trigger set: warmKBCache every 5 hours');
}

// ฟังก์ชันที่ trigger เรียก — แค่ pre-fetch เพื่อ warm cache
function warmKBCache() {
  CacheService.getScriptCache().remove('tvs_kb_v1'); // clear เพื่อ force refresh
  getKBData();
  Logger.log('TVS KB cache warmed: ' + new Date());
}

// ---- TVS Error KB (muze-ops-portal.vercel.app) ----
// Cache 6 ชั่วโมง ใน ScriptCache (shared ทุก user)
function getKBData() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('tvs_kb_v1');
  if (cached) {
    var parsed = JSON.parse(cached);
    Logger.log('Cache hit: ' + parsed.length + ' entries');
    return parsed;
  }
  try {
    var html = UrlFetchApp.fetch('https://muze-ops-portal.vercel.app/tvs-error-code-kb', {
      muteHttpExceptions: true,
      followRedirects: true
    }).getContentText();

    // ดึง DATA array ออกจาก inline <script>
    var dataMatch = html.match(/let DATA\s*=\s*(\[[\s\S]*?\]);\s*(?:const|var|let|\/\/)/);
    if (!dataMatch) return [];

    var raw = dataMatch[1];
    var entries = [];

    // parse ทีละ entry: {n, code, cats, title, cause, wa, note?}
    var entryReg = /\{n:\d+,code:"([^"]+)",cats:\[[^\]]*\],title:"([^"]+)",cause:"([^"]+)",wa:\[([\s\S]*?)\](?:,note:"([^"]*)")?\s*\}/g;
    var m;
    while ((m = entryReg.exec(raw)) !== null) {
      // strip HTML tags จาก wa items
      var waItems = [];
      var waItemReg = /"((?:[^"\\]|\\.)*)"/g;
      var wi;
      while ((wi = waItemReg.exec(m[4])) !== null) {
        var item = wi[1].replace(/<[^>]+>/g, '').replace(/\\n/g, '\n').trim();
        if (item) waItems.push(item);
      }
      entries.push({
        code:  m[1],
        title: m[2],
        cause: m[3],
        wa:    waItems,
        note:  m[5] || ''
      });
    }

    Logger.log('Fetched: ' + entries.length + ' entries');
    if (entries.length > 0) {
      try { cache.put('tvs_kb_v1', JSON.stringify(entries), 21600); } catch(e) {}
    } else {
      Logger.log('Parse failed — dataMatch: ' + (dataMatch ? 'found' : 'not found'));
    }
    return entries;
  } catch(e) {
    Logger.log('Error: ' + e.message);
    return [];
  }
}