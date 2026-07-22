// YouTube Data API v3 helpers (verified July 2026).
//
// Quota (10,000 units/day per Google Cloud project, resets midnight PT):
//   search.list  = 100 units  ← expensive; the ceiling (~100 searches/day)
//   videos.list  =   1 unit, batches up to 50 IDs ← use for durations
// So: one search per track, then ONE batched videos.list for all its durations.
// Results are cached in Supabase (search_cache) so repeat tracks cost 0 units.
//
// Reading/searching needs only an API key (YOUTUBE_API_KEY). Playlist creation
// (later) needs OAuth — not built yet.

const API_BASE = 'https://www.googleapis.com/youtube/v3';

function requireKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('Missing YOUTUBE_API_KEY (set in .env / Vercel).');
  return key;
}

// Normalized cache key for a track: "artist|title", lowercased + trimmed.
export function normalizeKey(artist, title) {
  const a = (artist ?? '').toLowerCase().trim();
  const t = (title ?? '').toLowerCase().trim();
  return `${a}|${t}`;
}

// ISO-8601 duration (e.g. "PT6M58S") -> seconds.
export function parseIsoDuration(iso) {
  if (typeof iso !== 'string') return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, h, min, s] = m;
  return (parseInt(h || 0, 10) * 3600) + (parseInt(min || 0, 10) * 60) + parseInt(s || 0, 10);
}

// search.list — costs 100 units. Returns [{ youtube_id, title, channel }].
async function searchVideos(query, key, maxResults = 10) {
  const url = new URL(`${API_BASE}/search`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('key', key);

  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`YouTube search.list failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.items ?? [])
    .filter((it) => it.id?.videoId)
    .map((it) => ({
      youtube_id: it.id.videoId,
      title: it.snippet?.title ?? '',
      channel: it.snippet?.channelTitle ?? '',
    }));
}

// videos.list — costs 1 unit for up to 50 IDs. Returns Map<id, seconds>.
async function fetchDurations(ids, key) {
  const durations = new Map();
  if (ids.length === 0) return durations;

  // Batch in chunks of 50 (only ever 1 chunk here, but be safe).
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = new URL(`${API_BASE}/videos`);
    url.searchParams.set('part', 'contentDetails');
    url.searchParams.set('id', chunk.join(','));
    url.searchParams.set('key', key);

    const res = await fetch(url);
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`YouTube videos.list failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const json = await res.json();
    for (const item of json.items ?? []) {
      durations.set(item.id, parseIsoDuration(item.contentDetails?.duration));
    }
  }
  return durations;
}

// Strip SoundCloud/promo noise from a title before searching, so a pasted
// "All Good? (Likke Edit) [Supported by Marco Carola]" doesn't poison the query.
// (Display keeps the original title; only the search query is cleaned.)
export function cleanForSearch(text) {
  return (text ?? '')
    .replace(/\[[^\]]*\]/g, ' ')                 // [Supported by ...], [House], [Free Download]
    .replace(/\b(free\s+download|out\s+now|premiere|supported\s+by[^)]*)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Full candidate fetch for one track: search + durations.
// Returns { candidates: [{ youtube_id, title, channel, seconds }], unitsUsed }.
export async function findCandidates(artist, title) {
  const key = requireKey();
  const query = [cleanForSearch(artist), cleanForSearch(title), 'extended']
    .filter(Boolean).join(' ').trim();

  const found = await searchVideos(query, key);           // 100 units
  let unitsUsed = 100;

  const durations = await fetchDurations(found.map((c) => c.youtube_id), key); // 1 unit
  if (found.length > 0) unitsUsed += 1;

  const candidates = found.map((c) => ({
    ...c,
    seconds: durations.get(c.youtube_id) ?? null,
  }));

  return { candidates, unitsUsed };
}
