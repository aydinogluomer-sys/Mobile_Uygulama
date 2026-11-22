/**
 * Delete the CALLER'S account, and nothing else.
 * Pure orchestration lives in `./handler.ts` so Deno tests exercise every branch.
 */
import { createClient } from '@supabase/supabase-js';
import { createDeleteAccountHandler, type AdminForDelete } from './handler.ts';

Deno.serve(
  createDeleteAccountHandler({
    env: (name) => Deno.env.get(name),
    makeCallerClient: (authHeader) =>
      createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      ),
    makeAdminClient: () =>
      createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      ) as unknown as AdminForDelete,
    fetchImpl: fetch,
  }),
);
