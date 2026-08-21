---
name: tvn-dashboard-reading
description: Reads Error Session % (Bitmovin), Crash-free Users % (Firebase Crashlytics), or a Bitmovin Top Error Codes ranked list off a pasted TrueVisions NOW dashboard screenshot, for logging into muze-ops-portal's /tvn page. Trigger whenever the user pastes/attaches a screenshot of a Bitmovin error-session chart, a Bitmovin Top Error Codes table, or a Firebase Crashlytics crash-free-users stat and asks for the value(s), or explicitly invokes this skill.
---

Read the exact numbers shown on the dashboard screenshot - never estimate
from the position of a line on a trend chart. A visual guess off a chart
line is meaningfully noisy at the sub-1%-precision this tracking needs;
always prefer a printed number/stat/badge/table row over eyeballing a curve.
This is not hypothetical: on Firebase Crashlytics specifically, the
"Crash-free users XX.XX%" headline tile and the last plotted point on the
"last 7 days" trend chart underneath it can be **different figures** (seen
in practice: 99.89% headline vs. 100.00% on that day's chart point) - the
headline tile is the number that gets recorded, never the chart line.

**Always say the axis floor out loud when reporting a trend/hourly chart
read** (instruction, 2026-08-21) - these Crash-free % charts almost never
start at 0%, typically `95-100%`. State that explicitly alongside the
numbers (e.g. "axis is 95-100%, not 0-100%"), not just as something you
privately account for - a reader looking at bare numbers later, with no
image and no context, can't tell a genuinely flat chart from a wildly
swinging one without knowing the scale, and a chart that "looks like a big
dip" on a 95-100% axis is a very different claim from the same shape on a
0-100% one.

## Step 1 - identify the tool and what kind of read this is

Look at the screenshot for which tool it is, and whether it's a single
stat or a ranked list:

- **Bitmovin - Error Session %** - a streaming-analytics dashboard, single
  metric "Error Session %".
- **Bitmovin - Top Error Codes** - a ranked table/list of error codes with
  a session count next to each one (e.g. `media3-exoplayer-1.10.1: 1002`
  with a session count). This is a **list read**, not a single value.
- **Firebase Crashlytics** - shows "Crash-free users", usually with a big
  percentage stat near a "Users" count and a trend line above it.
- **Firebase Crashlytics - full dashboard with an Issues table** - the same
  tool, but a wider screenshot that also shows a "Trends" panel (daily
  crash-count bar chart) and an **Issues** list below it (one row per crash
  type: title, package/file breadcrumb, badges like "Repetitive crashes" /
  "Early crashes" / "Fresh issue", a Versions range, and printed Events +
  Users counts). This is a **third read mode** - only read the **Issues**
  table when this shape shows up; leave the Trends bar chart alone unless
  asked for it specifically, it has no destination yet (see Step 3/4).

For the two single-stat tools, identify the platform from the visible
app/filter name (iOS, iOS Mobile, Android, Android Mobile, Apple TV,
Android TV, Tizen, LG, Vidaa).

**Crashlytics platform is often not visible at all** - a cropped
Crashlytics screenshot usually shows the "Versions" filter chip (e.g.
`Versions = "4.0.18 (55)" and 17 more`) but not the app/platform picker
above it, since that's typically cropped out of what gets pasted. When it
*is* visible, it reads `[PROD][TVS] TrueVisions NOW (iOS + tvOS)` for the
iOS-family app (confirmed) or something like `(Android + Android TV...)`
for the Android one (inferred from a truncated `(Android + An...)` sighting
- not yet seen in full) - this alone only tells you which **app** it is
(iOS-family vs Android-family), not which of the two platforms sharing it
(iOS Mobile / Apple TV, or Android Mobile / Android TV) - the app itself is
shared across both, so the picker can't separate them further.

To narrow it the rest of the way (or when the picker is cropped out
entirely), cross-check the version number in the Versions chip:

- Cross-check it against the "Version to Monitor" tables in
  /tvn/crashlytics's own Step 1 section (or `GET /api/app-releases`, which
  is what that section reads from) - each platform's Deploy Tag history is
  usually far enough apart from the others (e.g. Apple TV's builds have
  been seen trailing iOS Mobile/Android Mobile by ~9 minor versions) that
  the filtered version matches exactly one platform's recent-versions
  list.
- **This can still be ambiguous** - iOS Mobile and Android Mobile have
  been seen sharing the exact same version number (both on `4.0.27`),
  since they ship on the same release cadence. If the app/platform picker
  is visible, use it to settle Android-vs-iOS first, then the version
  number only needs to separate Mobile from TV within that OS - which the
  version string usually does on its own: **a `-tv` suffix marks the TV
  build** (seen in practice: `4.0.28-tv (1001)` for Android TV vs plain
  `4.0.27 (1)` for Android Mobile, both under the same Android app). If
  even that doesn't resolve it, say so and ask which platform it is rather
  than guessing between the two - don't default to either one.
- Say which platform you inferred and what made it unique (the picker
  text, the version string, or both), so it can be double-checked against
  the dropdown before syncing.

**⚠ Investigated 2026-08-19, likely resolved but not yet confirmed by the
team - still flag it if seen, but the explanation below is probably why:**
for the **Issues list** read specifically, a filter anchored on a plain
non-`-tv` version (e.g. `4.0.27 (1)`) was seen producing an Issues table
where individual rows' own Versions *ranges* were a mix of `-tv` and
non-`-tv` values (e.g. `SQLiteConnection.nativeExecute: 4.0.0-tv –
4.0.27-tv` next to `MainActivity.onUserLeaveHint: 4.0.6 – 4.0.27`), which
first looked like the read wasn't actually isolating Mobile from TV.

Opening the **Versions filter dropdown itself** (not just reading the
collapsed chip text) clarified this: it shows a per-version checkbox list
with each version's own event count (e.g. `4.0.27 ✓ 104 events`, `4.0.25 ✓
29 events`, `4.0.26-tv ☐ 33 events`, `4.0.24-tv ☐ 0 events`) - and in the
case that raised this, only the two non-`-tv` versions were actually
checked, with both `-tv` versions explicitly unchecked. So the filter
*was* Mobile-only. The likely explanation: a row's **Versions column is a
lifetime range** - "the oldest and newest version this exact crash
signature has ever been seen on," which is not re-scoped to the current
filter - while **Events/Users are live-scoped** to whatever's actually
checked. A crash type that occurs on both Mobile and TV builds will show a
`-tv`-inclusive lifetime range even when the current filter (and its
Events/Users counts) is Mobile-only. This isn't confirmed as the definite
mechanism, but it's consistent with everything seen so far.

**What this means for a read:** if the collapsed filter chip's platform
looks ambiguous, open the filter dropdown and check which specific
versions are ticked - that's the ground truth for what's actually being
counted, not the chip summary or a given row's Versions range. If the
checked versions are cleanly all-`-tv` or all-non-`-tv`, the read is
platform-isolated regardless of what individual rows' Versions ranges
show. Still flag it and ask if the checked list itself is a genuine mix of
`-tv` and non-`-tv` versions - that would be the real ambiguous case.

## Step 2 - sanity-check the filter before trusting the number(s)

A wrong filter gives a real-looking but wrong result - check this before
reading anything, not after:

- **Bitmovin (either read)**: confirm the OS + Platform filter shown
  matches the platform you're about to log (e.g. iOS Mobile = OS "iPadOS,
  iOS" + Platform "iOS"), and confirm the time window (e.g. "24 hours",
  "7 days") matches what's being asked for. If the filter looks like it's
  for a different platform/window or is unset, say so and ask before
  reading.
- **Firebase Crashlytics**: confirm the time range is "Last 7 days", and
  that the **Versions** filter is ticked to the current top ~3 builds still
  receiving traffic (not old retired versions, and not "all versions" -
  either skews the number). If the visible version list looks stale, flag it.

## Step 3 - read the value(s)

**Single-stat read (Bitmovin Error Session % / Crashlytics Crash-free %):**
Report:

- **Platform**
- **Value** - the exact number shown, to 2 decimal places if available
  (e.g. `99.83`, `3.97`). For Crashlytics this is the **headline tile**
  number specifically ("Crash-free users XX.XX%"), not a value read off
  the trend line below it - see the caution at the top of this skill.
- **Filter shown** - what OS/Platform/time-window (Bitmovin) or Versions
  (Crashlytics) filter was actually active, so the person entering it can
  double check it matches what they intended to check

**Trend read (Crashlytics "last 7 days" graph) - a distinct mode, only when
asked for the graph/week, not the day's single value:** the headline tile
rule above is for the one number that gets recorded into *today's* row via
the quick-entry dropdown - it does not apply here. `/tvn/crashlytics` also
has a **"Backfill ย้อนหลัง"** section specifically for this (added
2026-08-17): a paste box (`cr-backfill-paste`) that expects one line per day
in the shape `<Month> <day>  <value>` - e.g. `Aug 11  99.92` - parsed
client-side and synced as a batch to whichever platform is picked in its own
dropdown (`cr-backfill-platform`, separate from the quick-entry one). When
asked to read the trend chart itself, read every plotted day directly off
the line (never substitute the headline number for any of them) and answer
in this shape:

```
Platform: Apple TV
Aug 11	99.92
Aug 12	99.90
Aug 13	99.85
```

- Line 1, `Platform: <name>` (from the filter, Step 1, not the graph), is
  for the person reading your reply - it does **not** need to go into the
  paste box, since Backfill picks platform from its own dropdown; a stray
  `Platform:` line there is just silently skipped as unreadable, not
  harmful, but no need to tell them to include it.
- Every line after that is one plotted day, `<date>` then `<value>`
  (tab or spaces both parse fine), read from the chart line only.
- This axis is usually 95-100% (or similar) while the real values often sit
  in the top ~0.5 of that range, which makes reads noisier than they look -
  two verified comparisons on this exact chart type landed within about
  ±0.02-0.15, one running low on every point, the other mixed +/-, with no
  shared pattern between them (not even "flat near the ceiling reads low" -
  that held on one and was flatly contradicted on the other, same
  platform/shape/axis). Don't try to correct for a remembered bias from an
  earlier chart - flag every read as a real visual estimate, not a precise
  one, and say so plainly rather than presenting it as exact.
- If the same chart has already been read and verified against real
  tooltip/API values earlier in the conversation, reuse those verified
  numbers instead of re-estimating from the image - don't discard known
  ground truth in favor of a fresh guess.

**Hourly read (Crashlytics "last 24 hours" graph) - a third distinct
Crashlytics mode, separate from the 7-day Trend read above:** some
Crashlytics screenshots show "Crash-free users in last 24 hours" instead of
"...in last 7 days" - an hourly line chart (x-axis labelled every 3 hours,
e.g. `09:00AM 12:00PM 03:00PM ... 06:00AM`) alongside an separate "Trends"
panel with its own hourly *crash-count* bar chart - don't confuse the two;
only the Crash-free % line feeds this read.

**This is the default action for a "last 24 hours" screenshot, not an
optional extra** (instruction, 2026-08-21) - do the hourly read straight
away rather than reporting just the headline stat and asking whether an
hourly read is wanted too. The headline/Platform read is still worth
stating alongside it (Step 3's single-stat read), but the hourly numbers
are the point of pasting this particular chart shape.

**The chart's own tick labels shift from session to session** - one "last 24
hours" screenshot showed `09:00AM 12:00PM 03:00PM ... 06:00AM`, the next
(same platform, same nominal date range) showed `10:00AM 01:00PM 04:00PM ...
07:00AM` instead - a ~1 hour drift, presumably tied to whatever moment the
dashboard happened to load. This is *not* a fixed daily grid like the
BitMovin hourly heatmap's `10.00...9.00` columns - **always re-read the 8
hour labels actually printed on the current chart** rather than assuming
they match a previous read or a remembered header.

The destination sheet (`gid=0` on the main spreadsheet, header changed 3
times as of 2026-08-21 - always check the live sheet, don't trust this
example) has looked like `Sync Date | Platform | Filter (Versions) | Date
Monitor | <8 hour columns matching that read's chart> | <9th column near
the endpoint>` - the hour columns are **kept matching whichever chart's
labels prompted the last edit**, so a mismatch between the sheet's current
header and the chart in hand is expected and should be flagged, not
silently forced. The 9 hour columns exist so a read can go straight into
them without retiming. **Read a value at each of those 9 grid positions directly from
the line, the same as any other line-chart estimate** - do not leave them
blank because there's no hover-verified number available; a real visual
estimate at the right grid position is exactly what this column is for
(corrected 2026-08-21 after leaving them blank instead of estimating).
Output one tab-separated row, no header, columns in whatever order the
live sheet's header currently uses (example only - re-verify the actual
header and hour labels before trusting this shape):

```
21-Aug-26	Android TV	4.0.28,4.0.27,4.0.26	20-Aug-26	99.55	99.90	99.80	99.85	99.60	99.00	98.05	99.75	99.85
```

- **Sync Date**: today, `DD-Mon-YY`.
- **Platform** / **Filter (Versions)**: from Step 1 / the current Version
  to Monitor list, same as elsewhere.
- **Date Monitor**: the *earlier* calendar day of the "Last 24 hours" range
  shown top-right (e.g. `Aug 20 – Aug 21` -> `20-Aug-26`), confirmed as the
  convention to use.
- The hour values: estimate the line's position at each hour label the
  **current chart itself shows** (read them fresh each time, per the drift
  note above) - flag which stretches are lower-confidence (typically
  wherever the line is moving fastest, e.g.
  near a trough) but still give a number, don't omit it.
- **Hourly reads are meaningfully less reliable than the daily 7-day reads
  above, not just the same estimate at finer resolution** - a verified
  comparison (Android TV, 2026-08-21) came back accurate on the 6 daytime/
  flat hours (±0.01-0.09, normal line-chart noise) but badly wrong on the 3
  hours spanning an overnight trough (off by up to **+1.47** at the trough
  itself) - an order of magnitude past anything seen on a daily chart. More
  data points packed into the same pixel width means a small horizontal
  misjudgment lands on a very different point of a fast-moving curve.
  Flag any hour near a visible peak/trough as low-confidence explicitly,
  beyond the usual estimate caveat - and don't anchor the last hour toward
  the headline stat (same "headline ≠ chart line" trap as the daily read,
  and the direct cause of that trough's endpoint being off by +0.79).

**List read (Bitmovin Top Error Codes):** Answer in exactly the shape the
`/tvn/top-error-codes` page parses, so it can be pasted in with no editing -
a `Platform:` line first, then one line per row, ranked highest first, and
nothing else in the reply:

```
Platform: Android Mobile
media3-exoplayer-1.10.1: 2004, 519
media3-exoplayer-1.10.1: 4001, 345
```

- The `Platform:` value must be the **sheet's** platform name from the table
  in step 2 (`Android Mobile`), not the raw filter text (`android`) - the
  page matches it against its dropdown and ignores anything it can't match.
- Split the row label at its colon: the library/version prefix
  (`media3-exoplayer-1.10.1`, `avplayer-26.6`) goes before the colon, the
  numeric error code after it. Keep negative signs (`-12643`).
- Report every row visible, not just the top few, unless asked otherwise.

Session counts on this chart are bar lengths with no printed number, so they
are estimates - say so. Calibrate the pixels-per-unit scale against the
**farthest** labelled gridline, not a nearby one: a small error in locating a
near tick gets multiplied across the axis, which reads every bar low in
proportion to its length. Bar *order* is reliable even when magnitudes drift,
so rank with more confidence than counts.

If any digit or character is genuinely unreadable (blur, glare, cropped),
say which part is uncertain rather than silently rounding or guessing -
for a list read this means flagging the specific row, not the whole table.

**Issues list read (Crashlytics full-dashboard Issues table):** Events and
Users are printed numbers, not bar lengths - read them directly, no
estimation involved (this is the one Crashlytics read that doesn't need the
"never trust the chart line" caution). Output tab-separated rows matching
the destination sheet's own columns exactly (see Step 4) - no header row,
since the sheet already has one and rows just get appended below. The
sheet's header is `วันที่ตรวจ | ช่วงเวลาที่ตรวจสอบ | Platform | Filters |
Issue | Versions | Events | Users` (changed 2026-08-19 - it used to be a
single `Date Check` column; re-verify against the live sheet if this looks
stale):

```
19-Aug-26	13 Aug - 19 Aug	Android TV	4.0.28,4.0.27,4.0.26	DataStoreModule.provideAead — android.security.KeyStoreException - Unknown error [Repetitive crashes]	4.0.6-tv – 4.0.27-tv	626	96
```

- **วันที่ตรวจ**: today's date in Bangkok, `DD-Mon-YY` (matches
  `formatBangkokShortDate()` in `routes/tvn.js`) - the screenshot itself
  never prints an "as of" date for the Issues table, so this is an
  assumption; say so and offer to use a different date if asked.
- **ช่วงเวลาที่ตรวจสอบ**: read directly from the date-range control in the
  top-right of the screenshot (e.g. "Last 7 days, Aug 13 – Aug 19"),
  formatted as `13 Aug - 19 Aug` - not the Versions filter, not inferred,
  copy what's actually shown there.
- **Platform**: from Step 1 (version-suffix / app-picker method).
- **Filters**: the platform's current Version to Monitor list as plain
  comma-separated numbers (e.g. `4.0.28,4.0.27,4.0.26`), matching the
  existing rows' convention - not the raw truncated "Versions = ... and N
  more" chip text from the screenshot.
- **Issue**: `<bold title> — <exception/subtitle line>`, with any badges
  (`Repetitive crashes`, `Early crashes`, `Fresh issue`) appended as
  `[badge, badge]` when present. A row with no separate title line (just a
  bare exception name) uses that alone.
- **Versions**: the version range shown (e.g. `4.0.6-tv – 4.0.27-tv`),
  copied as-is - don't normalize the `-tv` suffix in or out here, unlike
  the Filters column.
- **Events** / **Users**: copied directly from their columns.
- Read every row on the current page, and say how many total/pages there
  are if the table shows pagination (e.g. "1-25 of 55") - don't silently
  stop at the top few, and don't claim to have the full set if more pages
  exist that weren't shown.

## Step 4 - tell them exactly where it goes in muze-ops-portal

This skill only reads, it never writes anywhere itself - and where a read
actually goes depends on which of the 3 tools it is, since `/tvn` uses a
different input method for each (last checked against the live page
2026-08-17; if any of this looks stale, re-check the actual page/routes
before trusting it, since this input UI has already been redesigned twice):

- **Bitmovin Error Session % (single stat)**: `/tvn`'s "· Error Sessions"
  track now imports the full 24-hour breakdown from a **CSV export**, not a
  typed-in single value - there is no manual-entry field left for this
  screenshot read to go into. If someone still wants the value read (e.g.
  for a quick Slack update), just report platform/value/filter as normal
  and say there's no field to paste it into on `/tvn` - point them at the
  CSV export + "🔄 Sync เข้าชีต" button (`hourly-sync-btn`) instead if they
  need it logged.
- **Bitmovin Top Error Codes -> `/tvn`'s "Top Error Codes" track**: paste
  the whole reply (including the `Platform:` line) into the "วางคำตอบที่
  Claude อ่านให้" box (`tec-paste-input`) and press "✂️ แยกลงตาราง". The
  page reads the `Platform:` line to preselect the platform - which is what
  decides the block of sheet rows the sync writes to - and turns the
  dropdown blue to show it was machine-filled and still wants a glance.
  Syncing (`🔄 Sync to Google Sheet`) inserts a new snapshot on top of that
  platform's block; nothing existing is overwritten.
- **Crashlytics -> `/tvn/crashlytics`'s record table**: platform is picked
  from an explicit **dropdown** (`Platform`, next to the value field) - not
  parsed from pasted text, since (per Step 1 above) the platform usually
  isn't stated in the screenshot at all. Pick the platform, type/paste the
  value into the field beside it, click "⬇ ลงตาราง" to drop it into that
  platform's row in the table below (the dropdown resets after each drop,
  on purpose, so the next platform has to be picked deliberately rather
  than accidentally reusing the last one). Repeat per platform read, check
  the Filter column for each row (auto-suggested from the current Version
  to Monitor list, but editable), then click "🔄 Sync เข้าชีต" once at the
  end to write every filled row - it POSTs one platform at a time, so a
  partial failure leaves the rest of the table intact to retry.
  **Since 2026-08-21 that section also carries a `Date Monitor` field and a
  `รอบเวลาที่ตรวจ` dropdown**, because the sheet now holds one row per
  monitored day with a column per checkpoint - the value lands in that day's
  row under that checkpoint, and the other checkpoints already recorded for
  the day are left alone. **The dropdown lists whatever the sheet's header
  row currently says**, not a hardcoded set, so it follows the drift
  described in Step 3 on its own. The checkpoint defaults to the most recent
  one that has already passed in Bangkok time, and Date Monitor follows it:
  for the columns after the list wraps past midnight it defaults a day back,
  since a 07.00 check reports on the window that opened the previous
  morning. Both stay editable, and a date typed by hand is never
  overwritten.
  **For a multi-day catch-up** use the "Crash-free users" paste section
  instead: it now expects one whole sheet row per line, tab-separated -
  `Sync Date ⇥ Platform ⇥ Filter (Versions) ⇥ Date Monitor ⇥ <one field per
  checkpoint column>` - checkpoints not yet checked left blank. The page
  prints the current column list above the paste box (read from the live
  header, so it is never the stale one), the Step 2 table mirrors those
  columns exactly and is what actually gets written, and Platform is
  auto-selected from the pasted rows.
- **Crashlytics Issues list -> the "Crashlytics Issue Log" sheet tab
  directly** (same spreadsheet, gid `570219984`, header `วันที่ตรวจ |
  ช่วงเวลาที่ตรวจสอบ | Platform | Filters | Issue | Versions | Events |
  Users`) - there is **no portal page for this yet**, unlike the other
  reads. Give the tab-separated block from Step 3 and the human pastes it
  into that sheet tab by hand, appended below whatever's already there.
- **Crashlytics Hourly read -> the "Crash-free users" paste box on
  `/tvn/crashlytics`** (writes the `Crashlytics Crash Free User` tab, gid
  `0`). As of 2026-08-21 that box takes exactly the tab-separated row Step
  3's Hourly read produces - one line per monitored day - parses it into an
  editable table with the sheet's own columns, and syncs it; there is no
  longer any need to paste into the sheet by hand (it still works if
  someone prefers to). Re-verify the header live before trusting the column
  list, it has already changed twice.

The human still reviews what's in the table/paste box and clicks the
existing Sync/ลงตาราง buttons themselves before anything is written.

## Step 5 - what the recorded values feed (the KPI dashboard)

Everything written into the `Crashlytics Crash Free User` tab (gid `0`) is
read straight back by the **📊 Dashboard** view of `/tvn/crashlytics`, which
grades every recorded **checkpoint** (platform + day + hour, not just the
day) against the two agreed KPI thresholds:

| Band | Rule | Shown as |
|---|---|---|
| Tier 1 | value ≥ **99.70%** | green, glyph `●` |
| Tier 2 | **99.50%** ≤ value < 99.70% | amber, glyph `▲` |
| below Tier 2 | value < **99.50%** | red, glyph `✕` |

The thresholds live in one place - `KPI_TIER1` / `KPI_TIER2` at the top of
the dashboard script in `public/tvn-crashlytics.html` - so a change to the
agreed KPI is a two-line edit, not a hunt through the markup. The view has
three parts: a 4-stat summary strip, one small-multiple panel per platform
(latest checkpoint + delta from the previous one + a shared-scale trend chart
with the two KPI lines drawn on it), and a platform x day x checkpoint matrix
laid out exactly like the sheet, with per-day ต่ำสุด / เฉลี่ย / ผ่าน T1.

Two things this implies for a read:
- **A checkpoint only counts once it's synced.** An unrecorded checkpoint
  shows as a blank cell, never a carried-forward value - so a skipped round
  is visible as a gap rather than silently reading as "fine".
- **Report the value for the round you actually read.** The dashboard grades
  each checkpoint on its own, so substituting the 7-day headline
  "Crash-free users" tile for a specific round's value plants a number that
  was never true at that hour. Read the graph per point (Step 3's "Trend
  read" mode) and say which round each value belongs to.

### Android TV versions always carry `-tv`

Firebase reports Android TV builds as `4.0.28-tv`, while the CAB Deploy
Tracker records the same build plain (`4.0.28`). Whenever an Android TV
version is *shown* - the "Version to Monitor" table on `/tvn/crashlytics`,
the suggested Filter value, or a version quoted back in a read - write it
with the `-tv` suffix on the version number, keeping any build number in
parentheses where it is: `4.0.28 (1002)` → `4.0.28-tv (1002)`. This is
presentation only; the tracker sheet itself is never rewritten, and a value
already recorded in the Crashlytics sheet by hand is left exactly as typed.
Only Android TV gets this - Apple TV's tracker versions are shown as-is.


### How the code reads that layout

Two implementation details behind Step 3's column list, worth knowing before
changing anything:

- The tab was restructured **and emptied** on 2026-08-21. Compared with the
  layout before that, Platform and Filter swapped columns (old: `Filters` in
  B, `Platform` in C) and the single `% Crash Free Users` column became the 9
  checkpoint columns - so one row is now one monitored *day*, not one
  reading. Anything still describing the old A-E shape is stale.
- `routes/tvn.js` reads the hour labels **out of the sheet's header row**
  rather than hardcoding them, and every table on the page is built from that
  list. Add or remove a checkpoint column in the sheet and the page follows on
  the next load, no code change. `/api/tvn/crashlytics/record` is an upsert on
  (Platform, Date Monitor): it fills only the checkpoints sent and leaves the
  rest of the row alone, so a later round adds to the earlier ones instead of
  replacing them. Hour labels are matched as exact strings between the page
  and the sheet, both sourced from that same header row, so a rename in the
  sheet moves the whole UI with it - **nothing in the app hardcodes a
  checkpoint time**, which is what makes the drift in Step 3 harmless.
- **Newest on top.** A day that has no row yet is inserted at **row 2** and
  pushes everything below it down - same convention as the Top Error Codes
  tab - so the sheet reads newest-first and a platform's days no longer sit
  together in one block. A multi-day paste is written oldest first so its
  newest day still ends up on top, whichever order it was pasted in.
- The tab still carries **leftovers of the old layout out in column V** (a
  stray `% Crash Free Users` header and 21 old daily values). Nothing reads
  them, and the hour columns are taken as the unbroken run starting at E
  precisely so that stray header isn't picked up as a 10th checkpoint - but
  they are why "append after the last used row" was landing writes at row 23
  with no real data in the sheet at all.
