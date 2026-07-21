# TrackFinder

Find the **extended / club versions** of songs that exist only as short radio edits in a
SoundCloud playlist, then present them (and optionally build a YouTube playlist of the long ones).

- **Repo:** github.com/nicktrin-lang/trackfinder
- **Live:** trackfinder-nine.vercel.app (auto-deploys on push to `main`)
- **Current state:** front-end mockup only (`index.html`). It plays back fake data. The job now is
  to build the real backend so the page does what it pretends to do.

Verify anything version-specific against current docs rather than memory. Anthropic model names,
API quotas and provider auth flows change — confirm at platform.claude.com/docs, the YouTube Data
API docs, and developers.soundcloud.com before relying on a specific figure.

---

## What it does (pipeline)

1. User pastes a **SoundCloud playlist URL** of radio edits.
2. Backend resolves the playlist → tracklist (artist, title, edit duration in seconds).
3. For each track: search YouTube for extended-version candidates.
4. A **TrackFinder worker** (Claude, via the Anthropic API) ranks the candidates and picks the genuine extended version
   (or returns "none found").
5. Results shown on the page; user can select tracks and build a YouTube playlist of them.

The star signal is **duration**. Radio edit ≈ 3–4 min; a real extended/club mix ≈ 6–8 min.
The chosen result should be meaningfully *longer* than the edit but not absurdly so (a 1-hour
upload is a loop, not a mix). Feed candidate titles + durations to Claude and let it reason.
It MUST be allowed to answer "no extended version exists" rather than force a bad match — for a lot
of pop, the radio edit is the only version.

---

## Stack

- **Vercel** — hosts the static front-end AND the serverless functions (the backend). Static site,
  no framework/build step currently. Functions go in `/api`.
- **Supabase** — Postgres for job state + a search cache, and secure storage of YouTube OAuth tokens.
- **GitHub** — source of truth; push to `main` triggers Vercel redeploy.
- **Anthropic API** — the ranking worker.

Long playlists will exceed a single function's timeout, so process as a queue: write track rows with
`status=pending`, work them in batches (cron / background function), update rows as they resolve, and
have the front-end poll job status.

---

## API facts (verified)

### SoundCloud — input
- **We HAVE a SoundCloud Artist Pro account.** That's the tier required to register an app, so use the
  **official API** — don't fall back to scraping or the internal v2 endpoints.
- Register app at developers.soundcloud.com → get `client_id` + `client_secret`. OAuth 2.1 (PKCE).
- Reading a *public* playlist's tracklist needs only the **Client Credentials** flow (app-level, no
  user login). Use that for playlist resolution + track search.
- Fallback if the developer portal is ever closed: the credential-free **oEmbed** endpoint resolves
  public track URLs. Prefer the real API while we have Artist Pro.

### YouTube Data API v3 — search + output
- Free, but **quota-limited: 10,000 units/day per Google Cloud project** (resets midnight PT).
- `search.list` = **100 units** (expensive — this is the ceiling; ≈100 searches/day).
- `videos.list` = **1 unit**, and batches up to **50 video IDs per call** — use it to fetch durations
  (`contentDetails.duration`, ISO-8601) cheaply.
- `playlistItems.insert` = **50 units**; `playlists.insert` = **50 units**.
- Reading/searching works with an **API key**. Creating a playlist on the user's account needs
  **OAuth 2.0** (scope `youtube` or `youtube.force-ssl`).
- **Cache every search result in Supabase** keyed by normalized `artist|title`. Repeat tracks then
  cost 0 search units. This is the main defense against the quota ceiling.

### Anthropic API — the ranking worker
- Per track, pass the candidate list (title, channel, duration) + the edit duration; have Claude pick
  the best extended match with a confidence score, or return none.
- Use a fast/cheap model for this (e.g. Haiku-tier) since it's high-volume; confirm the current model
  string in the docs. Return structured JSON (id, confidence, reason).

---

## Data model (Supabase, sketch — refine as needed)

- `jobs` — id, playlist_url, status, total_tracks, matched_count, created_at
- `tracks` — id, job_id, artist, title, edit_seconds, state
  (`pending|strong|review|none`), chosen_youtube_id, chosen_seconds, confidence, reason
- `search_cache` — key (normalized artist|title), youtube_id, seconds, confidence, updated_at
- `connections` — user_id, provider (`youtube`), access_token, refresh_token, expires_at

---

## Environment variables (set in Vercel → Settings → Environment Variables; NEVER commit)

- `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`
- `YOUTUBE_API_KEY` (search + videos.list)
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (playlist creation)
- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `SUPABASE_ANON_KEY` (client)

---

## Safety / side-effect gates (important)

- **Creating the YouTube playlist writes to the user's account.** Keep it behind explicit OAuth consent
  AND a confirm step in the UI. Never create/modify a playlist automatically or from anything other than
  a direct user click.
- Secrets live only in Vercel env vars, never in the repo. Add a `.gitignore` before any backend code.
- Respect each provider's Terms of Service. We only *link to / playlist* official uploads — no
  downloading or re-hosting audio.

---

## Build order (suggested)

1. Add `.gitignore` (node_modules, .env, .vercel).
2. Supabase project + the tables above.
3. `/api/resolve-playlist` — SoundCloud URL → tracklist (Client Credentials).
4. `/api/worker` — per track: check cache → `search.list` → batch `videos.list` for durations →
   Claude ranks → write result + cache. Queue/batch it.
5. Wire the front-end (`index.html`) to real job data (replace the mock `tracks` array + fake timers
   with a create-job call + polling).
6. YouTube OAuth + `/api/create-playlist` (gated behind consent + confirm).

---

## Conventions

- Front-end is one self-contained `index.html`. **Do not edit it in TextEdit** — it rewraps the file and
  breaks it. Use Claude Code / VS Code.
- Deploy = push to `main`: `git add -A && git commit -m "..." && git push`.
- Keep this file updated: when something is corrected, add the rule here so it isn't repeated.

## Don't
- Don't put secrets in `index.html` or any committed file, or in URL query strings.
- Don't use `search.list` where a cached result or `playlistItems.list` would do — it's 100× the cost.
- Don't force a match when no real extended version exists — return "none".
- Don't auto-create YouTube playlists; always require explicit user confirmation.

