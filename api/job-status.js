// GET /api/job-status?jobId=...
// Returns { job, tracks } for the front-end to poll and render.

import { supabase } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const jobId = req.query?.jobId;
  if (!jobId) return res.status(400).json({ error: 'Missing jobId query parameter.' });

  try {
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();
    if (jobErr) throw new Error(jobErr.message);
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    const { data: tracks, error: trErr } = await supabase
      .from('tracks')
      .select('*')
      .eq('job_id', jobId)
      .order('position', { ascending: true });
    if (trErr) throw new Error(trErr.message);

    return res.status(200).json({ job, tracks: tracks ?? [] });
  } catch (err) {
    console.error('job-status error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}
