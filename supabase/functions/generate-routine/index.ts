import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { createGenerateRoutineHandler, type AdminLike } from './handler.ts';

Deno.serve(
  createGenerateRoutineHandler({
    env: (name) => Deno.env.get(name),
    makeUserClient: (authHeader) =>
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
      ) as unknown as AdminLike,
    makeAnthropic: (apiKey) => new Anthropic({ apiKey }),
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
  }),
);
