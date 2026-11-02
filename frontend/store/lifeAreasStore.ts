import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import {
  fetchRecentLifeAreaLogs,
  upsertLifeAreaLogs,
} from '../repositories/lifeAreaRepository';
import { todayLocal } from '../lib/date';
import { readCachedSnapshot, setCachedSnapshot } from '../lib/localReadCache';
import { currentUser } from '../lib/session';
import { coreOutbox } from '../services/coreOutbox';

export const LIFE_AREAS = [
  { key: 'saglik', label: 'Sağlık', color: '#10b981' },
  { key: 'kariyer', label: 'Kariyer', color: '#6366f1' },
  { key: 'egitim', label: 'Eğitim', color: '#f59e0b' },
  { key: 'finans', label: 'Finans', color: '#06b6d4' },
  { key: 'aile', label: 'Aile', color: '#ec4899' },
  { key: 'sosyal', label: 'Sosyal', color: '#8b5cf6' },
  { key: 'ruhsal', label: 'Ruhsal', color: '#84cc16' },
  { key: 'hobiler', label: 'Hobiler', color: '#f97316' },
] as const;

export type AreaKey = typeof LIFE_AREAS[number]['key'];

export type AreaValues = Record<AreaKey, number>;

export const LIFE_AREA_ENTITY = 'life_area_log';
const LIFE_AREAS_CACHE_KEY = 'life_areas:latest';

const DEFAULT_VALUES: AreaValues = {
  saglik: 5, kariyer: 5, egitim: 5, finans: 5,
  aile: 5, sosyal: 5, ruhsal: 5, hobiler: 5,
};

type CachedLifeAreas = {
  values: AreaValues;
  lastSavedDate: string | null;
};

async function safeUserId(): Promise<string | null> {
  try {
    return (await currentUser())?.id ?? null;
  } catch {
    return null;
  }
}

function applyPendingLifeAreaOverlay(base: CachedLifeAreas): CachedLifeAreas {
  const box = coreOutbox.state();
  if (!box) return base;
  const pending = [...box.commands]
    .filter((c) => c.entity === LIFE_AREA_ENTITY)
    .sort((a, b) => a.seq - b.seq);
  if (pending.length === 0) return base;
  const last = pending[pending.length - 1];
  const merged = { ...base.values };
  for (const [k, v] of Object.entries(last.payload)) {
    if (typeof v === 'number') {
      merged[k as AreaKey] = v;
    }
  }
  const latestDate =
    !base.lastSavedDate || last.entityId >= base.lastSavedDate
      ? last.entityId
      : base.lastSavedDate;
  return { values: merged, lastSavedDate: latestDate };
}

type LifeAreasStore = {
  values: AreaValues;
  lastSavedDate: string | null;
  loading: boolean;
  saving: boolean;
  loadLatest: () => Promise<void>;
  setValue: (area: AreaKey, value: number) => void;
  save: () => Promise<void>;
};

export const useLifeAreasStore = create<LifeAreasStore>((set, get) => ({
  values: { ...DEFAULT_VALUES },
  lastSavedDate: null,
  loading: false,
  saving: false,

  loadLatest: async () => {
    await coreOutbox.ensure();
    const uid = await safeUserId();
    const cached = uid ? await readCachedSnapshot<CachedLifeAreas>(uid, LIFE_AREAS_CACHE_KEY) : null;
    if (cached) {
      const overlaid = applyPendingLifeAreaOverlay(cached.data);
      set({ values: overlaid.values, lastSavedDate: overlaid.lastSavedDate, loading: false });
    } else {
      set({ loading: true });
    }

    const res = await fetchRecentLifeAreaLogs();
    if (res.ok && res.data.length > 0) {
      const latestDate = res.data[0].date;
      const vals: Partial<AreaValues> = {};
      for (const row of res.data.filter((r) => r.date === latestDate)) {
        vals[row.area as AreaKey] = row.value;
      }
      const fresh: CachedLifeAreas = {
        values: { ...DEFAULT_VALUES, ...vals },
        lastSavedDate: latestDate,
      };
      if (uid) {
        void setCachedSnapshot(uid, LIFE_AREAS_CACHE_KEY, fresh);
      }
      const overlaid = applyPendingLifeAreaOverlay(fresh);
      set({ values: overlaid.values, lastSavedDate: overlaid.lastSavedDate, loading: false });
      return;
    }
    set({ loading: false });
  },

  setValue: (area, value) => {
    set((s) => ({ values: { ...s.values, [area]: value } }));
  },

  save: async () => {
    set({ saving: true });
    const today = todayLocal();
    const { values } = get();
    const payload = Object.fromEntries(LIFE_AREAS.map((a) => [a.key, values[a.key]]));

    const res = await upsertLifeAreaLogs(today, payload);
    if (res.ok) {
      const uid = await safeUserId();
      if (uid) {
        void setCachedSnapshot<CachedLifeAreas>(uid, LIFE_AREAS_CACHE_KEY, {
          values: { ...values },
          lastSavedDate: today,
        });
      }
      set({ lastSavedDate: today, saving: false });
      return;
    }

    if (res.offline) {
      const queued = await coreOutbox.write({
        entity: LIFE_AREA_ENTITY,
        entityId: today,
        kind: 'update',
        payload,
      });
      if (queued.ok) {
        const uid = await safeUserId();
        if (uid) {
          void setCachedSnapshot<CachedLifeAreas>(uid, LIFE_AREAS_CACHE_KEY, {
            values: { ...values },
            lastSavedDate: today,
          });
        }
        set({ lastSavedDate: today, saving: false });
        return;
      }
    }

    // A non-offline server rejection still refuses to record `lastSavedDate`.
    set({ saving: false });
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'lifeAreas', store: useLifeAreasStore });
