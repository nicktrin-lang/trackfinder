// POST /api/add-to-playlist
// Body: { "playlistId": "PL...", "videoId": "abc123" }
// Adds one video to an existing playlist on the connected account.
// Returns { ok: true }.
//
// SIDE-EFFECT GATE: reached only from an explicit user "Add to playlist" click.

import { addVideo } from './_lib/youtube-write.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { playlistId, videoId } = body;
    if (!playlistId || !videoId) {
      return res.status(400).json({ error: 'Missing playlistId or videoId.' });
    }

    await addVideo(playlistId, videoId);
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err.needsAuth) return res.status(401).json({ error: err.message, needsAuth: true });
    console.error('add-to-playlist error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}
