import {
  createDeleteAccountHandler,
  revokeThirdPartyTokens,
  type AdminForDelete,
  type DeleteAccountDeps,
} from './handler.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function assertEquals(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Assertion failed (${msg}): expected ${e}, got ${a}`);
  }
}

Deno.test('delete-account deletes verified user after revoking Google token and never reads request body', async () => {
  const events: string[] = [];
  const deletedIds: string[] = [];
  const secretRefreshToken = '1//0gSECRET-GOOGLE-REFRESH-TOKEN';

  const admin: AdminForDelete = {
    auth: {
      admin: {
        deleteUser: async (id) => {
          events.push(`deleteUser:${id}`);
          deletedIds.push(id);
          return { error: null };
        },
      },
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'google_calendar_integrations') {
              return { data: { access_token: 'ya29.ACCESS', refresh_token: secretRefreshToken }, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
  };

  const deps: DeleteAccountDeps = {
    env: (n) => (n === 'SUPABASE_SERVICE_ROLE_KEY' ? 'svc-key' : undefined),
    makeCallerClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'verified-uid-1' } }, error: null }) },
    }),
    makeAdminClient: () => admin,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      events.push(`revoke:${String(url)}`);
      assert(String(init?.body ?? '').includes(encodeURIComponent(secretRefreshToken)), 'revokes refresh_token');
      return new Response('', { status: 200 });
    }) as typeof fetch,
  };

  const handler = createDeleteAccountHandler(deps);

  const poisonedReq = new Request('https://example.test/functions/v1/delete-account', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 'kurban-uid-999' }),
  });
  Object.defineProperty(poisonedReq, 'json', { value: () => { throw new Error('Request.json must not be called'); } });
  Object.defineProperty(poisonedReq, 'text', { value: () => { throw new Error('Request.text must not be called'); } });
  Object.defineProperty(poisonedReq, 'formData', { value: () => { throw new Error('Request.formData must not be called'); } });

  const res = await handler(poisonedReq);
  assertEquals(res.status, 200, 'status 200');
  assertEquals(await res.json(), { ok: true }, 'ok body');
  assertEquals(deletedIds, ['verified-uid-1'], 'deletes ONLY verified JWT user');
  assertEquals(events, ['revoke:https://oauth2.googleapis.com/revoke', 'deleteUser:verified-uid-1'], 'revoke runs BEFORE deleteUser');
});

Deno.test('delete-account handles User not found as alreadyDeleted, enforces 405/401/500, and continues when revoke fails or times out', async () => {
  let deleteCalls = 0;
  const makeBase = (overrides: Partial<DeleteAccountDeps> & { deleteErr?: string | null; authUser?: string | null }): DeleteAccountDeps => ({
    env: (n) => (n === 'SUPABASE_SERVICE_ROLE_KEY' ? 'svc-key' : undefined),
    makeCallerClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: overrides.authUser === null ? null : { id: overrides.authUser ?? 'uid-2' } },
          error: overrides.authUser === null ? new Error('invalid token') : null,
        }),
      },
    }),
    makeAdminClient: () => ({
      auth: {
        admin: {
          deleteUser: async () => {
            deleteCalls += 1;
            return { error: overrides.deleteErr ? { message: overrides.deleteErr } : null };
          },
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { access_token: 'ya29.SECRET_TOK', refresh_token: null },
              error: null,
            }),
          }),
        }),
      }),
    }),
    ...overrides,
  });

  const getRes = await createDeleteAccountHandler(makeBase({}))(
    new Request('https://example.test/fn', { method: 'GET' }),
  );
  assertEquals(getRes.status, 405, 'GET -> 405');

  const noAuthRes = await createDeleteAccountHandler(makeBase({}))(
    new Request('https://example.test/fn', { method: 'POST' }),
  );
  assertEquals(noAuthRes.status, 401, 'missing Authorization -> 401');

  const badJwtRes = await createDeleteAccountHandler(makeBase({ authUser: null }))(
    new Request('https://example.test/fn', { method: 'POST', headers: { Authorization: 'Bearer bad' } }),
  );
  assertEquals(badJwtRes.status, 401, 'getUser failure -> 401');
  assertEquals(deleteCalls, 0, 'zero deleteUser calls on auth failures');

  const notFoundRes = await createDeleteAccountHandler(makeBase({ deleteErr: 'User not found' }))(
    new Request('https://example.test/fn', { method: 'POST', headers: { Authorization: 'Bearer ok' } }),
  );
  assertEquals(notFoundRes.status, 200, 'not found -> 200');
  assertEquals(await notFoundRes.json(), { ok: true, alreadyDeleted: true }, 'alreadyDeleted: true');

  const dbErrRes = await createDeleteAccountHandler(makeBase({ deleteErr: 'DETAIL: pg_Internal_Constraint_XYZ' }))(
    new Request('https://example.test/fn', { method: 'POST', headers: { Authorization: 'Bearer ok' } }),
  );
  assertEquals(dbErrRes.status, 500, 'deleteUser error -> 500');
  const errText = await dbErrRes.text();
  assert(!errText.includes('pg_Internal_Constraint_XYZ'), 'raw DB error never leaked to caller');

  // Revocation timeout / rejection must NOT block account deletion and must NOT leak token
  const beforeTimeoutDeletes = deleteCalls;
  const timeoutFetch = ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
    })) as typeof fetch;

  const adminForReport: AdminForDelete = {
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { access_token: 'ya29.NEVER_LOG_ME', refresh_token: '1//NEVER_LOG_ME' },
            error: null,
          }),
        }),
      }),
    }),
  };
  const report = await revokeThirdPartyTokens(adminForReport, 'uid-2', timeoutFetch, 15);
  assertEquals(report, { google: 'failed', notion: 'unsupported', spotify: 'unsupported' }, 'timeout report');
  assert(!JSON.stringify(report).includes('NEVER_LOG_ME'), 'report contains no token');

  const afterRevokeFail = await createDeleteAccountHandler(
    makeBase({ fetchImpl: timeoutFetch, revokeTimeoutMs: 15 }),
  )(new Request('https://example.test/fn', { method: 'POST', headers: { Authorization: 'Bearer ok' } }));
  assertEquals(afterRevokeFail.status, 200, 'account deletion still succeeds when revoke times out');
  assertEquals(deleteCalls, beforeTimeoutDeletes + 1, 'deleteUser called once despite revoke timeout');
});
