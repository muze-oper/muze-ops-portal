# muze-ops-portal

Unified gateway that fronts two internal tools behind one URL and one Google
Workspace login:
- `/report` → `nissan-report-tool` (Fly.io)
- `/dashboard`, `/api/*` → `muze-jira-dashboard` (Vercel)

The gateway does not replace either backend's own auth — it injects the
right credential per backend automatically after the user signs in once
with their `muze.co.th` Google account.

## Setup

```bash
npm install
cp .env.example .env   # fill in real values, see below
npm start
```

Open http://localhost:3000 — you'll be redirected to `/login` until you
sign in with Google.

## Before this works end-to-end

1. **Google OAuth client** (the one piece only a Google Cloud Console admin
   for `muze.co.th` can set up):
   - Create/reuse a GCP project, set the OAuth consent screen to **Internal**
   - Add the `.../auth/calendar.readonly` scope on the consent screen (used
     only by the Daily Planner's "Run" button, to read the signed-in user's
     own calendar - it's a sensitive but not restricted scope, so Internal
     apps don't need Google's verification review for it)
   - Create a Web-application OAuth 2.0 Client ID
   - Authorized redirect URI: `https://muze-ops-portal.vercel.app/auth/google/callback`
     (and `http://localhost:3000/auth/google/callback` for local dev)
   - Put the Client ID/Secret into `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
     (locally in `.env`, and in Vercel's project env vars for production)
   - Everyone needs to log out and back in once after this scope was added,
     to grant it - existing sessions/refresh tokens predate it
2. Everything else (`REPORT_TOOL_BASIC_AUTH_*`, `DASHBOARD_SECRET`,
   `SESSION_SECRET`) is already set as Vercel production env vars, reusing
   the existing secrets from the two backend projects.

## Known limitations (by design, for this MVP)

- `/api/*` at the gateway root is owned by `muze-jira-dashboard` only,
  because its frontend calls root-relative paths like `/api/dashboard`
  rather than paths nested under `/dashboard/`. A future third module
  needing its own `/api` namespace would collide with this — not solved
  generically; fix later by prefixing the dashboard's frontend calls or
  giving the new module a distinct namespace.
- No session store — sessions are a stateless signed JWT cookie, 12h expiry.
  Rotating `SESSION_SECRET` logs everyone out; acceptable for a small
  internal tool.
- Vercel serverless function timeouts (10s on Hobby) could cut off a slow
  report export before `nissan-report-tool` finishes generating it. Accepted
  for MVP given low internal traffic — if it becomes a real problem, upgrade
  to Vercel Pro and set `maxDuration`, or move report generation to an
  async job + polling pattern (a change that belongs in `nissan-report-tool`,
  not here).
- No `/logout` link is exposed anywhere except the landing page header.

## Adding a third module later

Add a new `proxy/<name>Proxy.js` following `reportProxy.js`/`dashboardProxy.js`
as a template, mount it in `server.js` after `requireAuth`, and add its
credentials to `.env.example` / Vercel env vars. Avoid claiming `/api/*` at
the root if the dashboard module still owns it (see Known Limitations).
