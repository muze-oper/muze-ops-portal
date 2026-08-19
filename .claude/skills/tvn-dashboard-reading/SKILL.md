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

**⚠ Open question, unresolved as of 2026-08-19 - flag it again if seen,
don't just proceed with a guess:** for the **Issues list** read
specifically (not the single-stat/trend reads), a filter anchored on a
plain non-`-tv` version (e.g. `4.0.27 (1)`) has been seen producing an
Issues table where individual rows' own Versions ranges are a **mix** of
`-tv` and non-`-tv` values in the same table (e.g. `SQLiteConnection.
nativeExecute: 4.0.0-tv – 4.0.27-tv` sitting next to `MainActivity.
onUserLeaveHint: 4.0.6 – 4.0.27`). Contrast: when the filter anchor *is*
`-tv` (e.g. `4.0.28-tv`), every row's Versions range has been consistently
`-tv` throughout. This suggests the "no `-tv` suffix = Android Mobile"
read may not actually isolate Mobile from TV for the **Issues list** - the
underlying data might be mixed-platform even when the filter chip looks
Mobile-only. The user has taken this to discuss with the team and asked
to be reminded, not asked again, the next time this pattern shows up (a
non-`-tv` filter anchor with mixed-suffix rows in the Issues table) -
**say what you're seeing and that it was flagged before, then wait; do not
guess a Platform label or write anything for that read** until this is
resolved. This caution is specific to the Issues list - the single-stat
and trend reads aren't known to have this problem.

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
  partial failure leaves the rest of the table intact to retry. **For a
  multi-day trend read** (Step 3's "Trend read" mode) use the separate
  "Backfill ย้อนหลัง" section instead: pick the platform from its own
  dropdown (`cr-backfill-platform`), paste the `<date>  <value>` lines into
  `cr-backfill-paste`, check the parsed date+value table, then "🔄 Sync
  ย้อนหลังเข้าชีต" - each date is written under its own row (existing
  placeholder filled in place, otherwise a new row inserted after that
  platform's block), so re-running it doesn't overwrite prior days.
- **Crashlytics Issues list -> the "Crashlytics Issue Log" sheet tab
  directly** (same spreadsheet, gid `570219984`, header `วันที่ตรวจ |
  ช่วงเวลาที่ตรวจสอบ | Platform | Filters | Issue | Versions | Events |
  Users`) - there is **no portal page for this yet**, unlike the other
  reads. Give the tab-separated block from Step 3 and the human pastes it
  into that sheet tab by hand, appended below whatever's already there.

The human still reviews what's in the table/paste box and clicks the
existing Sync/ลงตาราง buttons themselves before anything is written.
