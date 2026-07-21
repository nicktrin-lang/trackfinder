// Local end-to-end test for the worker (step 4), without Vercel.
//
// Usage:
//   npm run test:worker                 (creates a job from a sample list, then works it)
//   npm run test:worker -- <jobId>      (works an existing job)
//
// Requires YOUTUBE_API_KEY and ANTHROPIC_API_KEY in .env (plus Supabase).
// NOTE: each new track costs ~100 YouTube units (search.list). The sample list
// is 4 tracks ≈ 400 units. Cached tracks cost 0.

import { createJobFromText } from '../api/_lib/create-job-core.js';
import { processJobBatch } from '../api/_lib/worker-core.js';
import { supabase } from '../api/_lib/supabase.js';

const SAMPLE = `Daft Punk - One More Time
Stardust - Music Sounds Better With You
Eric Prydz - Call On Me
Modjo - Lady (Hear Me Tonight)`;

let jobId = process.argv[2];

if (!jobId) {
  console.log('Creating a job from the sample list...\n');
  const { jobId: id, totalTracks } = await createJobFromText(SAMPLE);
  jobId = id;
  console.log(`Job ${jobId} — ${totalTracks} tracks\n`);
}

let totalUnits = 0;
for (let round = 1; ; round++) {
  const r = await processJobBatch(jobId, 4);
  totalUnits += r.unitsUsed;
  console.log(
    `Batch ${round}: processed ${r.processed}, ${r.matchedThisBatch} matched, ` +
      `${r.remaining} remaining, ${r.unitsUsed} units (total ${totalUnits})`
  );
  if (r.done) break;
}

const { data: tracks } = await supabase
  .from('tracks')
  .select('*')
  .eq('job_id', jobId)
  .order('position', { ascending: true });

const fmt = (s) => (s == null ? '  —  ' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

console.log('\nResults:');
for (const t of tracks ?? []) {
  const conf = t.confidence != null ? ` ${Math.round(t.confidence * 100)}%` : '';
  const line = `  [${t.state}${conf}] ${t.artist} — ${t.title} (edit ${fmt(t.edit_seconds)})`;
  console.log(line);
  if (t.state !== 'none') {
    console.log(`        → ${t.chosen_title} [${t.chosen_channel}] ${fmt(t.chosen_seconds)}`);
  }
  if (t.reason) console.log(`        · ${t.reason}`);
}
console.log(`\nTotal YouTube units this run: ${totalUnits} (cached tracks cost 0).`);
