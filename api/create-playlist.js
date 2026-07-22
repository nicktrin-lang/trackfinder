// POST /api/create-playlist
// Body: { "title": "My Extended Mixes" }
// Creates an empty PRIVATE playlist on the connected YouTube account.
// Returns { playlistId, url }.
//
// SIDE-EFFECT GATE: reached only from an explicit user action (the first
// "Add to playlist" click). Requires a prior OAuth connection.

import { createPlaylist } from './_lib/youtube-write.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const title = (body.title || 'TrackFinder — Extended Mixes').toString().slice(0, 150);

    const result = await createPlaylist(title);
    return res.status(200).json(result);
  } catch (err) {
    if (err.needsAuth) return res.status(401).json({ error: err.message, needsAuth: true });
    console.error('create-playlist error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}
