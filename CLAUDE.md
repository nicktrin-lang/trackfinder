# TrackFinder

Find the **extended / club versions** of songs that exist only as short radio edits in a
SoundCloud playlist, then present them (and optionally build a YouTube playlist of the long ones).

- **Repo:** github.com/nicktrin-lang/trackfinder
- **Live:** trackfinder-1.vercel.app (auto-deploys on push to `main`)
- **Current state:** front-end mockup only (`index.html`). It plays back fake data. The job now is
  to build the real backend so the page does what it pretends to do.

Verify anything version-specific against current docs rather than memory. Anthropic model names,
API quotas and provider auth flows change — confirm at platform.claude.com/docs, the YouTube Data
API docs, and developers.soundcloud.com before relying on a specific figure.

---

## What it does (pipeline)

1. User **pastes a tracklist** (one `Artist - Title` per line; optional trailing duration like `3:45`).
2. Backend parses the text → tracklist (artist, title, optional edit duration in seconds).
3. For each track: search YouTube for extended-version candidates.
4. A **TrackFinder worker** (Claude, via the Anthropic API) ranks the candidates and picks the genuine extended version
   (or returns "none found").
5. Results shown on the page; user can select tracks and build a YouTube playlist of them.

> **Input decision (2026-07-21):** the original plan was to paste a **SoundCloud playlist URL** and
> resolve it via the SoundCloud API. We backed out of that: SoundCloud's API Terms of Use prohibit
> "playlist or library transfer services" without explicit approval, and TrackFinder is arguably
> adjacent. Scraping the site is worse (violates site terms + the "no internal v2 endpoints" rule).
> So input is now a **manual paste**. The verified SoundCloud API notes below are kept for reference
> in case we later seek approval, but are **not currently used**.

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

### SoundCloud — input  (NOT CURRENTLY USED — see "Input decision" above)
- **We HAVE a SoundCloud Artist Pro account.** That's the tier required to register an app, so use the
  **official API** — don't fall back to scraping or the internal v2 endpoints.
- Register app at developers.soundcloud.com → get `client_id` + `client_secret`. OAuth 2.1 (PKCE).
- Reading a *public* playlist's tracklist needs only the **Client Credentials** flow (app-level, no
  user login). Use that for playlist resolution + track search.
- Fallback if the developer portal is ever closed: the credential-free **oEmbed** endpoint resolves
  public track URLs. Prefer the real API while we have Artist Pro.

- **Verified details (July 2026 — corrections to the notes above):**
  - Token endpoint is `POST https://secure.soundcloud.com/oauth/token` with `grant_type=client_credentials`,
    authenticated by **HTTP Basic** (`Authorization: Basic base64(client_id:client_secret)`). PKCE is NOT
    used for this app-level flow — PKCE only applies to the user authorization-code flow (e.g. YouTube consent).
  - API calls use header **`Authorization: OAuth <token>`** (the `OAuth` scheme, NOT `Bearer`).
  - Resolve a playlist: `GET https://api.soundcloud.com/resolve?url=<playlist-url>` → playlist resource
    with a `tracks` array. Track `title` is often `"Artist - Title"`; split on the first `" - "`, else
    fall back to `user.username` as the artist.
  - **Durations are in MILLISECONDS** — divide by 1000 for our `edit_seconds`/`chosen_seconds`. Some
    tracks report `duration: 0` (known quirk); treat as unknown.
  - **Token creation is rate-limited (50 tokens / 12h per app).** MUST cache the access token and reuse
    it until expiry — we cache it in the `connections` table (`user_id='app'`, `provider='soundcloud'`).
    Never mint a token per request.

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

1. ✅ Add `.gitignore` (node_modules, .env, .vercel).
2. ✅ Supabase project + the tables above.
3. ✅ `/api/create-job` — pasted tracklist → parsed tracks → `jobs` + `tracks` rows.
   (Was `/api/resolve-playlist` via SoundCloud; changed to manual paste — see "Input decision".)
4. ✅ `/api/worker` — per track: check cache → `search.list` → batch `videos.list` for durations →
   Claude ranks (`claude-haiku-4-5`, structured output) → write result + cache. Batched; caller
   re-invokes until `remaining=0`. Plus `/api/job-status` for polling.
5. ✅ Wire the front-end (`index.html`) to real job data — paste box → create-job → worker batches →
   poll. Mock `tracks` array + fake timers removed.
6. ✅ YouTube OAuth + `/api/create-playlist` (gated behind consent + confirm; playlist is PRIVATE).
   Flow: `/api/auth/youtube-start` → Google consent → `/api/auth/youtube-callback` stores tokens in
   `connections` (`user_id='app'`, single-connection personal-tool model). `/api/youtube-connection`
   reports status; the UI's Create button requires a connection + a `window.confirm`. **Untested** —
   needs a Google OAuth client + the pipeline verified with live keys first.

### YouTube OAuth setup (do before testing step 6)
- Google Cloud console → enable **YouTube Data API v3** → configure the **OAuth consent screen**
  (add yourself as a test user) → create an **OAuth client ID** (type: Web application).
- Register **Authorized redirect URIs** exactly:
  - `http://localhost:3000/api/auth/youtube-callback` (local `vercel dev`)
  - `https://<your-vercel-domain>/api/auth/youtube-callback` (production)
- Put the client id/secret in `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
- Note: single-connection model — whoever completes OAuth owns the target account. Fine for a
  personal tool; multi-user would key tokens per real user id.

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

