// POST /api/worker
// Body: { "jobId": "...", "batchSize"?: 4 }
// Processes one batch of pending tracks and returns progress:
//   { jobId, processed, remaining, done, unitsUsed, matchedThisBatch }
// The front-end calls this repeatedly until `done` is true.

import { processJobBatch } from './_lib/worker-core.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { jobId, batchSize } = body;
    if (!jobId) return res.status(400).json({ error: 'Missing jobId.' });

    const result = await processJobBatch(jobId, batchSize ?? 4);
    return res.status(200).json({ jobId, ...result });
  } catch (err) {
    console.error('worker error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}
