/**
 * R07.02 — the user's own moods and their check-ins, ON THIS DEVICE per
 * account until migration 031 (written, NOT applied) gives them a server
 * home. The journal's daily mood keeps working exactly as before.
 */
import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { currentUser } from '../lib/session';
import { newOperationId } from '../lib/outbox';
import { todayLocal } from '../lib/date';
import {
  allMoods, editDefinition, makeCheckin, validateDefinition, MAX_CHECKINS,
  type MoodCheckin, type MoodDefinition,
} from '../lib/moods';

export const moodKey = (userId: string) => `moods.v1.${userId}`;
type Saved = { v: 1; definitions: MoodDefinition[]; checkins: MoodCheckin[] };

type MoodStore = {
  userId: string | null;
  definitions: MoodDefinition[];
  checkins: MoodCheckin[];
  hydrate: () => Promise<void>;
  moods: () => MoodDefinition[];
  addDefinition: (name: string, icon: string, valence: number) => { ok: true } | { ok: false; error: string };
  updateDefinition: (id: string, name: string, icon: string, valence: number) => { ok: true } | { ok: false; error: string };
  archiveDefinition: (id: string) => void;
  checkIn: (moodId: string, intensity: 1 | 2 | 3, note?: string) => boolean;
  removeCheckin: (id: string) => void;
  today: () => MoodCheckin[];
};

export const useMoodStore = create<MoodStore>((set, get) => {
  function persist() {
    const { userId, definitions, checkins } = get();
    if (!userId) return;
    const blob: Saved = { v: 1, definitions, checkins };
    AsyncStorage.setItem(moodKey(userId), JSON.stringify(blob)).catch(() => undefined);
  }
  return {
    userId: null,
    definitions: [],
    checkins: [],

    hydrate: async () => {
      const u = await currentUser();
      if (!u) { set({ userId: null, definitions: [], checkins: [] }); return; }
      if (get().userId === u.id) return;
      try {
        const o = JSON.parse((await AsyncStorage.getItem(moodKey(u.id))) ?? 'null') as Saved | null;
        if (o && o.v === 1) { set({ userId: u.id, definitions: o.definitions ?? [], checkins: o.checkins ?? [] }); return; }
      } catch { /* start clean */ }
      set({ userId: u.id, definitions: [], checkins: [] });
    },

    moods: () => allMoods(get().definitions),

    addDefinition: (name, icon, valence) => {
      const v = validateDefinition({ id: newOperationId(), name, icon, valence }, get().definitions);
      if (!v.ok) return { ok: false, error: v.reason };
      set({ definitions: [...get().definitions, v.def] });
      persist();
      return { ok: true };
    },

    updateDefinition: (id, name, icon, valence) => {
      const v = validateDefinition({ id, name, icon, valence }, get().definitions);
      if (!v.ok) return { ok: false, error: v.reason };
      set({ definitions: editDefinition(get().definitions, v.def) });
      persist();
      return { ok: true };
    },

    // Archived, not deleted: past check-ins still point at it.
    archiveDefinition: (id) => {
      set({ definitions: get().definitions.map((d) => (d.id === id ? { ...d, archived: true } : d)) });
      persist();
    },

    checkIn: (moodId, intensity, note) => {
      const def = [...get().moods(), ...get().definitions].find((d) => d.id === moodId);
      if (!def || !get().userId) return false;
      const c = makeCheckin(def, { id: newOperationId(), at: new Date(), day: todayLocal(), intensity, note });
      set({ checkins: [c, ...get().checkins].slice(0, MAX_CHECKINS) });
      persist();
      return true;
    },

    removeCheckin: (id) => {
      set({ checkins: get().checkins.filter((c) => c.id !== id) });
      persist();
    },

    today: () => get().checkins.filter((c) => c.day === todayLocal()),
  };
});

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'mood', store: useMoodStore });
