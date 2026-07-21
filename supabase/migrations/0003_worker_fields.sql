-- Migration 0003 — fields the worker needs. Run once in Supabase → SQL Editor.
--
-- tracks: store the chosen match's display info + the full candidate list
-- (so the "review" UI can show alternatives without another YouTube call).
alter table tracks add column if not exists chosen_title   text;
alter table tracks add column if not exists chosen_channel text;
alter table tracks add column if not exists candidates     jsonb;

-- search_cache: cache the candidate list (the expensive YouTube part), keyed by
-- normalized "artist|title". Repeat tracks then cost 0 search units.
alter table search_cache add column if not exists candidates jsonb;
