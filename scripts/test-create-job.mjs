// Local end-to-end test for the input layer, without Vercel.
//
// Usage:
//   npm run test:job                      (uses the built-in sample list)
//   npm run test:job -- path/to/list.txt  (parses a file you provide)
//
// Loads .env via node's --env-file flag (see package.json), parses the
// tracklist, writes rows to Supabase, and prints the resulting job + tracks.

import { readFileSync } from 'node:fs';
import { createJobFromText } from '../api/_lib/create-job-core.js';

const SAMPLE = `1. Daft Punk - One More Time 5:20
Stardust - Music Sounds Better With You (3:56)
Modjo - Lady (Hear Me Tonight)
Eric Prydz - Call On Me`;

const fileArg = process.argv[2];
const text = fileArg ? readFileSync(fileArg, 'utf8') : SAMPLE;

console.log('Input:\n' + text + '\n');

try {
  const result = await createJobFromText(text);
  console.log(`✓ Job created: ${result.jobId}`);
  console.log(`✓ Tracks parsed: ${result.totalTracks}\n`);

  for (const t of result.tracks) {
    const dur =
      t.edit_seconds != null
        ? `${Math.floor(t.edit_seconds / 60)}:${String(t.edit_seconds % 60).padStart(2, '0')}`
        : '  —  ';
    console.log(
      `  ${String(t.position + 1).padStart(2)}. ${t.artist ?? '(unknown)'} — ${t.title}  [${dur}]`
    );
  }
  console.log('\nDone. Check the jobs/tracks tables in Supabase to confirm the rows.');
} catch (err) {
  console.error(`\n✗ Failed: ${err.message}`);
  process.exit(1);
}
