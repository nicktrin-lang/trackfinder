// GET /api/auth/youtube-start
// Kicks off Google OAuth: sets a short-lived CSRF state cookie and redirects
// the browser to Google's consent screen.

import { randomUUID } from 'node:crypto';
import { getAuthUrl, redirectUriFrom } from '../_lib/google-oauth.js';

export default async function handler(req, res) {
  try {
    const state = randomUUID();
    const redirectUri = redirectUriFrom(req);
    const url = getAuthUrl(redirectUri, state);

    res.setHeader('Set-Cookie', `tf_oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`);
    res.writeHead(302, { Location: url });
    res.end();
  } catch (err) {
    console.error('youtube-start error:', err);
    res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}
