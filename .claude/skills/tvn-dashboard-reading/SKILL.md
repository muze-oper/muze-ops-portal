---
name: tvn-dashboard-reading
description: Reads Error Session % (Bitmovin) or Crash-free Users % (Firebase Crashlytics) off a pasted TrueVisions NOW dashboard screenshot, for logging into the TVN-Operation Monitoring sheet via muze-ops-portal's /tvn page. Trigger whenever the user pastes/attaches a screenshot of a Bitmovin error-session chart or a Firebase Crashlytics crash-free-users stat and asks for the value, or explicitly invokes this skill.
---

Read the exact numeric % shown on the dashboard screenshot - never estimate
from the position of a line on a trend chart. A visual guess off a chart
line is meaningfully noisy at the sub-1%-precision this tracking needs;
always prefer a printed number/stat/badge over eyeballing a curve.

## Step 1 - identify the tool and platform

Look at the screenshot for which tool it is:

- **Bitmovin** - a streaming-analytics dashboard, metric is "Error Session %".
- **Firebase Crashlytics** - shows "Crash-free users", usually with a big
  percentage stat near a "Users" count and a trend line above it.

Then identify the platform from the visible app/filter name (iOS, iOS
Mobile, Android, Android Mobile, Apple TV, Android TV, Tizen, LG, Vidaa).

## Step 2 - sanity-check the filter before trusting the number

A wrong filter gives a real-looking but wrong number - check this before
reading the value, not after:

- **Bitmovin**: confirm the OS + Platform filter shown matches the platform
  you're about to log a value for (e.g. iOS Mobile = OS "iPadOS, iOS" +
  Platform "iOS"). If the filter looks like it's for a different platform or
  is unset, say so and ask before reading a value.
- **Firebase Crashlytics**: confirm the time range is "Last 7 days", and
  that the **Versions** filter is ticked to the current top ~3 builds still
  receiving traffic (not old retired versions, and not "all versions" -
  either skews the number). If the visible version list looks stale, flag it.

## Step 3 - read the value

Report:

- **Platform**
- **Value** - the exact number shown, to 2 decimal places if available
  (e.g. `99.83`, `3.97`)
- **Filter shown** - what OS/Platform (Bitmovin) or Versions (Crashlytics)
  filter was actually active in the screenshot, so the person entering it
  can double check it matches what they intended to check

If any digit is genuinely unreadable (blur, glare, cropped), say which part
is uncertain rather than silently rounding or guessing.

## Step 4 - tell them exactly where it goes in muze-ops-portal

The value gets typed into `/tvn` on muze-ops-portal, not written automatically
by this skill:

- **Bitmovin -> "BITMOVIN Error Sessions" tab**: a line in the Quick Record
  box for that platform, formatted `<date label>, <value>%` - e.g.
  `Mon-3-Aug, 2.07%`. The date label must match the sheet's existing format
  exactly (`Mon-3-Aug` weekday-day-month style).
- **Crashlytics -> "Firebase Crashlytics" tab**: the `Crash Free User %`
  input for that platform's row, plus the `Filter` field if the version list
  changed from what's already recorded there.

Either way, the human still reviews the prefilled value and clicks the
existing Sync / บันทึก button themselves - this skill only reads, it never
writes to the sheet.
