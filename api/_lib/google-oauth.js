// Google OAuth 2.0 helper for YouTube playlist creation.
//
// Scope youtube.force-ssl lets us create a playlist and add items on the
// signed-in user's account. Multi-user: tokens are stored per browser, keyed by
// the `tf_uid` cookie (see userIdFrom) in the `connections` table
// (user_id=<tf_uid>, provider='youtube'), so each person signs in with their own
// YouTube account. There is no shared connection.
//
// Needs GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET (Vercel / .env).

import { supabase } from './supabase.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

const EXPIRY_SKEW_MS = 60 * 1000;

function creds() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET (set in .env / Vercel).');
  }
  return { id, secret };
}

// The callback URL must exactly match one registered in the Google Cloud
// console. We derive it from the request so preview/prod/localhost all work,
// as long as each is registered there.
export function redirectUriFrom(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/auth/youtube-callback`;
}

// Per-browser user id from the `tf_uid` cookie (set at youtube-start). This is
// what makes the tool multi-user: each browser signs in with its own YouTube
// account and its tokens are stored under its own id, instead of one shared
// 'app' connection. Returns null if the cookie isn't set yet.
export function userIdFrom(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'tf_uid') return decodeURIComponent(v.join('='));
  }
  return null;
}

// Consent-screen URL. access_type=offline + prompt=consent so we receive a
// refresh_token (needed to keep working after the access token expires).
export function getAuthUrl(redirectUri, state) {
  const { id } = creds();
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', id);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google token request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json();
}

// Exchange the authorization code for tokens and store them for this user.
export async function exchangeCodeAndStore(code, redirectUri, userId) {
  if (!userId) throw new Error('Missing user id (tf_uid cookie).');
  const { id, secret } = creds();
  const json = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri,
  });

  const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  const { error } = await supabase.from('connections').upsert(
    {
      user_id: userId,
      provider: 'youtube',
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? null,
      expires_at: expiresAt,
    },
    { onConflict: 'user_id,provider' }
  );
  if (error) throw new Error(`Failed to store YouTube tokens: ${error.message}`);
}

// True if this user has a stored connection with a refresh token.
export async function isConnected(userId) {
  if (!userId) return false;
  const { data } = await supabase
    .from('connections')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'youtube')
    .maybeSingle();
  return !!data?.refresh_token;
}

// Return a valid access token for this user, refreshing if expired.
// Throws an error tagged needsAuth if there's no usable connection.
export async function getValidAccessToken(userId) {
  if (!userId) {
    const err = new Error('YouTube is not connected. Connect it first.');
    err.needsAuth = true;
    throw err;
  }
  const { data } = await supabase
    .from('connections')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'youtube')
    .maybeSingle();

  if (!data) {
    const err = new Error('YouTube is not connected. Connect it first.');
    err.needsAuth = true;
    throw err;
  }

  const valid = data.access_token && data.expires_at &&
    new Date(data.expires_at).getTime() - EXPIRY_SKEW_MS > Date.now();
  if (valid) return data.access_token;

  if (!data.refresh_token) {
    const err = new Error('YouTube connection expired. Reconnect it.');
    err.needsAuth = true;
    throw err;
  }

  const { id, secret } = creds();
  const json = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: id,
    client_secret: secret,
    refresh_token: data.refresh_token,
  });

  const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  await supabase
    .from('connections')
    .update({ access_token: json.access_token, expires_at: expiresAt })
    .eq('user_id', userId)
    .eq('provider', 'youtube');

  return json.access_token;
}
