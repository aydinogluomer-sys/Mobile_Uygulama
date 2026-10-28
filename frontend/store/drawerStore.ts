import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'aderyth:drawer_shortcuts_v1';

export const DEFAULT_SHORTCUT_ROUTES: string[] = [
  '/screens/okr',
  '/screens/routine-runner',
  '/screens/deep-work',
  '/screens/reading-list',
];

function persistRoutes(routes: string[]) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(routes)).catch(() => {});
}

type DrawerStore = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  shortcutRoutes: string[];
  hydrated: boolean;
  hydrateShortcuts: () => Promise<void>;
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
  shortcutRoutes: DEFAULT_SHORTCUT_ROUTES,
  hydrated: false,

  hydrateShortcuts: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((r) => typeof r === 'string')) {
          set({ shortcutRoutes: parsed, hydrated: true });
          return;
        }
      }
    } catch {
      // ignore storage errors
    }
    set({ hydrated: true });
  },

  addShortcut: (route: string) => {
    const current = get().shortcutRoutes;
    if (current.includes(route)) return;
    const next = [...current, route];
    set({ shortcutRoutes: next });
    persistRoutes(next);
  },

  removeShortcut: (route: string) => {
    const next = get().shortcutRoutes.filter((r) => r !== route);
    set({ shortcutRoutes: next });
    persistRoutes(next);
  },

  toggleShortcut: (route: string) => {
    const current = get().shortcutRoutes;
    const next = current.includes(route)
      ? current.filter((r) => r !== route)
      : [...current, route];
    set({ shortcutRoutes: next });
    persistRoutes(next);
  },

  resetShortcuts: () => {
    set({ shortcutRoutes: DEFAULT_SHORTCUT_ROUTES });
    persistRoutes(DEFAULT_SHORTCUT_ROUTES);
  },
}));
