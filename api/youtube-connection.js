// GET /api/youtube-connection
// Returns { connected: boolean } so the front-end can show connect status.

import { isConnected } from './_lib/google-oauth.js';

export default async function handler(req, res) {
  try {
    return res.status(200).json({ connected: await isConnected() });
  } catch (err) {
    // If creds aren't configured yet, report not-connected rather than 500.
    console.warn('youtube-connection:', err.message);
    return res.status(200).json({ connected: false });
  }
}
