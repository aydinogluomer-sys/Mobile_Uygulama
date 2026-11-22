const mockMem = new Map<string, string>();
const mockStorageControl: { getItemHook: ((k: string) => Promise<string | null>) | null } = {
  getItemHook: null,
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => {
    if (mockStorageControl.getItemHook) return mockStorageControl.getItemHook(k);
    return mockMem.get(k) ?? null;
  }),
  setItem: jest.fn(async (k: string, v: string) => {
    mockMem.set(k, v);
  }),
  removeItem: jest.fn(async (k: string) => {
    mockMem.delete(k);
  }),
  multiRemove: jest.fn(async (ks: readonly string[]) => {
    ks.forEach((k) => mockMem.delete(k));
  }),
}));

import { endAccountScope, resetAccountMemory } from '../../lib/accountScope';
import {
  DEFAULT_SHORTCUT_ROUTES,
  LEGACY_DRAWER_KEY,
  drawerKey,
  useDrawerStore,
} from '../../store/drawerStore';

describe('F28 (NAV-21) — drawerStoreScoped', () => {
  beforeEach(() => {
    mockMem.clear();
    mockStorageControl.getItemHook = null;
    resetAccountMemory('signed_out');
  });

  it('(+) scopes storage key by uid and isolates Account A shortcuts from Account B', async () => {
    expect(drawerKey('user-A')).toBe('aderyth:drawer_shortcuts_v1:user-A');

    await useDrawerStore.getState().hydrateShortcuts('user-A');
    useDrawerStore.getState().toggleShortcut('/screens/calendar');
    expect(useDrawerStore.getState().shortcutRoutes).toContain('/screens/calendar');
    expect(mockMem.has('aderyth:drawer_shortcuts_v1:user-A')).toBe(true);

    // Sign out preserves A's AsyncStorage entry while resetting in-memory state to defaults
    await endAccountScope('signed_out', 'user-A');
    expect(useDrawerStore.getState().shortcutRoutes).toEqual([...DEFAULT_SHORTCUT_ROUTES]);
    expect(mockMem.has('aderyth:drawer_shortcuts_v1:user-A')).toBe(true);

    // Switch to B: B sees defaults, never A's '/screens/calendar'
    await useDrawerStore.getState().hydrateShortcuts('user-B');
    expect(useDrawerStore.getState().shortcutRoutes).toEqual([...DEFAULT_SHORTCUT_ROUTES]);
    expect(useDrawerStore.getState().shortcutRoutes).not.toContain('/screens/calendar');

    // Account deletion removes the deleted user's key from AsyncStorage
    await endAccountScope('account_deleted', 'user-A');
    expect(mockMem.has('aderyth:drawer_shortcuts_v1:user-A')).toBe(false);
  });

  it('(+) migrates legacy global key once for the first account and deletes it so second account gets defaults (-)', async () => {
    mockMem.set(
      LEGACY_DRAWER_KEY,
      JSON.stringify(['/screens/okr', '/screens/notes', '/screens/unknown-ghost']),
    );

    await useDrawerStore.getState().hydrateShortcuts('user-A');
    // Valid routes adopted, unknown route filtered out, legacy key deleted
    expect(useDrawerStore.getState().shortcutRoutes).toEqual(['/screens/okr', '/screens/notes']);
    expect(mockMem.get('aderyth:drawer_shortcuts_v1:user-A')).toBe(
      JSON.stringify(['/screens/okr', '/screens/notes']),
    );
    expect(mockMem.has(LEGACY_DRAWER_KEY)).toBe(false);

    // Second user does NOT inherit migrated legacy shortcuts (-)
    resetAccountMemory('user_changed');
    await useDrawerStore.getState().hydrateShortcuts('user-B');
    expect(useDrawerStore.getState().shortcutRoutes).toEqual([...DEFAULT_SHORTCUT_ROUTES]);
  });

  it('(-) discards in-flight hydrateShortcuts result when accountEpoch advances mid-read', async () => {
    let resolveRead!: (v: string | null) => void;
    mockStorageControl.getItemHook = () =>
      new Promise<string | null>((resolve) => {
        resolveRead = resolve;
      });

    const pending = useDrawerStore.getState().hydrateShortcuts('user-A');

    // User switches before AsyncStorage resolves
    resetAccountMemory('user_changed');

    resolveRead(JSON.stringify(['/screens/okr']));
    await pending;

    expect(useDrawerStore.getState().shortcutRoutes).toEqual([...DEFAULT_SHORTCUT_ROUTES]);
    expect(useDrawerStore.getState().hydrated).toBe(false);
  });

  it('(+) preserves open/close/toggle/moreOpen UI API', () => {
    expect(useDrawerStore.getState().isOpen).toBe(false);
    useDrawerStore.getState().open();
    expect(useDrawerStore.getState().isOpen).toBe(true);
    useDrawerStore.getState().toggle();
    expect(useDrawerStore.getState().isOpen).toBe(false);
    useDrawerStore.getState().setMoreOpen(true);
    expect(useDrawerStore.getState().moreOpen).toBe(true);
    useDrawerStore.getState().close();
    expect(useDrawerStore.getState().isOpen).toBe(false);
  });
});
