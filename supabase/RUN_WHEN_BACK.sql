-- ============================================================================
-- TrackFinder — run this once in Supabase → SQL Editor → New query → Run.
-- Combines migrations 0002 + 0003. Idempotent (safe to run more than once).
-- After this, the paste → search → rank pipeline has every column it needs.
-- ============================================================================

-- 0002 — manual paste input (jobs no longer need a playlist URL)
alter table jobs alter column playlist_url drop not null;
alter table jobs add column if not exists source text not null default 'manual';

-- 0003 — fields the worker writes
alter table tracks add column if not exists chosen_title   text;
alter table tracks add column if not exists chosen_channel text;
alter table tracks add column if not exists candidates     jsonb;
alter table search_cache add column if not exists candidates jsonb;
