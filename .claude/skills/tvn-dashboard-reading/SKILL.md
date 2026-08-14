---
name: tvn-dashboard-reading
description: Reads Error Session % (Bitmovin), Crash-free Users % (Firebase Crashlytics), or a Bitmovin Top Error Codes ranked list off a pasted TrueVisions NOW dashboard screenshot, for logging into muze-ops-portal's /tvn page. Trigger whenever the user pastes/attaches a screenshot of a Bitmovin error-session chart, a Bitmovin Top Error Codes table, or a Firebase Crashlytics crash-free-users stat and asks for the value(s), or explicitly invokes this skill.
---

Read the exact numbers shown on the dashboard screenshot - never estimate
from the position of a line on a trend chart. A visual guess off a chart
line is meaningfully noisy at the sub-1%-precision this tracking needs;
always prefer a printed number/stat/badge/table row over eyeballing a curve.

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

For the two single-stat tools, identify the platform from the visible
app/filter name (iOS, iOS Mobile, Android, Android Mobile, Apple TV,
Android TV, Tizen, LG, Vidaa).

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
  (e.g. `99.83`, `3.97`)
- **Filter shown** - what OS/Platform/time-window (Bitmovin) or Versions
  (Crashlytics) filter was actually active, so the person entering it can
  double check it matches what they intended to check

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

## Step 4 - tell them exactly where it goes in muze-ops-portal

Everything gets typed into the `/tvn` page by hand - this skill only reads,
it never writes anywhere itself:

- **Bitmovin Error Session % -> "BITMOVIN" section**: a line in the Quick
  Record box for that platform, formatted `<date label>, <value>%` - e.g.
  `Mon-3-Aug, 2.07%`. The date label must match the sheet's existing format
  exactly (`Mon-3-Aug` weekday-day-month style).
- **Bitmovin Top Error Codes -> the `/tvn/top-error-codes` page**: paste the
  whole reply (including the `Platform:` line) into the "วางคำตอบที่ Claude
  อ่านให้" box and press "แยกลงตาราง". The page reads the `Platform:` line to
  preselect the platform - which is what decides the block of sheet rows the
  sync writes to - and turns the dropdown blue to show it was machine-filled
  and still wants a glance. Syncing overwrites that platform's whole block,
  since these are ranked snapshots.
- **Crashlytics -> "Firebase Crashlytics" section**: the `Crash Free User %`
  input for that platform's row, plus the `Filter` field if the version list
  changed from what's already recorded there.

For the two sheet-backed reads (Bitmovin Error Sessions, Crashlytics), the
human still reviews the prefilled value and clicks the existing Sync /
บันทึก button themselves before anything is written.
