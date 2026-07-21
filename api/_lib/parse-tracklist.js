// Parse a pasted tracklist into structured tracks.
//
// Forgiving by design — people paste messy lists. Each non-empty line becomes
// one track. We handle:
//   "Artist - Title"
//   "Artist - Title 3:45"        (trailing duration -> edit_seconds)
//   "Artist - Title (3:45)"      (paren/bracket duration too)
//   "1. Artist - Title"          (leading track numbering, stripped)
//   "Title"                      (no " - " -> artist unknown, whole = title)
//
// Duration is optional: the extended-version search still works without it
// (Claude leans on title cues like "Extended Mix" plus candidate durations),
// but a known radio-edit length makes the "meaningfully longer" judgement sharper.

// Trailing time like 3:45, 12:07, optionally wrapped in ()/[] — captured & removed.
const TRAILING_DURATION = /[\s\-–—]*[([]?\s*(\d{1,3}):([0-5]\d)\s*[)\]]?\s*$/;
// Leading "1." / "01)" / "12 -" numbering — stripped.
const LEADING_NUMBER = /^\s*\d{1,3}[.)\-]\s+/;

function parseLine(line, index) {
  let text = line.trim();
  if (!text) return null;

  text = text.replace(LEADING_NUMBER, '').trim();

  let edit_seconds = null;
  const dur = text.match(TRAILING_DURATION);
  if (dur) {
    const mins = parseInt(dur[1], 10);
    const secs = parseInt(dur[2], 10);
    const total = mins * 60 + secs;
    // Sanity: ignore absurd values that are probably not a duration.
    if (total > 0 && total < 60 * 60) {
      edit_seconds = total;
      text = text.slice(0, dur.index).trim();
    }
  }

  // Split artist / title on the first " - " (or en/em dash variants).
  let artist = null;
  let title = text;
  const dashMatch = text.match(/\s[-–—]\s/);
  if (dashMatch) {
    artist = text.slice(0, dashMatch.index).trim();
    title = text.slice(dashMatch.index + dashMatch[0].length).trim();
  }

  if (!title) return null; // nothing usable on this line

  return {
    position: index,
    artist: artist || null,
    title,
    edit_seconds,
  };
}

// Parse the whole pasted blob. Re-indexes positions after dropping blank lines.
export function parseTracklist(rawText) {
  if (typeof rawText !== 'string') return [];
  const lines = rawText.split(/\r?\n/);
  const tracks = [];
  for (const line of lines) {
    const parsed = parseLine(line, tracks.length);
    if (parsed) tracks.push(parsed);
  }
  return tracks;
}
