// Server-side Supabase client.
//
// Uses the SERVICE ROLE key, which bypasses Row Level Security — so this must
// ONLY ever run on the server (Vercel functions / local scripts), never in the
// browser. Files under /api/_lib are helpers, not endpoints: Vercel ignores any
// path segment starting with "_" when routing, so this is never web-reachable.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Set them in .env (local) and in Vercel → Settings → Environment Variables.'
  );
}

export const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
