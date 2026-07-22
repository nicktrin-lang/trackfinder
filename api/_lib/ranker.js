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

The user gives you a track (artist, title, and its radio-edit duration in seconds IF known — it often isn't) plus candidate YouTube videos (id, title, channel, duration in seconds).

How to decide (title/channel signals matter as much as duration):
- A strong match is a candidate whose title explicitly says "Extended Mix", "Club Mix", "Extended", "Extended Version", "12\\"", or "Dub", AND whose artist + title clearly match the requested track. An official or "- Topic" (auto-generated official) channel makes it stronger. When those signals are present, it IS the extended version even if it's only ~5-6 minutes — many modern extended mixes run 5-6 min. Do NOT reject a clearly-labelled official Extended Mix just for being under 6 minutes.
- Duration is a supporting signal, not a gate. A real extended/club mix is usually ~5-9 min. If the radio-edit duration is known, the pick should be meaningfully longer than it. If it's unknown, lean on the title/channel signals plus relative length among the candidates (an extended mix is longer than a plausible ~3-4 min edit).
- Be skeptical of very long uploads (roughly >12 min): these are often continuous DJ mixes, loops, or fan re-edits, not a single official extended version. Prefer an official-length extended (~5-9 min) over the absolute longest result. If ONLY a very long one exists and it looks like a loop/mix, either reject it or return it with LOW confidence (a "review", not a confident pick).
- The artist and title must actually match. Reject unrelated songs, live performances, covers, karaoke, sped-up/nightcore, and reaction videos, even if long.
- If no candidate is a genuine extended version (only the standard/radio release exists, or nothing relevant was found), return found=false. This is a valid, expected answer — do NOT force a bad match.

Confidence guide: >=0.85 when the title explicitly says Extended/Club Mix and the artist+title+channel clearly match; 0.5-0.8 when it's plausibly the long version but ambiguous (unofficial channel, borderline length); found=false when nothing genuine.

Return: found (bool), youtube_id (the chosen candidate's id, or "" if none), confidence (0.0-1.0), reason (one short sentence citing the title label and duration).`;

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
