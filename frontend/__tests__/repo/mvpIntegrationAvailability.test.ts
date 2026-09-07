/**
 * What the client advertises matches what production can actually do.
 *
 * ## What went wrong
 *
 * Step 9 probed the live project and found two integrations offered to users
 * as `status: 'available'` whose backends could not serve them:
 *
 *   Google Calendar  google-auth was never deployed. Live: 404 NOT_FOUND. The
 *                    screen called it on mount, so opening Integrations fired
 *                    that 404 before the user touched anything.
 *   Notion           notion-auth was deployed, but the pre-hardening build:
 *                    OAuth `state` was a bare UUID nothing verified, no
 *                    redirect allowlist enforcement, and `client_id=undefined`.
 *
 * Neither is a code defect -- both hardened implementations sit finished in
 * `supabase/functions/`. What is missing is credentials: GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET, NOTION_CLIENT_ID, NOTION_CLIENT_SECRET,
 * OAUTH_STATE_SECRET and OAUTH_REDIRECT_ALLOWLIST are all absent from the
 * project's edge secrets. The owner's decision was to ship the MVP without
 * these two rather than guess at values.
 *
 * ## Why the assertions are spread across four files
 *
 * A status label alone does not make a feature unreachable, and this screen
 * proved it: the catalog tile honoured `status`, but the two featured cards
 * had their own `onPress`, the connect buttons lived inside modals those cards
 * opened, and two `useEffect`s called the network on mount regardless. Turning
 * one of those off and calling it done is exactly the kind of half-fix this
 * file exists to catch, so each layer is asserted separately.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  NOTION_INTEGRATION_ENABLED,
  GOOGLE_CALENDAR_INTEGRATION_ENABLED,
  SPOTIFY_OAUTH_ENABLED,
} from '../../lib/featureGates';
import { INTEGRATION_CATEGORIES } from '../../constants/integrations';

const REPO = join(__dirname, '..', '..', '..');
const screen = readFileSync(join(__dirname, '..', '..', 'app', 'screens', 'integrations.tsx'), 'utf8');
const login = readFileSync(join(__dirname, '..', '..', 'app', '(auth)', 'login.tsx'), 'utf8');
const manifest = JSON.parse(
  readFileSync(join(REPO, 'supabase', 'functions', 'DEPLOYMENT.json'), 'utf8'),
) as { functions: { slug: string; deploy: boolean }[] };

const item = (id: string) => INTEGRATION_CATEGORIES.flatMap((c) => c.items).find((i) => i.id === id);
const declared = (slug: string) => manifest.functions.find((f) => f.slug === slug);

describe('MVP integration availability matches production', () => {
  describe('the gates themselves', () => {
    it('Notion is off', () => {
      expect(NOTION_INTEGRATION_ENABLED).toBe(false);
    });

    it('Google Calendar is off', () => {
      expect(GOOGLE_CALENDAR_INTEGRATION_ENABLED).toBe(false);
    });

    it('Spotify stays off', () => {
      // Unrelated decision, same invariant: outside the MVP, and its production
      // function is decommissioned.
      expect(SPOTIFY_OAUTH_ENABLED).toBe(false);
    });
  });

  describe('the catalog does not advertise them', () => {
    it('Notion is not listed as available', () => {
      expect(item('notion')).toBeDefined();
      expect(item('notion')!.status).not.toBe('available');
    });

    it('Google Calendar is not listed as available', () => {
      expect(item('calendar')).toBeDefined();
      expect(item('calendar')!.status).not.toBe('available');
    });

    it('only integrations that actually work are available', () => {
      // `webhook` is the one that survives: it is local, needs no OAuth and no
      // edge function. If this list grows, something was advertised without
      // anyone checking production can serve it.
      const available = INTEGRATION_CATEGORIES.flatMap((c) => c.items)
        .filter((i) => i.status === 'available')
        .map((i) => i.id)
        .sort();
      expect(available).toEqual(['webhook']);
    });
  });

  describe('the UI cannot start either flow', () => {
    it('the featured cards are gated, not merely relabelled', () => {
      // Both cards carried their own onPress straight into the modal that holds
      // the connect button, independent of catalog status.
      expect(screen).toContain('onPress={NOTION_INTEGRATION_ENABLED ? () => setNotionModal(true) : undefined}');
      expect(screen).toContain('onPress={GOOGLE_CALENDAR_INTEGRATION_ENABLED ? () => setGoogleModal(true) : undefined}');
      expect(screen).toContain('disabled={!NOTION_INTEGRATION_ENABLED}');
      expect(screen).toContain('disabled={!GOOGLE_CALENDAR_INTEGRATION_ENABLED}');
    });

    it('the catalog route into the modals is guarded too', () => {
      expect(screen).toContain("if (item.id === 'notion' && !NOTION_INTEGRATION_ENABLED) return;");
      expect(screen).toContain("if (item.id === 'calendar' && !GOOGLE_CALENDAR_INTEGRATION_ENABLED) return;");
    });

    it('no status call is made on mount', () => {
      // This is the one a disabled button cannot fix: fetchGoogleStatus hit a
      // function that does not exist, so merely opening the screen produced a
      // 404.
      expect(screen).toContain('if (NOTION_INTEGRATION_ENABLED) fetchStatus();');
      expect(screen).toContain('if (GOOGLE_CALENDAR_INTEGRATION_ENABLED) fetchGoogleStatus();');
    });

    it('the OAuth url is not prefetched', () => {
      expect(screen).toContain('if (!NOTION_INTEGRATION_ENABLED) return;');
    });

    it('the screen no longer claims both are ready', () => {
      expect(screen).not.toContain('Notion ve Google Calendar bağlantısı hazır');
    });

    it('the login screen does not offer "sign in with Notion"', () => {
      // The sharpest edge of the three, and the one furthest from the
      // integrations screen: signing in with Notion goes through the same
      // notion-auth function, so this button was a guaranteed failure on the
      // first screen of the app. Gating only the Integrations surface would
      // have left it.
      expect(login).toContain('{NOTION_INTEGRATION_ENABLED && (');
      const buttonAt = login.indexOf('Notion ile Giriş');
      const gateAt = login.indexOf('{NOTION_INTEGRATION_ENABLED && (');
      expect(buttonAt).toBeGreaterThan(-1);
      expect(gateAt).toBeGreaterThan(-1);
      expect(gateAt).toBeLessThan(buttonAt);
    });
  });

  describe('the deployment manifest records the decision', () => {
    it('notion-auth is intentionally not deployed', () => {
      expect(declared('notion-auth')).toBeDefined();
      expect(declared('notion-auth')!.deploy).toBe(false);
    });

    it('google-auth is intentionally not deployed', () => {
      expect(declared('google-auth')).toBeDefined();
      expect(declared('google-auth')!.deploy).toBe(false);
    });

    it('spotify-auth stays decommissioned', () => {
      expect(declared('spotify-auth')!.deploy).toBe(false);
    });

    it('the functions the MVP does depend on are still required', () => {
      // The invariant must not have been weakened into "nothing is expected":
      // generate-routine spends money and notion-sync writes user data, and a
      // manifest that expects neither would pass while production was empty.
      expect(declared('generate-routine')!.deploy).toBe(true);
      expect(declared('notion-sync')!.deploy).toBe(true);
      expect(declared('subscription-webhook')!.deploy).toBe(true);
    });
  });

  describe('the backend work is preserved, not deleted', () => {
    it.each(['google-auth', 'notion-auth'])('%s hardened source still exists', (slug) => {
      // Unavailable is a product decision about this release. The hardened
      // implementations are what make re-enabling a configuration change rather
      // than a rewrite.
      const src = readFileSync(join(REPO, 'supabase', 'functions', slug, 'index.ts'), 'utf8');
      expect(src).toContain('verifyState');
      expect(src).toContain('isAllowedRedirect');
    });
  });
});
