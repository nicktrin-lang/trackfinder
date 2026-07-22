// Worker core: process a batch of pending tracks for a job.
//
// Per track: check search_cache -> (miss) YouTube search + durations -> cache
// the candidates -> Claude ranks -> write the result to the track row. Batched
// so a long playlist doesn't exceed a single function's timeout; the caller
// (front-end / cron) re-invokes until `remaining` hits 0.

import { supabase } from './supabase.js';
import { findCandidates, normalizeKey } from './youtube.js';
import { rankCandidates, STRONG_THRESHOLD } from './ranker.js';

// Picks longer than this are likely continuous DJ mixes / loops / fan re-edits,
// not a single official extended version. We never mark them "strong" — they
// drop to "review" so the user decides, no matter how confident the ranker was.
const LONG_UPLOAD_SECONDS = 12 * 60;

// Get candidates for a track, using the Supabase cache to avoid re-searching.
// Returns { candidates, unitsUsed }.
async function getCandidatesCached(artist, title) {
  const cacheKey = normalizeKey(artist, title);

  const { data: cached } = await supabase
    .from('search_cache')
    .select('candidates')
    .eq('cache_key', cacheKey)
    .maybeSingle();

  if (cached?.candidates) {
    return { candidates: cached.candidates, unitsUsed: 0 }; // cache hit — 0 quota
  }

  const { candidates, unitsUsed } = await findCandidates(artist, title);

  // Cache the candidate list (the expensive part). Ranking is cheap and runs per track.
  await supabase
    .from('search_cache')
    .upsert({ cache_key: cacheKey, candidates }, { onConflict: 'cache_key' });

  return { candidates, unitsUsed };
}

// Process one track row end-to-end. Returns { matched, unitsUsed }.
async function processTrack(track) {
  const { candidates, unitsUsed } = await getCandidatesCached(track.artist, track.title);

  const ranked = await rankCandidates({
    artist: track.artist,
    title: track.title,
    editSeconds: track.edit_seconds,
    candidates,
  });

  let update;
  if (!ranked.found) {
    update = {
      state: 'none',
      chosen_youtube_id: null,
      chosen_seconds: null,
      chosen_title: null,
      chosen_channel: null,
      confidence: ranked.confidence,
      reason: ranked.reason,
      candidates,
    };
  } else {
    const chosen = candidates.find((c) => c.youtube_id === ranked.youtube_id);
    const tooLong = chosen?.seconds != null && chosen.seconds > LONG_UPLOAD_SECONDS;
    update = {
      state: (ranked.confidence >= STRONG_THRESHOLD && !tooLong) ? 'strong' : 'review',
      chosen_youtube_id: ranked.youtube_id,
      chosen_seconds: chosen?.seconds ?? null,
      chosen_title: chosen?.title ?? null,
      chosen_channel: chosen?.channel ?? null,
      confidence: ranked.confidence,
      reason: ranked.reason,
      candidates,
    };
  }

  await supabase.from('tracks').update(update).eq('id', track.id);

  return { matched: update.state === 'strong' || update.state === 'review', unitsUsed };
}

// Process up to `batchSize` pending tracks for a job.
// Returns { processed, remaining, done, unitsUsed, matchedThisBatch }.
export async function processJobBatch(jobId, batchSize = 4) {
  const { data: pending, error } = await supabase
    .from('tracks')
    .select('*')
    .eq('job_id', jobId)
    .eq('state', 'pending')
    .order('position', { ascending: true })
    .limit(batchSize);
  if (error) throw new Error(`Failed to load pending tracks: ${error.message}`);

  let unitsUsed = 0;
  let matchedThisBatch = 0;

  for (const track of pending ?? []) {
    try {
      const { matched, unitsUsed: u } = await processTrack(track);
      unitsUsed += u;
      if (matched) matchedThisBatch += 1;
    } catch (err) {
      // Mark this track as 'none' with the error reason so the job can complete
      // rather than getting stuck retrying a poison row.
      await supabase
        .from('tracks')
        .update({ state: 'none', reason: `Error: ${err.message}`.slice(0, 300) })
        .eq('id', track.id);
    }
  }

  // How many are still pending after this batch?
  const { count: remaining } = await supabase
    .from('tracks')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('state', 'pending');

  // Keep the job's matched_count and status in sync.
  const { count: matchedTotal } = await supabase
    .from('tracks')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .in('state', ['strong', 'review']);

  const done = (remaining ?? 0) === 0;
  await supabase
    .from('jobs')
    .update({ matched_count: matchedTotal ?? 0, status: done ? 'done' : 'working' })
    .eq('id', jobId);

  return {
    processed: (pending ?? []).length,
    remaining: remaining ?? 0,
    done,
    unitsUsed,
    matchedThisBatch,
  };
}
