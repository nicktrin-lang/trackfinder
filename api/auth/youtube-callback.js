// GET /api/auth/youtube-callback?code=...&state=...
// Google redirects here after consent. We verify the CSRF state cookie,
// exchange the code for tokens, store them, and bounce back to the app.

import { exchangeCodeAndStore, redirectUriFrom } from '../_lib/google-oauth.js';

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function bounce(res, query) {
  // Clear the state cookie and return to the app.
  res.setHeader('Set-Cookie', 'tf_oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.writeHead(302, { Location: `/?${query}` });
  res.end();
}

export default async function handler(req, res) {
  const { code, state, error } = req.query || {};

  if (error) return bounce(res, `youtube=denied`);
  if (!code || !state) return bounce(res, `youtube=error`);

  const expected = readCookie(req, 'tf_oauth_state');
  if (!expected || expected !== state) return bounce(res, `youtube=badstate`);

  try {
    await exchangeCodeAndStore(code, redirectUriFrom(req));
    return bounce(res, `youtube=connected`);
  } catch (err) {
    console.error('youtube-callback error:', err);
    return bounce(res, `youtube=error`);
  }
}
