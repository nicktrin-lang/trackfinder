// Core logic for the input layer: pasted tracklist -> a job + its track rows.
// Shared by the /api/create-job endpoint and scripts/test-create-job.mjs.

import { supabase } from './supabase.js';
import { parseTracklist } from './parse-tracklist.js';

// Parses the pasted text, writes a `jobs` row and one `tracks` row per song,
// and returns { jobId, totalTracks, tracks }.
export async function createJobFromText(rawText) {
  const parsed = parseTracklist(rawText);

  if (parsed.length === 0) {
    const err = new Error(
      'No tracks found. Paste one song per line, e.g. "Artist - Title".'
    );
    err.statusCode = 400;
    throw err;
  }

  // 1) Create the job row (source='manual', no playlist URL for pasted input).
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      source: 'manual',
      status: 'working',
      total_tracks: parsed.length,
      matched_count: 0,
    })
    .select('id')
    .single();
  if (jobErr) throw new Error(`Failed to create job: ${jobErr.message}`);

  // 2) Insert the track rows (the work queue), all state='pending'.
  const rows = parsed.map((t) => ({ ...t, job_id: job.id, state: 'pending' }));
  const { error: trErr } = await supabase.from('tracks').insert(rows);
  if (trErr) throw new Error(`Failed to insert tracks: ${trErr.message}`);

  return {
    jobId: job.id,
    totalTracks: parsed.length,
    tracks: parsed,
  };
}
