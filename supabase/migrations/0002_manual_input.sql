-- Migration 0002 — switch input from SoundCloud URL to pasted tracklist.
-- Run once in Supabase → SQL Editor (safe to re-run).
--
-- Pasted jobs have no playlist URL, so playlist_url becomes optional, and a
-- `source` column records where a job came from ('manual' now; 'soundcloud'
-- later if we ever revisit the API).

alter table jobs alter column playlist_url drop not null;
alter table jobs add column if not exists source text not null default 'manual';
