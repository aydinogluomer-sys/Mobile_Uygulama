import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import {
  fetchRecentLifeAreaLogs,
  upsertLifeAreaLogs,
} from '../repositories/lifeAreaRepository';
import { todayLocal } from '../lib/date';
import { createLatest } from '../lib/latestOnly';
import { safeUserIdOf, writeThrough } from '../lib/outboxEngine';
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
const DEVICE_SAVE_WARNING = 'Değişiklik cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.';

const DEFAULT_VALUES: AreaValues = {
  saglik: 5, kariyer: 5, egitim: 5, finans: 5,
  aile: 5, sosyal: 5, ruhsal: 5, hobiler: 5,
};

type CachedLifeAreas = {
  values: AreaValues;
  lastSavedDate: string | null;
};

const safeUserId = (): Promise<string | null> => safeUserIdOf(currentUser);

const lifeLatest = createLatest();

function applyPendingLifeAreaOverlay(base: CachedLifeAreas): CachedLifeAreas {
  const box = coreOutbox.state();
  if (!box) return base;
  const pending = [...box.commands]
    .filter((c) => c.entity === LIFE_AREA_ENTITY)
    .sort((a, b) => a.seq - b.seq);
  if (pending.length === 0) return base;
  const last = pending[pending.length - 1];
  if (base.lastSavedDate && last.entityId < base.lastSavedDate) return base;
  const merged = { ...base.values };
  for (const [k, v] of Object.entries(last.payload)) {
    if (typeof v === 'number') {
      merged[k as AreaKey] = v;
    }
  }
  return { values: merged, lastSavedDate: last.entityId };
}

type LifeAreasStore = {
  values: AreaValues;
  lastSavedDate: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  loadLatest: () => Promise<void>;
  setValue: (area: AreaKey, value: number) => void;
  save: () => Promise<boolean>;
};

export const useLifeAreasStore = create<LifeAreasStore>((set, get) => ({
  values: { ...DEFAULT_VALUES },
  lastSavedDate: null,
  loading: false,
  saving: false,
  error: null,

  loadLatest: async () => {
    const run = lifeLatest.begin();
    try {
      await coreOutbox.ensure();
      if (!run.isCurrent()) return;
      const uid = await safeUserId();
      if (!run.isCurrent()) return;
      const cached = uid ? await readCachedSnapshot<CachedLifeAreas>(uid, LIFE_AREAS_CACHE_KEY) : null;
      if (!run.isCurrent()) return;
      if (cached) {
        const overlaid = applyPendingLifeAreaOverlay(cached.data);
        set({ values: overlaid.values, lastSavedDate: overlaid.lastSavedDate, loading: false, error: null });
      } else {
        set({ loading: true, error: null });
      }

      const res = await fetchRecentLifeAreaLogs();
      if (!run.isCurrent()) return;
      if (!res.ok) {
        set({ loading: false, error: res.offline ? null : res.error });
        return;
      }

      const latestDate = res.data.length > 0 ? res.data[0].date : null;
      const vals: Partial<AreaValues> = {};
      if (latestDate) {
        for (const row of res.data.filter((r) => r.date === latestDate)) {
          vals[row.area as AreaKey] = row.value;
        }
      }
      const fresh: CachedLifeAreas = {
        values: { ...DEFAULT_VALUES, ...vals },
        lastSavedDate: latestDate,
      };
      if (uid) {
        void setCachedSnapshot(uid, LIFE_AREAS_CACHE_KEY, fresh);
      }
      const overlaid = applyPendingLifeAreaOverlay(fresh);
      set({ values: overlaid.values, lastSavedDate: overlaid.lastSavedDate, loading: false, error: null });
    } finally {
      run.done();
      if (lifeLatest.pending() === 0 && get().loading) set({ loading: false });
    }
  },

  setValue: (area, value) => {
    set((s) => ({ values: { ...s.values, [area]: value } }));
  },

  save: async () => {
    set({ saving: true, error: null });
    const today = todayLocal();
    const { values } = get();
    const payload = Object.fromEntries(LIFE_AREAS.map((a) => [a.key, values[a.key]]));

    const res = await writeThrough({
      channel: coreOutbox,
      entity: LIFE_AREA_ENTITY,
      entityId: today,
      kind: 'update',
      payload,
      online: () => upsertLifeAreaLogs(today, payload),
      userId: safeUserId,
    });
    if (!res.ok) {
      set({ saving: false, error: res.error });
      return false;
    }

    const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
    set({ lastSavedDate: today, saving: false, error });
    if (res.userId) {
      void setCachedSnapshot<CachedLifeAreas>(res.userId, LIFE_AREAS_CACHE_KEY, {
        values: { ...values },
        lastSavedDate: today,
      });
    }
    return true;
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'lifeAreas', store: useLifeAreasStore });
