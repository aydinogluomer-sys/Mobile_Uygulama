/**
 * What the app promises in a release build matches what a release build can do.
 *
 * ## What went wrong
 *
 * Step 11B found `screens/paywall.tsx` shipping Nexus Plus and Nexus Pro with
 * weekly/monthly/yearly prices, an "EN POPÜLER" ribbon, an "Abone Ol" button
 * on each card, and a footnote reading "Test modu: Abone Ol şu an krediyi
 * hemen yükler. Gerçek ödeme … yayına çıkmadan eklenecek."
 *
 * None of it could complete a purchase. There is no StoreKit product, no Play
 * Billing product and no payment processor, and the RPC behind the button had
 * its EXECUTE revoked in `003_emergency_gate_0_revoke_mock_activate_…`. So a
 * reviewer would have seen a price, a dead buy button, and an internal note
 * about unfinished work — rejectable under Apple 3.1.1 and Play's payments
 * policy, and untrue regardless of any store.
 *
 * The owner's decision is FREE for the MVP. This file is the guard that the
 * decision actually reached every surface, because the same audit found the
 * promise in five places, not one: the screen, two Focus Point bars, an error
 * row inside a modal, and the drawer.
 *
 * ## Why the assertions read the source instead of rendering
 *
 * A rendered assertion proves one path. The failure mode here is a SECOND
 * entry point nobody remembered — exactly what happened with the integrations
 * screen in `mvpIntegrationAvailability.test.ts`, where the catalog honoured
 * its status flag while two featured cards carried their own `onPress`
 * straight past it. Reading every file under `app/` and `components/` catches
 * the route that was added later by someone who never saw this file.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import {
  PAID_SUBSCRIPTIONS_ENABLED,
  PUBLIC_SITE_URLS_LIVE,
  PUBLIC_SITE_URLS,
} from '../../lib/featureGates';
import { ACTION_COST, TIERS } from '../../lib/subscription';

const FRONTEND = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(FRONTEND, ...p), 'utf8');

/** Every `.ts`/`.tsx` under the UI directories, which is where a promise can be made. */
function uiSources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) { walk(abs, `${rel}/${entry}`); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      out.push({ path: `${rel}/${entry}`, text: readFileSync(abs, 'utf8') });
    }
  };
  walk(join(FRONTEND, 'app'), 'app');
  walk(join(FRONTEND, 'components'), 'components');
  return out;
}

const UI = uiSources();
const appJson = JSON.parse(read('app.json')) as {
  expo: {
    ios: { supportsTablet?: boolean };
    plugins: (string | [string, unknown])[];
  };
};

describe('FREE MVP — no production surface promises a purchase', () => {
  it('the gate is off', () => {
    expect(PAID_SUBSCRIPTIONS_ENABLED).toBe(false);
  });

  it('the paywall screen is gone, not merely unlinked', () => {
    // A file left in `app/screens/` is a ROUTE. expo-router registers it
    // whether or not anything navigates to it, so deleting the links while
    // leaving the file would keep the prices one deep link away.
    expect(existsSync(join(FRONTEND, 'app', 'screens', 'paywall.tsx'))).toBe(false);
    expect(existsSync(join(FRONTEND, 'app', 'screens', 'focus-points.tsx'))).toBe(true);
  });

  it('nothing routes to the old screen', () => {
    const offenders = UI.filter((f) => /['"`]\/screens\/paywall['"`]/.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('no screen renders a price', () => {
    // `lib/subscription.ts` KEEPS its tier prices on purpose, so that turning
    // the gate back on is a rendering change rather than archaeology. The
    // invariant is that no UI file reads them.
    const offenders = UI.filter((f) => /\bpriceLabel\b|\bPERIOD_LABEL\b|\bBillingPeriod\b/.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('no screen offers to subscribe', () => {
    // Substring, not word, because the original strings were interpolated:
    // `${cfg.name} — Abone Ol`.
    const banned = ['Abone Ol', 'Test modu', 'EN POPÜLER', 'Üyeliği Yükselt'];
    const offenders = UI
      .filter((f) => f.path !== 'app/screens/focus-points.tsx') // its doc comment quotes them
      .flatMap((f) => banned.filter((b) => f.text.includes(b)).map((b) => `${f.path}: ${b}`));
    expect(offenders).toEqual([]);
  });

  it('the Focus Points screen states the free position and names no price', () => {
    const screen = read('app', 'screens', 'focus-points.tsx');
    expect(screen).toContain('PAID_SUBSCRIPTIONS_DISABLED_REASON');
    // No dollar-amount rendering anywhere in the JSX or styles.
    expect(screen).not.toMatch(/\$\{?\d/);
  });

  it('the route registration and the drawer point at the new screen', () => {
    expect(read('app', 'screens', '_layout.tsx')).toContain('name="focus-points"');
    const drawer = read('components', 'Drawer.tsx');
    expect(drawer).toContain("route: '/screens/focus-points'");
    expect(drawer).not.toContain('Üyelik & Krediler');
  });

  it('mock activation is still compiled out of release builds', () => {
    // Two independent guards, deliberately: the store compiles the call out,
    // and the repository refuses it again so a new call site cannot route
    // around the first.
    expect(read('store', 'subscriptionStore.ts')).toContain('if (!__DEV__) return false;');
    expect(read('repositories', 'subscriptionRepository.ts')).toContain('__DEV__');
  });

  it('Focus Point economics are untouched', () => {
    // The free-MVP decision was about what is ADVERTISED. Prices and grants
    // were explicitly not engineering's to change.
    expect(ACTION_COST.coach).toBe(5);
    expect(ACTION_COST.routine).toBe(25);
    expect(TIERS.free.grant).toBe(30);
  });
});

describe('iPhone-only MVP', () => {
  it('iPad support is off', () => {
    // Was `true` by Expo default, which made the resolved Info.plist advertise
    // all four iPad orientations for an app that ships portrait-only and has
    // no iPad layout work, QA or screenshots anywhere in the repository.
    expect(appJson.expo.ios.supportsTablet).toBe(false);
  });
});

describe('Sentry carries no user content and no secret', () => {
  const client = read('lib', 'sentryClient.ts');

  it('the config plugin is registered', () => {
    const names = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain('@sentry/react-native');
  });

  it('no DSN is hard-coded', () => {
    // A DSN is public by design, but a hard-coded one pins every build to one
    // project and survives into forks. It comes from the environment.
    expect(client).not.toMatch(/https:\/\/[0-9a-f]+@[\w.-]*ingest/i);
    expect(client).toContain('process.env.EXPO_PUBLIC_SENTRY_DSN');
  });

  it('no Sentry auth token is committed anywhere', () => {
    // The source-map upload token is an EAS secret. `sntrys_` is Sentry's
    // current org-token prefix; `sntryu_` is the user-token prefix.
    const suspects = [
      read('lib', 'sentryClient.ts'),
      read('app.json'),
      read('eas.json'),
      read('app', '_layout.tsx'),
    ].join('\n');
    expect(suspects).not.toMatch(/sntrys_|sntryu_/);
  });

  it('the containers that could carry user content are deleted before send', () => {
    // `request` is the important one: an `Authorization: Bearer <supabase jwt>`
    // header, a POST body and a PostgREST URL all live there.
    for (const line of ['delete event.request;', 'delete event.user;', 'delete event.extra;']) {
      expect(client).toContain(line);
    }
    expect(client).toContain('event.breadcrumbs = [];');
  });

  it('breadcrumbs are never recorded', () => {
    // An http breadcrumb records the PostgREST URL, and PostgREST puts filter
    // VALUES in the query string — `?title=eq.<habit name>`.
    expect(client).toContain('beforeBreadcrumb: () => null');
  });

  it('messages go through the same scrubber as the rest of the app', () => {
    expect(client).toContain('scrubMessage');
    expect(client).toContain('scrubMessage(event.message).text');
  });

  it('tracing, replay, sessions and failed-request capture are off', () => {
    expect(client).toContain('sendDefaultPii: false');
    expect(client).toContain('tracesSampleRate: 0');
    expect(client).toContain('enableAutoPerformanceTracing: false');
    expect(client).toContain('enableCaptureFailedRequests: false');
    expect(client).toContain('enableAutoSessionTracking: false');
    expect(client).toContain('replaysSessionSampleRate: 0');
    expect(client).toContain('replaysOnErrorSampleRate: 0');
    // No replay integration at all, approved or otherwise.
    expect(client).not.toContain('mobileReplayIntegration');
  });

  it('it is installed at module scope, before the first render', () => {
    // Same reason `installGlobalErrorHandlers()` is: an effect runs after the
    // first commit, so a crash during boot — the one most worth reporting —
    // would happen before any sink existed.
    const layout = read('app', '_layout.tsx');
    expect(layout).toContain('initCrashReporting();');
    expect(layout.indexOf('initCrashReporting();')).toBeLessThan(layout.indexOf('export default function RootLayout'));
  });

  it('a missing DSN disables it rather than crashing boot', () => {
    expect(client).toContain('if (!DSN) return false;');
  });
});

describe('public URLs are not linked while they 404', () => {
  it('the gate reflects reality', () => {
    // Probed 2026-09-08: aderyth.com resolves and `/` answers 200, but
    // /privacy, /support and /delete-account all answer 404. Flip this only
    // together with a re-probe.
    expect(PUBLIC_SITE_URLS_LIVE).toBe(false);
  });

  it('no UI file links to them unguarded', () => {
    if (PUBLIC_SITE_URLS_LIVE) return;
    const literals = Object.values(PUBLIC_SITE_URLS);
    const offenders = UI.flatMap((f) =>
      literals.filter((u) => f.text.includes(u)).map((u) => `${f.path}: ${u}`),
    );
    expect(offenders).toEqual([]);
  });

  it('the Settings row is gated on the flag, not merely absent', () => {
    const settings = read('app', 'tabs', 'settings.tsx');
    expect(settings).toContain('{PUBLIC_SITE_URLS_LIVE && renderSettingItem(');
  });

  it('app config carries no dead URL', () => {
    if (PUBLIC_SITE_URLS_LIVE) return;
    expect(read('app.json')).not.toContain('aderyth.com');
  });

  it('the in-app paths do not depend on the website', () => {
    // Google requires an externally reachable deletion page IN ADDITION to
    // the in-app path, never instead of it. Same for the policy: the screen
    // exists so the product discloses correctly while the listing waits.
    expect(existsSync(join(FRONTEND, 'app', 'screens', 'privacy.tsx'))).toBe(true);
    const settings = read('app', 'tabs', 'settings.tsx');
    expect(settings).toContain("router.push('/screens/privacy')");
    expect(settings).toContain('handleDeleteAccount');
  });
});
