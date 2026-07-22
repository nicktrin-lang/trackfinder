// GET /api/auth/youtube-start
// Kicks off Google OAuth: sets a short-lived CSRF state cookie and redirects
// the browser to Google's consent screen.

import { randomUUID } from 'node:crypto';
import { getAuthUrl, redirectUriFrom, userIdFrom } from '../_lib/google-oauth.js';

export default async function handler(req, res) {
  try {
    const state = randomUUID();
    const redirectUri = redirectUriFrom(req);
    const url = getAuthUrl(redirectUri, state);

    // Ensure a per-browser id so this sign-in stores tokens under *this* browser
    // (multi-user: each person connects their own YouTube account).
    const cookies = [`tf_oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`];
    if (!userIdFrom(req)) {
      cookies.push(`tf_uid=${randomUUID()}; HttpOnly; Path=/; Max-Age=34560000; SameSite=Lax`);
    }
    res.setHeader('Set-Cookie', cookies);
    res.writeHead(302, { Location: url });
    res.end();
  } catch (err) {
    console.error('youtube-start error:', err);
    res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}
