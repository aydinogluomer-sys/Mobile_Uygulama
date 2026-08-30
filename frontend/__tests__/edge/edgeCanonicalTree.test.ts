/**
 * There is exactly ONE writable source for every deployed edge function, and
 * the OAuth functions in it are both hardened and functionally complete.
 *
 * ## Why this file exists
 *
 * This repository shipped two parallel copies of its edge functions —
 * `supabase/functions/` and `backend/supabase/functions/` — and drifted in
 * BOTH directions at once, which is what made the situation hard to see:
 *
 *   generate-routine : the canonical copy was STALE (2 modes) while production
 *                      ran 4. Redeploying from canonical would have billed
 *                      `summarize`/`insights` at 25 FP and answered with the
 *                      wrong prompt.
 *   spotify-auth     : the canonical copy was AHEAD (signed state, redirect
 *   notion-auth        allowlist) and production still ran the version with
 *                      `crypto.randomUUID()` state that nothing verified.
 *   notion-auth      : the canonical copy was ahead on security and BEHIND on
 *                      behaviour — it had dropped `createAtlasDatabases` and
 *                      wrote `habits_database_id: null`. Deploying it would
 *                      have made new Notion connections unable to sync, and —
 *                      because the write is an upsert — would have nulled the
 *                      database ids of users who were already working.
 *
 * "Canonicalise the tree" therefore could not mean "ship what is in the
 * tree". The checks below encode what each copy has to satisfy so that the
 * next person can deploy from `supabase/functions/` without reading this
 * history first.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const REPO = join(__dirname, '..', '..', '..');
const CANON = join(REPO, 'supabase', 'functions');

const read = (slug: string) => stripComments(readFileSync(join(CANON, slug, 'index.ts'), 'utf8'));

describe('one canonical source tree', () => {
  it('the legacy duplicate tree is gone', () => {
    // Two writable copies of the same production function is the mechanism
    // behind every drift listed above, not a tidiness issue.
    expect(existsSync(join(REPO, 'backend', 'supabase', 'functions'))).toBe(false);
  });

  it('every function lives under supabase/functions', () => {
    const slugs = readdirSync(CANON).filter((d) => !d.startsWith('_'));
    expect(slugs.sort()).toEqual([
      'generate-routine', 'google-auth', 'notion-auth', 'notion-sync',
      'spotify-auth', 'subscription-webhook',
    ]);
  });
});

describe('OAuth functions are hardened, not merely present', () => {
  it.each(['spotify-auth', 'notion-auth', 'google-auth'])(
    '%s validates redirect_uri and verifies a signed state',
    (slug) => {
      const fn = read(slug);
      expect(fn).toContain("from '../_shared/redirectAllowlist.ts'");
      expect(fn).toContain("from '../_shared/oauthState.ts'");
      expect(fn).toContain('mintState(');
      expect(fn).toContain('verifyState(');
      // A bare random state is the exact thing the shared helper replaced:
      // minted, handed to the client, and never looked at again.
      expect(fn).not.toContain('crypto.randomUUID()');
    },
  );

  it.each(['spotify-auth', 'notion-auth', 'google-auth'])(
    '%s carries no hardcoded provider credential',
    (slug) => {
      const fn = read(slug);
      // The DEPLOYED spotify-auth reads
      //   Deno.env.get('SPOTIFY_CLIENT_SECRET') ?? '<32 hex chars>'
      // Nothing of that shape may exist in the canonical tree.
      expect(fn).not.toMatch(/CLIENT_(ID|SECRET)\s*=\s*[^;]*\?\?\s*'[A-Za-z0-9]{12,}'/);
    },
  );
});

describe('notion-auth is deployable, not just secure', () => {
  const fn = read('notion-auth');

  it('creates the Notion databases the sync depends on', () => {
    expect(fn).toContain('createAtlasDatabases');
    expect(fn).toContain('https://api.notion.com/v1/databases');
  });

  it('never stores null database ids', () => {
    // `habits_database_id: null` is what the hardened rewrite wrote. It makes
    // a freshly connected workspace unsyncable, and — via upsert — wipes the
    // ids of an already-working account that re-links.
    expect(fn).not.toMatch(/habits_database_id:\s*null/);
    expect(fn).not.toMatch(/tasks_database_id:\s*null/);
    expect(fn).toMatch(/habits_database_id:\s*dbs\./);
    expect(fn).toMatch(/tasks_database_id:\s*dbs\./);
  });

  it('reports a failed database creation instead of storing a broken link', () => {
    expect(fn).toMatch(/catch[\s\S]{0,200}?Notion veritabanları oluşturulamadı/);
  });
});
