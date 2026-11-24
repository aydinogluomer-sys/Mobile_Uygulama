import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  accountEpoch,
  registerAccountScoped,
  registerAccountStorage,
} from '../lib/accountScope';
import { destinationForLegacyRoute } from '../lib/destinations';

export const LEGACY_DRAWER_KEY = 'aderyth:drawer_shortcuts_v1';

export function drawerKey(userId: string): string {
  return `${LEGACY_DRAWER_KEY}:${userId}`;
}

export const DEFAULT_SHORTCUT_ROUTES: string[] = [
  '/screens/okr',
  '/screens/routine-runner',
  '/screens/deep-work',
  '/screens/reading-list',
];

function sanitizeRoutes(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || !raw.every((r) => typeof r === 'string')) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    if (!destinationForLegacyRoute(r)) continue;
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

function persistRoutes(userId: string | null, routes: string[]): void {
  if (!userId) return;
  AsyncStorage.setItem(drawerKey(userId), JSON.stringify(routes)).catch(() => undefined);
}

export type DrawerStore = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  userId: string | null;
  moreOpen: boolean | null;
  setMoreOpen: (open: boolean | null) => void;
  shortcutRoutes: string[];
  hydrated: boolean;
  hydrateShortcuts: (userId?: string | null) => Promise<void>;
  addShortcut: (route: string) => void;
  removeShortcut: (route: string) => void;
  toggleShortcut: (route: string) => void;
  resetShortcuts: () => void;
};

export const useDrawerStore = create<DrawerStore>((set, get) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  userId: null,
  moreOpen: null,
  setMoreOpen: (open) => set({ moreOpen: open }),
  shortcutRoutes: [...DEFAULT_SHORTCUT_ROUTES],
  hydrated: false,

  hydrateShortcuts: async (userId?: string | null) => {
    if (!userId) return;
    if (get().hydrated && get().userId === userId) return;

    const epoch = accountEpoch();
    try {
      const userRaw = await AsyncStorage.getItem(drawerKey(userId));
      if (epoch !== accountEpoch()) return;

      if (userRaw !== null) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(userRaw);
        } catch {
          parsed = null;
        }
        const sanitized = sanitizeRoutes(parsed);
        set({
          userId,
          shortcutRoutes: sanitized ?? [...DEFAULT_SHORTCUT_ROUTES],
          hydrated: true,
        });
        return;
      }

      // First-time migration from legacy unscoped device key: adopted once by the first account only.
      const legacyRaw = await AsyncStorage.getItem(LEGACY_DRAWER_KEY);
      if (epoch !== accountEpoch()) return;

      if (legacyRaw !== null) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(legacyRaw);
        } catch {
          parsed = null;
        }
        const sanitized = sanitizeRoutes(parsed);
        await AsyncStorage.removeItem(LEGACY_DRAWER_KEY);
        if (epoch !== accountEpoch()) return;
        if (sanitized !== null) {
          await AsyncStorage.setItem(drawerKey(userId), JSON.stringify(sanitized));
          if (epoch !== accountEpoch()) return;
          set({
            userId,
            shortcutRoutes: sanitized,
            hydrated: true,
          });
          return;
        }
      }
    } catch {
      // ignore storage errors
    }

    if (epoch !== accountEpoch()) return;
    set({
      userId,
      shortcutRoutes: [...DEFAULT_SHORTCUT_ROUTES],
      hydrated: true,
    });
  },

  addShortcut: (route: string) => {
    if (!destinationForLegacyRoute(route)) return;
    const current = get().shortcutRoutes;
    if (current.includes(route)) return;
    const next = [...current, route];
    set({ shortcutRoutes: next });
    persistRoutes(get().userId, next);
  },

  removeShortcut: (route: string) => {
    const next = get().shortcutRoutes.filter((r) => r !== route);
    set({ shortcutRoutes: next });
    persistRoutes(get().userId, next);
  },

  toggleShortcut: (route: string) => {
    const current = get().shortcutRoutes;
    if (current.includes(route)) {
      const next = current.filter((r) => r !== route);
      set({ shortcutRoutes: next });
      persistRoutes(get().userId, next);
      return;
    }
    if (!destinationForLegacyRoute(route)) return;
    const next = [...current, route];
    set({ shortcutRoutes: next });
    persistRoutes(get().userId, next);
  },

  resetShortcuts: () => {
    const next = [...DEFAULT_SHORTCUT_ROUTES];
    set({ shortcutRoutes: next });
    persistRoutes(get().userId, next);
  },
}));

registerAccountScoped({ name: 'drawer', store: useDrawerStore });
registerAccountStorage({
  name: 'drawer-shortcuts',
  transient: false,
  keysFor: (uid) => [drawerKey(uid)],
});
