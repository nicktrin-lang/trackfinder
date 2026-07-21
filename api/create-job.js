// POST /api/create-job
// Body: { "text": "Artist - Title\nArtist2 - Title2\n..." }
// Returns: { jobId, totalTracks, tracks: [{ position, artist, title, edit_seconds }] }
//
// Thin wrapper: real work lives in _lib/create-job-core.js so it can be tested
// without going through HTTP.

import { createJobFromText } from './_lib/create-job-core.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { text } = body;

    const result = await createJobFromText(text);
    return res.status(200).json(result);
  } catch (err) {
    const status = err.statusCode ?? 500;
    if (status >= 500) console.error('create-job error:', err);
    return res.status(status).json({ error: err.message ?? 'Internal error' });
  }
}
