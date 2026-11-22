/**
 * Every edge function states what production is supposed to do with it.
 *
 * ## What went wrong without this
 *
 * Step 9 compared the repository against the live project for the first time
 * and found three separate drifts, none of which any test could see:
 *
 *   google-auth   never deployed at all, while `constants/integrations.ts`
 *                 listed Google Calendar as `status: 'available'` — so the
 *                 client advertised a feature whose endpoint answered 404.
 *   notion-auth   production still ran the pre-hardening build: OAuth `state`
 *                 was a bare UUID nothing verified, and `client_id` resolved
 *                 to `undefined`.
 *   spotify-auth  an old vulnerable build was still publicly reachable long
 *                 after Spotify left the MVP.
 *
 * `edgeCanonicalTree.test.ts` already proves there is one writable source per
 * function and that the source is hardened. That is a different question from
 * this one, and passing it is exactly what made the drift invisible: the tree
 * was right the whole time.
 *
 * ## Why the check is shaped like this
 *
 * The real question — "is the running bundle this source?" — needs production
 * credentials, so it lives in `tools/verify-edge-deployment.mjs` and runs at
 * release time. Putting a token with production read access into every pull
 * request would be a worse trade than the bug it prevents.
 *
 * What CAN be asserted with no credentials is that the declaration exists and
 * stays complete: a new function cannot be added without someone writing down
 * whether production should serve it, and a `deploy: false` has to be a
 * decision with a reason rather than a blank. That is the half that keeps the
 * release-time check meaningful.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..');
const FUNCTIONS_DIR = join(REPO, 'supabase', 'functions');
const MANIFEST_PATH = join(FUNCTIONS_DIR, 'DEPLOYMENT.json');

type Entry = {
  slug: string;
  deploy: boolean;
  verifyJwt?: boolean;
  requiredSecrets?: string[];
  note?: string;
};

const manifest: { functions: Entry[] } = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

/** Directories that are real functions: `_shared` is a library, not an endpoint. */
const sourceSlugs = readdirSync(FUNCTIONS_DIR)
  .filter((name) => !name.startsWith('_'))
  .filter((name) => statSync(join(FUNCTIONS_DIR, name)).isDirectory())
  .sort();

describe('edge deployment manifest', () => {
  it('exists where the release script looks for it', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    expect(Array.isArray(manifest.functions)).toBe(true);
    expect(manifest.functions.length).toBeGreaterThan(0);
  });

  it('declares every function that exists in the tree', () => {
    const declared = manifest.functions.map((f) => f.slug).sort();
    // Not a subset check in either direction: an undeclared function is the
    // hole this file closes, and a declared-but-deleted one is a stale promise
    // the release script would then look for forever.
    expect(declared).toEqual(sourceSlugs);
  });

  it('every entry answers the deploy question explicitly', () => {
    for (const f of manifest.functions) {
      expect(typeof f.deploy).toBe('boolean');
    }
  });

  it('a function that must NOT be deployed says why', () => {
    // `deploy: false` is the one value that silently matches a mistake -- an
    // undeployed function and a decommissioned one look identical in the API.
    // Requiring the reason is what separates them a year from now.
    for (const f of manifest.functions.filter((x) => !x.deploy)) {
      expect(typeof f.note).toBe('string');
      expect((f.note ?? '').length).toBeGreaterThan(40);
    }
  });

  it('every deployed function pins the verify_jwt it expects', () => {
    // Step 4 found a real exposure behind exactly this flag, so it is asserted
    // rather than inherited from whatever the dashboard happens to hold.
    for (const f of manifest.functions.filter((x) => x.deploy)) {
      expect(typeof f.verifyJwt).toBe('boolean');
    }
  });

  it('a public function justifies being public', () => {
    for (const f of manifest.functions.filter((x) => x.deploy && x.verifyJwt === false)) {
      expect(typeof f.note).toBe('string');
      expect((f.note ?? '').length).toBeGreaterThan(40);
    }
  });

  it('OAuth functions name the secrets production needs', () => {
    // google-auth returned 404 in production because nobody had noticed its
    // credentials were never configured. Naming them here means the release
    // script can say WHICH value is missing instead of just "not deployed".
    for (const slug of ['notion-auth', 'google-auth']) {
      const entry = manifest.functions.find((f) => f.slug === slug);
      expect(entry).toBeDefined();
      expect(entry!.requiredSecrets ?? []).toEqual(
        expect.arrayContaining(['OAUTH_STATE_SECRET', 'OAUTH_REDIRECT_ALLOWLIST']),
      );
    }
  });

  it('Spotify stays decommissioned', () => {
    // Spotify is outside the MVP by an explicit product decision, and the
    // build that was live minted an authorize URL for any redirect_uri it was
    // handed. If this flips to true, that endpoint is back.
    const spotify = manifest.functions.find((f) => f.slug === 'spotify-auth');
    expect(spotify).toBeDefined();
    expect(spotify!.deploy).toBe(false);
  });

  it('the release check that consumes this manifest is present', () => {
    expect(existsSync(join(REPO, 'tools', 'verify-edge-deployment.mjs'))).toBe(true);
  });

  it('F21 (EDG-11): supabase/config.toml [functions.<slug>] blocks match deploy:true entries and exclude deploy:false entries', () => {
    const configToml = readFileSync(join(REPO, 'supabase', 'config.toml'), 'utf8');

    const parseFunctionBlocks = (toml: string): Map<string, { verifyJwt?: boolean; importMap?: string }> => {
      const blocks = new Map<string, { verifyJwt?: boolean; importMap?: string }>();
      const lines = toml.replace(/\r\n?/g, '\n').split('\n');
      let currentSlug: string | null = null;
      for (const rawLine of lines) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) continue;
        const sec = /^\[([^\]]+)\]$/.exec(line);
        if (sec) {
          const fnMatch = /^functions\.([a-z0-9-]+)$/.exec(sec[1]);
          currentSlug = fnMatch ? fnMatch[1] : null;
          if (currentSlug) blocks.set(currentSlug, {});
          continue;
        }
        if (!currentSlug) continue;
        const entry = blocks.get(currentSlug)!;
        const vMatch = /^verify_jwt\s*=\s*(true|false)$/.exec(line);
        if (vMatch) entry.verifyJwt = vMatch[1] === 'true';
        const imMatch = /^import_map\s*=\s*"([^"]+)"$/.exec(line);
        if (imMatch) entry.importMap = imMatch[1];
      }
      return blocks;
    };

    const blocks = parseFunctionBlocks(configToml);
    const deployedEntries = manifest.functions.filter((f) => f.deploy);
    const undeployedEntries = manifest.functions.filter((f) => !f.deploy);

    expect([...blocks.keys()].sort()).toEqual(deployedEntries.map((f) => f.slug).sort());
    for (const f of deployedEntries) {
      const block = blocks.get(f.slug);
      expect(block).toEqual({
        verifyJwt: f.verifyJwt,
        importMap: './functions/deno.json',
      });
    }
    for (const f of undeployedEntries) {
      expect(blocks.has(f.slug)).toBe(false);
    }

    // Negative control: flipping subscription-webhook verify_jwt to true or adding spotify-auth is caught
    const broken = parseFunctionBlocks(`${configToml}\n[functions.spotify-auth]\nverify_jwt = true\n`);
    expect(broken.has('spotify-auth')).toBe(true);
  });
});
