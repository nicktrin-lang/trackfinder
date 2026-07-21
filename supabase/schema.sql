-- TrackFinder — database schema (Supabase / Postgres)
-- =====================================================
-- Run this once in your Supabase project:
--   Supabase Dashboard → SQL Editor → New query → paste this file → Run.
-- Safe to re-run: every object uses IF NOT EXISTS or CREATE OR REPLACE.
--
-- Access model: our Vercel serverless functions talk to Supabase using the
-- SERVICE ROLE key, which bypasses Row Level Security (RLS). We still turn RLS
-- ON with no public policies so that the ANON key (safe to expose in the
-- browser) cannot read these tables directly. All reads/writes go through /api.

-- gen_random_uuid() lives in pgcrypto; enable it once.
create extension if not exists pgcrypto;

-- Keeps an updated_at column fresh on every UPDATE.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- jobs — one row per playlist the user submits
-- ---------------------------------------------------------------------------
create table if not exists jobs (
  id             uuid primary key default gen_random_uuid(),
  -- where the tracklist came from: 'manual' (pasted) or 'soundcloud' (future).
  source         text not null default 'manual',
  -- optional: only set for URL-sourced jobs; null for pasted tracklists.
  playlist_url   text,
  -- pending  : created, not yet resolved
  -- resolving: fetching the tracklist from SoundCloud
  -- working  : tracks are being matched against YouTube
  -- done     : every track has a final state
  -- error    : something failed (see error_message)
  status         text not null default 'pending'
                   check (status in ('pending','resolving','working','done','error')),
  total_tracks   integer not null default 0,
  matched_count  integer not null default 0,
  error_message  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists jobs_set_updated_at on jobs;
create trigger jobs_set_updated_at
  before update on jobs
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- tracks — one row per song in a job's playlist (the work queue)
-- ---------------------------------------------------------------------------
create table if not exists tracks (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id) on delete cascade,
  position          integer,               -- order within the playlist
  artist            text,
  title             text,
  edit_seconds      integer,               -- duration of the radio edit
  -- pending: not yet processed
  -- strong : confident extended version found
  -- review : a candidate exists but confidence is low — user should check
  -- none   : no genuine extended version exists (a valid, expected outcome)
  state             text not null default 'pending'
                      check (state in ('pending','strong','review','none')),
  chosen_youtube_id text,
  chosen_seconds    integer,               -- duration of the chosen match
  chosen_title      text,                  -- chosen video's title (for display)
  chosen_channel    text,                  -- chosen video's channel (for display)
  confidence        real,                  -- 0.0–1.0 from the ranking worker
  reason            text,                  -- worker's short explanation
  candidates        jsonb,                 -- all YouTube candidates (for the review UI)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists tracks_job_id_idx on tracks (job_id);
create index if not exists tracks_state_idx  on tracks (state);

drop trigger if exists tracks_set_updated_at on tracks;
create trigger tracks_set_updated_at
  before update on tracks
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- search_cache — remembers YouTube lookups so repeat tracks cost 0 quota units
-- Keyed by a normalized "artist|title" string (lowercased, trimmed).
-- This is the main defense against YouTube's 10,000 units/day ceiling.
-- ---------------------------------------------------------------------------
create table if not exists search_cache (
  cache_key    text primary key,          -- normalized "artist|title"
  candidates   jsonb,                      -- cached YouTube candidate list
  youtube_id   text,                       -- (optional) top pick, if stored
  seconds      integer,
  confidence   real,
  updated_at   timestamptz not null default now()
);

drop trigger if exists search_cache_set_updated_at on search_cache;
create trigger search_cache_set_updated_at
  before update on search_cache
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- connections — stores a user's YouTube OAuth tokens (for playlist creation).
-- Only touched by the LATER OAuth step; created now so the schema is complete.
-- Tokens are secrets: only ever read/written server-side via the service role.
-- ---------------------------------------------------------------------------
create table if not exists connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  provider       text not null default 'youtube',
  access_token   text,
  refresh_token  text,
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, provider)
);

drop trigger if exists connections_set_updated_at on connections;
create trigger connections_set_updated_at
  before update on connections
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- Lock the tables down: RLS on, no policies. The service role bypasses RLS
-- (that's how /api reaches them); the anon/browser key gets nothing.
-- ---------------------------------------------------------------------------
alter table jobs         enable row level security;
alter table tracks       enable row level security;
alter table search_cache enable row level security;
alter table connections  enable row level security;
