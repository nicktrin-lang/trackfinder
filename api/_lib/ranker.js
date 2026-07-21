// The TrackFinder ranking worker — Claude picks the genuine extended version.
//
// Per CLAUDE.md this is high-volume, so it uses a fast/cheap Haiku-tier model
// (claude-haiku-4-5, verified current via the claude-api skill, July 2026).
// It returns structured JSON via output_config.format so we never parse prose.
//
// The star signal is DURATION: a radio edit is ~3-4 min; a real extended/club
// mix ~6-8 min. The pick should be meaningfully longer than the edit but not
// absurdly so (a 1-hour upload is a loop, not a mix). The worker MUST be allowed
// to answer "none" — for a lot of pop, the radio edit is the only version.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';

// Confidence at/above this is a "strong" match; below it, "review".
export const STRONG_THRESHOLD = 0.85;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean' },
    youtube_id: { type: 'string' }, // "" when found=false
    confidence: { type: 'number' }, // 0.0–1.0
    reason: { type: 'string' },
  },
  required: ['found', 'youtube_id', 'confidence', 'reason'],
};

const SYSTEM = `You identify the genuine EXTENDED / CLUB version of a song from a list of YouTube candidates.

The user gives you a radio-edit track (artist, title, and its duration in seconds if known) plus candidate YouTube videos (id, title, channel, duration in seconds).

Rules:
- The key signal is DURATION. A radio edit is typically ~3-4 min (180-260s). A real extended/club mix is typically ~6-8 min (360-500s).
- Pick the candidate that is meaningfully LONGER than the edit but not absurdly so. A ~15+ min or 1-hour upload is a loop/continuous mix, not a single extended version — reject it.
- Prefer titles that say "Extended Mix", "Club Mix", "Extended", "12\\" ", or an official/label channel. But do not force a match on the word alone — judge by structure and duration together.
- The artist and title must actually match the requested track. Reject unrelated songs, covers, karaoke, sped-up/nightcore, and reaction videos.
- If no candidate is a genuine longer version (e.g. only the radio edit exists), return found=false. This is a valid, expected answer — do NOT force a bad match.

Return: found (bool), youtube_id (the chosen candidate's id, or "" if none), confidence (0.0-1.0), reason (one short sentence, referencing the durations).`;

// candidates: [{ youtube_id, title, channel, seconds }]
// Returns { found, youtube_id, confidence, reason }.
export async function rankCandidates({ artist, title, editSeconds, candidates }) {
  if (!candidates || candidates.length === 0) {
    return { found: false, youtube_id: '', confidence: 0, reason: 'No candidates found on YouTube.' };
  }

  const payload = {
    track: { artist, title, edit_seconds: editSeconds ?? null },
    candidates: candidates.map((c) => ({
      youtube_id: c.youtube_id,
      title: c.title,
      channel: c.channel,
      seconds: c.seconds ?? null,
    })),
  };

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  });

  const textBlock = resp.content.find((b) => b.type === 'text');
  let parsed;
  try {
    parsed = JSON.parse(textBlock?.text ?? '{}');
  } catch {
    return { found: false, youtube_id: '', confidence: 0, reason: 'Ranking returned unparseable output.' };
  }

  // Guard: a claimed youtube_id must be one of the candidates we sent.
  if (parsed.found && !candidates.some((c) => c.youtube_id === parsed.youtube_id)) {
    return { found: false, youtube_id: '', confidence: 0, reason: 'Ranking picked an unknown id; treated as no match.' };
  }

  return {
    found: !!parsed.found,
    youtube_id: parsed.youtube_id ?? '',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    reason: parsed.reason ?? '',
  };
}
