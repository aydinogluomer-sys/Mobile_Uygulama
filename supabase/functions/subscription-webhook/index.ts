// RevenueCat (veya benzeri) abonelik webhook'u.
// Güvenlik: paylaşılan sır ile doğrulama (verify_jwt=false; auth bu sır ile).
import { createClient } from '@supabase/supabase-js';
import { createSubscriptionWebhookHandler } from './handler.ts';

Deno.serve(
  createSubscriptionWebhookHandler({
    env: (name) => Deno.env.get(name),
    makeAdminClient: () =>
      createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      ),
  }),
);
