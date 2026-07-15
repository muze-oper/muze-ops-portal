const router = require('express').Router();
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const drive = require('../storage/googleDrive');

const PLANNER_SECRET = process.env.PLANNER_SECRET;
const TOTAL_SLOTS = 49; // 06:00-18:00 inclusive, 15-min steps

// Vercel functions run in UTC - compute "today" explicitly in Asia/Bangkok
// (this gateway is muze.co.th-only) rather than the UTC calendar date.
function todayStr() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()); }

function scheduleFilename(email, date) { return `planner_schedule__${email}__${date}.json`; }
function cellsFilename(email, date) { return `planner_cells__${email}__${date}.json`; }
function todosFilename(email) { return `planner_todos__${email}.json`; }
function projectsFilename(email) { return `planner_projects__${email}.json`; }

function slotIndexToTime(idx) {
  const totalMinutes = idx * 15 + 6 * 60;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToSlotIndex(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return Math.floor((h * 60 + m - 6 * 60) / 15);
}

function fmtBangkokTime(isoString) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(isoString));
}

// Builds the same 49-slot schedule shape the frontend renders, from raw
// Google Calendar events (see daily-planner-generator/SKILL.md for the
// hand-authored equivalent this mirrors).
function buildSlotsFromEvents(events) {
  const slots = [];
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const time = slotIndexToTime(i);
    const isLunch = time >= '12:00' && time <= '12:45';
    slots.push({
      time, hourMark: time.endsWith(':00'), hasEvent: false, lunch: isLunch,
      eventLabel: isLunch && time === '12:00' ? 'Lunch Break' : null,
      eventType: isLunch ? 'lunch' : null,
      note: isLunch && time === '12:00' ? '12:00–13:00' : null,
      noteFixed: isLunch,
    });
  }

  for (const ev of events) {
    const startIso = ev.start && ev.start.dateTime;
    const endIso = ev.end && ev.end.dateTime;
    if (!startIso || !endIso) continue; // skip all-day events (date-only, no dateTime)

    const startHHMM = fmtBangkokTime(startIso);
    const endHHMM = fmtBangkokTime(endIso);
    if (startHHMM < '06:00' || startHHMM >= '18:00') continue; // outside the planner window

    let startIdx = Math.max(0, Math.min(timeToSlotIndex(startHHMM), TOTAL_SLOTS - 1));
    // endHHMM is the slot where the event *begins* to be free, so subtract 1
    let endIdx = endHHMM <= startHHMM ? startIdx : Math.min(timeToSlotIndex(endHHMM) - 1, TOTAL_SLOTS - 1);
    endIdx = Math.max(startIdx, endIdx);

    const label = ev.summary || '(no title)';
    const platform = ev.hangoutLink || ev.conferenceData ? 'Google Meet' : (ev.location || 'Onsite');

    for (let i = startIdx; i <= endIdx; i++) {
      const slot = slots[i];
      slot.hasEvent = true;
      slot.lunch = false;
      slot.eventLabel = label;
      if (i === startIdx) {
        slot.eventType = 'start';
        slot.note = startIdx === endIdx ? `ถึง ${endHHMM}` : `${startHHMM}–${endHHMM} · ${platform}`;
        slot.noteFixed = true;
      } else if (i === endIdx) {
        slot.eventType = 'cont';
        slot.note = `ถึง ${endHHMM}`;
        slot.noteFixed = true;
      } else {
        slot.eventType = 'cont';
        slot.note = null;
        slot.noteFixed = false;
      }
    }
  }
  return slots;
}

async function fetchTodaysCalendarEvents(refreshToken) {
  if (!refreshToken) {
    const err = new Error('No Calendar access on this session - log out and back in to grant it');
    err.code = 'NO_CALENDAR_ACCESS';
    throw err;
  }

  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();

  const date = todayStr();
  const timeMin = new Date(`${date}T06:00:00+07:00`).toISOString();
  const timeMax = new Date(`${date}T18:00:00+07:00`).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true&orderBy=startTime`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Calendar API ${res.status}:`, body);
    throw new Error(`Calendar API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const items = data.items || [];
  // exclude events the user has explicitly declined
  return items.filter(ev => {
    if (!ev.attendees) return true; // no attendees list = organizer/sole invitee, keep it
    const me = ev.attendees.find(a => a.self === true);
    return !me || me.responseStatus !== 'declined';
  });
}

// POST /api/planner — no SSO, protected by shared secret.
// Pushed by the external daily-planner generator with that day's
// calendar-derived schedule for a given user.
router.post('/api/planner', async (req, res) => {
  const secret = req.headers['x-planner-secret'];
  if (secret !== PLANNER_SECRET) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { email, date, slots } = req.body;
    if (!email || !date || !Array.isArray(slots)) {
      return res.status(400).json({ error: 'email, date, slots required' });
    }
    await drive.writeFile(scheduleFilename(email, date), { date, slots, generatedAt: new Date().toISOString() });
    console.log(`Planner schedule stored: ${email} ${date}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Planner store error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Everything below requires a valid gateway session (mounted after requireAuth)

// GET /api/planner/schedule?date=YYYY-MM-DD
router.get('/api/planner/schedule', async (req, res) => {
  try {
    const date = req.query.date || todayStr();
    const data = await drive.readFile(scheduleFilename(req.user.email, date));
    res.json(data || { date, slots: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/planner/cells?date=YYYY-MM-DD — per-day free-text edits (task/note columns)
router.get('/api/planner/cells', async (req, res) => {
  try {
    const date = req.query.date || todayStr();
    const data = await drive.readFile(cellsFilename(req.user.email, date));
    res.json(data || { date, cells: {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/planner/cells', async (req, res) => {
  try {
    const { date, cells } = req.body;
    if (!date || typeof cells !== 'object') return res.status(400).json({ error: 'date, cells required' });
    await drive.writeFile(cellsFilename(req.user.email, date), { date, cells });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET/POST /api/planner/todos — running to-do list, not date-scoped
router.get('/api/planner/todos', async (req, res) => {
  try {
    const data = await drive.readFile(todosFilename(req.user.email));
    res.json(data || { todos: [], lastMondayCleanup: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/planner/todos', async (req, res) => {
  try {
    const { todos, lastMondayCleanup } = req.body;
    if (!Array.isArray(todos)) return res.status(400).json({ error: 'todos required' });
    await drive.writeFile(todosFilename(req.user.email), { todos, lastMondayCleanup: lastMondayCleanup || null });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET/POST /api/planner/projects — projects a to-do can link to, each with
// its own checklist of sub-items (e.g. "จัดระเบียบกรงแมว" -> ย้ายชั้นวาง, ...)
router.get('/api/planner/projects', async (req, res) => {
  try {
    const data = await drive.readFile(projectsFilename(req.user.email));
    res.json(data || { projects: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/planner/projects', async (req, res) => {
  try {
    const { projects } = req.body;
    if (!Array.isArray(projects)) return res.status(400).json({ error: 'projects required' });
    await drive.writeFile(projectsFilename(req.user.email), { projects });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/planner/run — pull today's events straight from the logged-in
// user's own Google Calendar and store them as today's schedule, on demand
// (the "Run" button), instead of waiting for the 6am scheduled push.
router.post('/api/planner/run', async (req, res) => {
  try {
    const events = await fetchTodaysCalendarEvents(req.user.refreshToken);
    const slots = buildSlotsFromEvents(events);
    const date = todayStr();
    await drive.writeFile(scheduleFilename(req.user.email, date), { date, slots, generatedAt: new Date().toISOString() });
    res.json({ ok: true, date, slots });
  } catch (err) {
    if (err.code === 'NO_CALENDAR_ACCESS') {
      return res.status(409).json({ error: 'no_calendar_access', message: err.message });
    }
    console.error('Planner run error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /planner — serve viewer page
router.get('/planner', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'planner.html'));
});

module.exports = router;
