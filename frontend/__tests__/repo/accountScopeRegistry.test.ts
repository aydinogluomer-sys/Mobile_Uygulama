/**
 * F04 (STO-01, NAV-02, STO-13, STO-22) — the account registry stays complete, statically.
 *
 * ## Why this file exists
 *
 * Before F04 three of 29 stores were reset when an account signed out; nothing noticed when a new
 * store was added without a reset. This gate makes that a red test: every `store/*.ts` that creates
 * a Zustand store either registers itself in `lib/accountScope.ts` or is named here as device-level
 * (and `sessionAccountIsolation.test.ts` proves the same thing by behaviour). It also holds the
 * wiring the registry depends on: the root layout, the recovery sign-out, the account deletion and
 * the Settings sign-out all go through it, and a new constant storage key has to say whether it
 * belongs to a user.
 *
 * Every rule is a pure function; each is also fed synthetic text with exactly the defect it exists
 * to catch.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const read = (p: string): string => readFileSync(join(FRONTEND, p), 'utf8').replace(/\r\n?/g, '\n');
const code = (p: string): string => stripComments(read(p));

/** Stores that describe this device, not the person using it. */
const DEVICE_LEVEL_STORES = ['themeStore.ts', 'commandStore.ts'];

/**
 * Constant storage keys that carry no user id, each with its reason. A new one makes this test red
 * until someone decides: does it belong to a user (then the key gets the uid), or to the device?
 */
const KNOWN_UNSCOPED_KEYS: Record<string, string> = {
  app_theme_mode: 'device display preference',
  app_theme_dark: 'device display preference',
  app_seasonal_motion: 'device display preference',
  app_accent: 'device display preference',
  app_haptics: 'device haptic feedback preference',
  'aderyth:drawer_shortcuts_v1': 'legacy unscoped drawer shortcuts key, read once to migrate to aderyth:drawer_shortcuts_v1:<uid> (F28)',
  app_cmd_recents: 'device command palette history',
  'aderyth:focus_flow_saved_v1': 'device focus-flow bookmarks',
  'reminders.settings.v1': 'device reminder preference',
  'reminders.handled.v1': 'device notification bookkeeping',
  atlas_sync_queue_v1: 'legacy unscoped queue, read once to migrate (lib/syncQueue.ts)',
  atlas_sync_quarantine_v1: 'F05: ops of other accounts held aside, each stamped with its userId and adopted only by it; swept on account deletion (lib/syncQueue.ts)',
  atlas_notion_login_session: 'legacy unscoped session, read once to migrate',
  'aderyth.rcache.v1': 'prefix: the uid follows (lib/localReadCache.ts)',
  'focus.settings.v1': 'prefix: the uid follows (F04)',
  'focus.session.v1': 'prefix: the uid follows (F04)',
  'aderyth.coach.lastConversationId': 'prefix: the uid follows (F04)',
  'aderyth.deflected_urges_count': 'prefix: the uid follows (F04)',
  'aderyth:disclosure:v1:': 'prefix: the uid follows (F27)',
  'today_bootstrap:v1:': 'prefix of a read-cache entry name',
  'goals:p1': 'read-cache entry name, stored under the user id',
  'life_areas:latest': 'read-cache entry name, stored under the user id',
  'notes:p1': 'read-cache entry name, stored under the user id',
  'projects:p1': 'read-cache entry name, stored under the user id',
  'reading:counts': 'read-cache entry name, stored under the user id',
  'pending-': 'not a storage key: a local id prefix',
  key_result: 'not a storage key: an outbox entity name',
  habit_log_key_immutable: 'not a storage key: a server error token',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'not a storage key: build-time public env variable name (lib/env.ts)',
  'config-missing': 'not a storage key: placeholder anon key when public env is missing (lib/env.ts)',
  created_day: 'not a storage key: frequency_config jsonb property name for habit creation day (lib/habitCreatedDay.ts)',
};

// ---------------------------------------------------------------------------------------
// the rules as pure functions
// ---------------------------------------------------------------------------------------

/** Store files that create a Zustand store and neither register nor are device-level. */
export function unregisteredStores(files: { name: string; text: string }[], deviceLevel: readonly string[]): string[] {
  return files
    .filter((f) => /\bcreate\s*</.test(f.text) || /\bcreate\s*\(\s*\(/.test(f.text))
    .filter((f) => !deviceLevel.includes(f.name) && !/\bregisterAccountScoped\s*\(/.test(f.text))
    .map((f) => f.name);
}

/** `const SOME_KEY = 'literal'` constants (names with KEY or PREFIX) whose literal is not allow-listed. */
export function unscopedKeyConstants(files: { name: string; text: string }[], known: Record<string, string>): string[] {
  const out: string[] = [];
  for (const f of files) {
    for (const m of f.text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*(?:KEY|PREFIX)[A-Z0-9_]*)\s*=\s*['`]([^'`]+)['`]/g)) {
      const literal = m[2];
      if (/\s/.test(literal)) continue; // a message, not a key
      if (!(literal in known)) out.push(`${f.name}: ${m[1]} = '${literal}'`);
    }
  }
  return out;
}

const registeredNames = (texts: string[]): string[] =>
  texts.flatMap((t) => [...t.matchAll(/registerAccountScoped\(\{\s*name:\s*'([^']+)'/g)].map((m) => m[1]));

const filesIn = (dir: string, ext: RegExp): { name: string; path: string }[] => {
  const out: { name: string; path: string }[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(FRONTEND, rel), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const p = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (ext.test(entry.name)) out.push({ name: entry.name, path: p });
    }
  };
  walk(dir);
  return out;
};

// ---------------------------------------------------------------------------------------
const storeFiles = readdirSync(join(FRONTEND, 'store')).filter((f) => f.endsWith('.ts')).sort();
const stores = storeFiles.map((name) => ({ name, text: code(`store/${name}`) }));

describe('every store is registered or named device-level', () => {
  it('the scan sees the stores (at least 29)', () => {
    expect(stores.length).toBeGreaterThanOrEqual(29);
    expect(stores.filter((s) => /\bcreate\s*</.test(s.text)).length).toBeGreaterThanOrEqual(29);
  });

  it('no store is left out of the registry', () => {
    expect(unregisteredStores(stores, DEVICE_LEVEL_STORES)).toEqual([]);
  });

  it('device-level stores really exist and really do not register (the allow list is not stale)', () => {
    for (const f of DEVICE_LEVEL_STORES) {
      const s = stores.find((x) => x.name === f);
      expect({ f, exists: !!s, registers: /registerAccountScoped\(/.test(s?.text ?? '') }).toEqual({ f, exists: true, registers: false });
    }
  });

  it('registered names are unique', () => {
    const names = registeredNames([
      ...stores.map((s) => s.text),
      code('services/coreOutbox.ts'),
      code('services/timeZoneSyncService.ts'),
    ]);
    expect(names.length).toBeGreaterThanOrEqual(28);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('catches a store that does not register, and accepts one that does (synthetic)', () => {
    const bad = { name: 'newStore.ts', text: "export const useNewStore = create<S>((set) => ({ a: 1 }));" };
    const good = { name: 'okStore.ts', text: "export const useOkStore = create<S>((set) => ({ a: 1 }));\nregisterAccountScoped({ name: 'ok', store: useOkStore });" };
    const plain = { name: 'plainStore.ts', text: 'export const useP = create((set) => ({ a: 1 }));' };
    expect(unregisteredStores([bad, good, plain], [])).toEqual(['newStore.ts', 'plainStore.ts']);
    expect(unregisteredStores([bad], ['newStore.ts'])).toEqual([]);
  });

  it('catches a repeated name (synthetic)', () => {
    const names = registeredNames(["registerAccountScoped({ name: 'x' });", "registerAccountScoped({ name: 'x', store: s });"]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual(['x']);
  });
});

describe('user-scoped keys', () => {
  const sources = [
    ...filesIn('store', /\.ts$/), ...filesIn('components', /\.tsx?$/), ...filesIn('lib', /\.ts$/), ...filesIn('services', /\.ts$/),
  ].map((f) => ({ name: f.path, text: code(f.path) }));

  it('every constant storage key is either allow-listed with a reason or carries the uid', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(unscopedKeyConstants(sources, KNOWN_UNSCOPED_KEYS)).toEqual([]);
  });

  it('catches a new unscoped key, and ignores a message string (synthetic)', () => {
    const files = [{ name: 'x.ts', text: "const DRAFT_KEY = 'my.draft.v1';\nconst ERR_KEY_MESSAGE = 'Bir şey oldu.';\nconst THEME_KEY = 'app_accent';" }];
    expect(unscopedKeyConstants(files, KNOWN_UNSCOPED_KEYS)).toEqual(["x.ts: DRAFT_KEY = 'my.draft.v1'"]);
  });

  it('focus, coach and urge keys are built with the user id; the bare focus session key is only the prefix', () => {
    const focus = code('store/focusStore.ts');
    expect(focus).toContain('export const sessionKey = (uid: string): string => `${SESSION_KEY_PREFIX}.${uid}`;');
    expect(focus).toContain('export const settingsKey = (uid: string): string => `${SETTINGS_KEY_PREFIX}.${uid}`;');
    expect(focus.match(/'focus\.session\.v1'/g)).toHaveLength(1);
    expect(focus).toMatch(/export const SESSION_KEY_PREFIX = 'focus\.session\.v1';/);
    expect(focus).not.toMatch(/AsyncStorage\.(?:getItem|setItem)\(SESSION_KEY_PREFIX/);
    expect(code('store/aiConversationStore.ts')).toContain('export const lastActiveKey = (uid: string): string => `${LAST_ACTIVE_KEY_PREFIX}:${uid}`;');
    expect(code('store/aiConversationStore.ts')).not.toMatch(/AsyncStorage\.(?:getItem|setItem)\(LAST_ACTIVE_KEY_PREFIX/);
    expect(code('components/BadHabitsTracker.tsx')).toContain('export const urgeStorageKey = (uid: string): string => `${URGE_STORAGE_KEY_PREFIX}:${uid}`;');
    expect(code('components/BadHabitsTracker.tsx')).not.toMatch(/AsyncStorage\.(?:getItem|setItem)\(URGE_STORAGE_KEY_PREFIX/);
  });
});

describe('every account boundary goes through the registry', () => {
  it('the root layout: sign-out and a changed user, with the last uid remembered', () => {
    const layout = code('app/_layout.tsx');
    expect(layout).toContain("endAccountScope('signed_out', prevUid)");
    expect(layout).toContain("endAccountScope('user_changed', prevUid)");
    expect(layout).toMatch(/else if \(prevUid && nextUid && prevUid !== nextUid\)/);
    expect(layout).toContain('lastUidRef.current = nextUid;');
    expect(layout).toContain('lastUidRef.current = session?.user?.id ?? null;');
    // the old hand-written pair is gone: the registry resets both
    expect(layout).not.toMatch(/useTaskStore\.getState\(\)\.resetForAccount\(\)/);
  });

  it('the recovery sign-out uses signOutLocal and never a bare supabase sign-out', () => {
    const reset = code('app/(auth)/reset-password.tsx');
    expect(reset).toContain('await signOutLocal()');
    expect(reset).not.toMatch(/supabase\.auth\.signOut\(/);
  });

  it('account deletion and the local sign-out call the registry; signOut lives in accountService only', () => {
    const svc = code('services/accountService.ts');
    expect(svc).toContain("await endAccountScope('account_deleted', userId);");
    expect(svc).toContain("await endAccountScope('signed_out', uid);");
    expect(svc).toContain("supabase.auth.signOut({ scope: 'local' })");
    const callers = filesIn('app', /\.tsx?$/).concat(filesIn('components', /\.tsx?$/), filesIn('store', /\.ts$/), filesIn('lib', /\.ts$/))
      .filter((f) => /\bauth\.signOut\(/.test(code(f.path))).map((f) => f.path);
    expect(callers).toEqual([]);
  });

  it('the read cache of a user is wiped by the registry (STO-03): clearUserReadCache is called in production', () => {
    const scope = code('lib/accountScope.ts');
    expect(scope).toContain('await clearUserReadCache(userId);');
    expect(scope).toContain('await clearAllReadCache();');
    expect(scope).not.toMatch(/from '\.\.\/store\//); // lib never imports a store
  });

  it('Settings: the sign-out sits above the deletion and uses the modal, not Alert', () => {
    const settings = [
      code('app/tabs/settings.tsx'),
      code('components/settings/AccountSection.tsx'),
    ].join('\n');
    expect(settings).toContain('signOutCurrentAccount');
    expect(settings).toContain('<SignOutConfirmModal');
    expect(settings.indexOf('Oturumu Kapat')).toBeGreaterThan(-1);
    expect(settings.indexOf('Oturumu Kapat')).toBeLessThan(settings.indexOf('Hesabı Sil'));
    const modal = code('components/SignOutConfirmModal.tsx');
    expect(modal).not.toMatch(/Alert\.alert/);
    expect(modal).toContain('accessibilityViewIsModal');
    expect(modal).toContain("animationType={reduceMotion ? 'none' : 'fade'}");
    expect((modal.match(/minHeight: 48/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
