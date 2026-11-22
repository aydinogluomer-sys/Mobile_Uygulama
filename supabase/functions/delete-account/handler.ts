import {
  corsHeadersFor,
  jsonResponse,
  parseAllowedOrigins,
} from '../_shared/http.ts';

export type RevocationResult = 'revoked' | 'none' | 'failed' | 'unsupported';
export type RevocationReport = {
  google: RevocationResult;
  notion: RevocationResult;
  spotify: RevocationResult;
};

export type AdminForDelete = {
  auth: {
    admin: {
      deleteUser(id: string): Promise<{ error: { message?: string } | null }>;
    };
  };
  from(table: string): {
    select(cols: string): {
      eq(col: string, v: string): {
        maybeSingle(): Promise<{
          data: Record<string, unknown> | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

export type DeleteAccountDeps = {
  env(name: string): string | undefined;
  makeCallerClient(authHeader: string): {
    auth: {
      getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    };
  };
  makeAdminClient(): AdminForDelete;
  fetchImpl?: typeof fetch;
  revokeTimeoutMs?: number;
};

const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** En iyi çaba: hiçbir hata silmeyi engellemez, belirteç metni LOGLANMAZ. */
export async function revokeThirdPartyTokens(
  admin: AdminForDelete,
  userId: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<RevocationReport> {
  const report: RevocationReport = {
    google: 'none',
    notion: 'unsupported',
    spotify: 'unsupported',
  };

  try {
    const { data, error } = await admin
      .from('google_calendar_integrations')
      .select('access_token,refresh_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      report.google = 'failed';
      return report;
    }
    if (!data) {
      return report;
    }

    const refresh = typeof data.refresh_token === 'string' ? data.refresh_token.trim() : '';
    const access = typeof data.access_token === 'string' ? data.access_token.trim() : '';
    const token = refresh || access;
    if (!token) {
      return report;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(GOOGLE_REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        signal: ctrl.signal,
      });
      report.google = res.ok ? 'revoked' : 'failed';
    } catch {
      report.google = 'failed';
    } finally {
      clearTimeout(timer);
    }
  } catch {
    report.google = 'failed';
  }

  return report;
}

export function createDeleteAccountHandler(
  deps: DeleteAccountDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeadersFor(req, parseAllowedOrigins(deps.env('ALLOWED_ORIGINS')));

    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return jsonResponse({ error: 'Yöntem desteklenmiyor' }, 405, cors);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Yetkisiz' }, 401, cors);

    try {
      const caller = deps.makeCallerClient(authHeader);
      const { data: { user }, error: authError } = await caller.auth.getUser();
      if (authError || !user) return jsonResponse({ error: 'Kimlik doğrulama hatası' }, 401, cors);

      const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
      if (!serviceKey) {
        console.error('SUPABASE_SERVICE_ROLE_KEY missing; refusing to serve');
        return jsonResponse({ error: 'Sunucu yapılandırma hatası' }, 500, cors);
      }

      const admin = deps.makeAdminClient();

      await revokeThirdPartyTokens(
        admin,
        user.id,
        deps.fetchImpl ?? fetch,
        deps.revokeTimeoutMs ?? 3000,
      );

      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) {
        const message = String(error.message ?? '');
        if (/not.?found/i.test(message)) {
          return jsonResponse({ ok: true, alreadyDeleted: true }, 200, cors);
        }
        console.error('deleteUser failed');
        return jsonResponse({ error: 'Hesap silinemedi, lütfen tekrar deneyin.' }, 500, cors);
      }

      return jsonResponse({ ok: true }, 200, cors);
    } catch {
      console.error('delete-account handler failed');
      return jsonResponse({ error: 'Hesap silinemedi, lütfen tekrar deneyin.' }, 500, cors);
    }
  };
}
