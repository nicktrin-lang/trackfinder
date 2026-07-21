// POST /api/create-playlist
// Body: { "title": "My Extended Mixes", "videoIds": ["abc123", ...] }
// Creates a PRIVATE playlist on the connected YouTube account and adds each
// video. Returns { playlistId, url, added }.
//
// SIDE-EFFECT GATE: this writes to the user's YouTube account. It is only ever
// reached from an explicit user click + confirm in the UI, requires a prior
// OAuth connection, and creates the playlist as PRIVATE. Never call it
// automatically.
//
// Quota: playlists.insert = 50 units; playlistItems.insert = 50 units/video.

import { getValidAccessToken } from './_lib/google-oauth.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

async function ytPost(path, token, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`YouTube API failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const title = (body.title || 'TrackFinder — Extended Mixes').toString().slice(0, 150);
    const videoIds = Array.isArray(body.videoIds) ? body.videoIds.filter(Boolean) : [];

    if (videoIds.length === 0) {
      return res.status(400).json({ error: 'No tracks selected for the playlist.' });
    }

    let token;
    try {
      token = await getValidAccessToken();
    } catch (err) {
      if (err.needsAuth) return res.status(401).json({ error: err.message, needsAuth: true });
      throw err;
    }

    // 1) Create the playlist (private).
    const playlist = await ytPost('/playlists?part=snippet,status', token, {
      snippet: { title, description: 'Extended / club versions found by TrackFinder.' },
      status: { privacyStatus: 'private' },
    });
    const playlistId = playlist.id;

    // 2) Add each video, in order. Continue past individual failures.
    let added = 0;
    const failed = [];
    for (const videoId of videoIds) {
      try {
        await ytPost('/playlistItems?part=snippet', token, {
          snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
        });
        added += 1;
      } catch (err) {
        failed.push({ videoId, error: err.message });
      }
    }

    return res.status(200).json({
      playlistId,
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
      added,
      failed,
    });
  } catch (err) {
    console.error('create-playlist error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}
