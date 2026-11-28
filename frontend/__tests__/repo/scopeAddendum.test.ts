/**
 * The owner's scope addendum of 2026-09-13 stays applied.
 *
 * `docs/plan/21_KAPSAM_EKI_2026-09-13.md` outranks every older plan and audit
 * document. It defers five integrations/commercial layers, defers the native
 * surfaces and the web/store work, and permanently cancels three feature
 * families (F13 RPG/pet/garden, F14 finance, F15 live body doubling /
 * clinical). Older documents still describe some of these as "to do", which
 * is exactly how a deferred feature creeps back in: someone reads the old
 * backlog, not the override.
 *
 * So this file pins the addendum in the one place a plan document cannot be
 * ignored -- CI. The gates it names must stay `false`, the dependencies the
 * cancelled features would need must stay absent, and no route may appear
 * for them. Flipping any of it should require editing this test, which is
 * the point: it turns "an agent forgot" into "an agent had to delete an
 * assertion that names the owner's decision".
 *
 * What it deliberately does NOT assert: that the dormant gamification schema
 * on the server (pet_stages, quests, shop_items, ...) is gone. The addendum
 * cancels building those features; removing the leftover tables is a
 * separate, approved migration. The invariant here is that the CLIENT never
 * surfaces them.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  SPOTIFY_OAUTH_ENABLED,
  NOTION_INTEGRATION_ENABLED,
  GOOGLE_CALENDAR_INTEGRATION_ENABLED,
  PAID_SUBSCRIPTIONS_ENABLED,
  PUBLIC_SITE_URLS_LIVE,
} from '../../lib/featureGates';

const FRONTEND = join(__dirname, '..', '..');
const REPO = join(FRONTEND, '..');
const pkg = JSON.parse(readFileSync(join(FRONTEND, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

/** Every app/components source file, for route and identifier scans. */
function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) { walk(abs, `${rel}/${entry}`); continue; }
      if (/\.tsx?$/.test(entry)) out.push({ path: `${rel}/${entry}`, text: readFileSync(abs, 'utf8') });
    }
  };
  for (const d of ['app', 'components', 'store', 'services', 'repositories']) {
    if (existsSync(join(FRONTEND, d))) walk(join(FRONTEND, d), d);
  }
  return out;
}
const SRC = sources();

describe('the addendum is in the repository and outranks older documents', () => {
  const path = join(REPO, 'docs', 'plan', '21_KAPSAM_EKI_2026-09-13.md');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('carries the owner override and the precedence rule verbatim', () => {
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('Owner Override');
    expect(text).toContain('Güncel yorumlama önceliği');
    expect(text).toContain('TAMAMEN İPTAL');
  });
});

describe('§6.1 — deferred integrations and commercial layers stay off', () => {
  it('every gate is false', () => {
    expect(GOOGLE_CALENDAR_INTEGRATION_ENABLED).toBe(false);
    expect(NOTION_INTEGRATION_ENABLED).toBe(false);
    expect(SPOTIFY_OAUTH_ENABLED).toBe(false);
    expect(PAID_SUBSCRIPTIONS_ENABLED).toBe(false);
  });

  it('no billing SDK has been added', () => {
    for (const name of ['react-native-purchases', 'react-native-iap', 'expo-in-app-purchases', '@stripe/stripe-react-native']) {
      expect(deps[name]).toBeUndefined();
    }
  });

  it('the deferred edge functions are still not marked for deployment', () => {
    const manifest = JSON.parse(readFileSync(join(REPO, 'supabase', 'functions', 'DEPLOYMENT.json'), 'utf8')) as {
      functions: { slug: string; deploy: boolean }[];
    };
    for (const slug of ['google-auth', 'notion-auth']) {
      const entry = manifest.functions.find((f) => f.slug === slug);
      expect(entry).toBeDefined();
      expect(entry!.deploy).toBe(false);
    }
  });
});

describe('§6.2 — native surfaces are not started', () => {
  it('no widget / live activity / wearable packages', () => {
    for (const name of ['expo-widgets', 'react-native-android-widget', 'expo-live-activity', 'react-native-watch-connectivity', 'react-native-wear-connectivity']) {
      expect(deps[name]).toBeUndefined();
    }
  });

  it('still a managed workflow -- native project directories are not part of the source tree', () => {
    // `ios/` and `android/` may exist locally after a disposable prebuild;
    // what matters is that they are generated, not committed. The gitignore
    // is the contract.
    const ignore = readFileSync(join(FRONTEND, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(ignore.some((l) => /^\/?android\/?$/.test(l))).toBe(true);
    expect(ignore.some((l) => /^\/?ios\/?$/.test(l))).toBe(true);
  });
});

describe('§6.3 — web/store work is a separate release phase', () => {
  it('PUBLIC_SITE_URLS_LIVE is an explicit boolean and when true all 3 pages have zero placeholders', () => {
    expect(typeof PUBLIC_SITE_URLS_LIVE).toBe('boolean');
    if (PUBLIC_SITE_URLS_LIVE) {
      for (const f of ['docs/store/web/privacy.html', 'docs/store/web/support.html', 'docs/store/web/delete-account.html']) {
        expect(readFileSync(join(REPO, f), 'utf8')).not.toMatch(/\{\{[^}]+\}\}/);
      }
    }
  });

  it('the store docs and the page content are still present (deferred, not deleted)', () => {
    for (const f of ['docs/store/OWNER_DECISIONS.md', 'docs/store/web/privacy.html', 'docs/store/web/support.html', 'docs/store/web/delete-account.html']) {
      expect(existsSync(join(REPO, f))).toBe(true);
    }
  });
});

describe('§6.5 — permanently cancelled features never reach the client', () => {
  it('F13: no pet / garden / avatar-dressing / RPG route or store', () => {
    // Route files under app/ ARE routes. None of these may exist by name.
    const banned = /\/(pet|pets|garden|bahce|bahçe|avatar|shop|store-front|quest|quests|boss|skills?|inventory)\.tsx?$/i;
    const offenders = SRC.filter((f) => f.path.startsWith('app/') && banned.test(f.path)).map((f) => f.path);
    expect(offenders).toEqual([]);
    // And no client code calls the dormant gamification RPCs / tables.
    const rpc = /interact_with_pet|buy_shop_item|upgrade_skill|claim_quest_reward|deal_damage_to_active_boss|user_pets|pet_stages|global_bosses|boss_contributors|shop_items|user_quests|user_skills/;
    const callers = SRC.filter((f) => rpc.test(f.text)).map((f) => f.path);
    expect(callers).toEqual([]);
  });

  it('F14: no finance module', () => {
    const banned = /\/(finance|finans|budget|butce|bütçe|expenses?|gider|income|gelir|wallet|cuzdan|cüzdan|currency|doviz|döviz)\.tsx?$/i;
    const offenders = SRC.filter((f) => f.path.startsWith('app/') && banned.test(f.path)).map((f) => f.path);
    expect(offenders).toEqual([]);
    // The word "budget" is allowed in code: it is the daily WILLPOWER budget
    // (`capacityService`, `willpowerStore`), which is the product, not money.
  });

  it('F15: no live rooms, no WebRTC, no clinical claims', () => {
    for (const name of ['react-native-webrtc', '@livekit/react-native', 'agora-react-native-rtc', 'react-native-agora', '@daily-co/react-native-daily-js', 'twilio-video']) {
      expect(deps[name]).toBeUndefined();
    }
    const banned = /\/(body-?doubl\w*|live-?room|coworking|clinic|klinik|therapy|terapi)\.tsx?$/i;
    const offenders = SRC.filter((f) => f.path.startsWith('app/') && banned.test(f.path)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
