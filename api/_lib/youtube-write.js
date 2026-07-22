// YouTube write helpers (create playlist, add a video). Shared by the
// create-playlist and add-to-playlist endpoints.
//
// SIDE-EFFECT: these write to the connected user's YouTube account. Only ever
// reached from an explicit user action (the per-song "Add to playlist" button).
// Playlists are created PRIVATE.
//
// playlistItems.insert intermittently returns 409 ABORTED / SERVICE_UNAVAILABLE,
// so we retry transient errors with backoff (Google's own guidance).

import { getValidAccessToken } from './google-oauth.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ytPost(path, token, body, retries = 4) {
  let lastStatus = 0;
  let lastDetail = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 0.5s,1s,2s,4s
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    lastStatus = res.status;
    lastDetail = (await res.text().catch(() => '')).slice(0, 300);
    const transient = res.status === 409 || res.status === 500 || res.status === 503;
    if (!transient) throw new Error(`YouTube API failed (${res.status}): ${lastDetail}`);
  }
  throw new Error(`YouTube API failed (${lastStatus}) after retries: ${lastDetail}`);
}

// Create an empty PRIVATE playlist. Returns { playlistId, url }.
export async function createPlaylist(title) {
  const token = await getValidAccessToken();
  const pl = await ytPost('/playlists?part=snippet,status', token, {
    snippet: { title, description: 'Extended / club versions found by TrackFinder.' },
    status: { privacyStatus: 'private' },
  });
  return { playlistId: pl.id, url: `https://www.youtube.com/playlist?list=${pl.id}` };
}

// Add one video to an existing playlist. Returns true on success.
export async function addVideo(playlistId, videoId) {
  const token = await getValidAccessToken();
  await ytPost('/playlistItems?part=snippet', token, {
    snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
  });
  return true;
}
