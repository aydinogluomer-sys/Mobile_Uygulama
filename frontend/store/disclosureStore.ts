/**
 * F27 (NAV-13, F04) — Per-account local progressive-disclosure state.
 *
 * Stored strictly on-device under `aderyth:disclosure:v1:<userId>`.
 * Registered with `accountScope` (`transient: false`) so sign-out clears memory
 * while preserving user preferences on disk, and account deletion sweeps the key.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  accountEpoch,
  registerAccountScoped,
  registerAccountStorage,
} from '../lib/accountScope';
import {
  computeStage,
  isLegacyAccount,
  TODAY_TOOL_IDS,
  type DisclosureStage,
  type TodayToolId,
  type ToolChoice,
  type ToolChoices,
} from '../lib/disclosure';

export const DISCLOSURE_KEY_PREFIX = 'aderyth:disclosure:v1:';

export function disclosureKey(userId: string): string {
  return `${DISCLOSURE_KEY_PREFIX}${userId}`;
}

const MAX_ACTIVE_DAYS = 60;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

type PersistedDisclosureV1 = {
  v: 1;
  firstSeenAt: string;
  activeDays: string[];
  firstCloseAt: string | null;
  firstTodayMinutes: number | null;
  choices: ToolChoices;
  legacyNoticeSeen: boolean;
};

export type DisclosureState = {
  userId: string | null;
  hydrated: boolean;
  stage: DisclosureStage;
  choices: ToolChoices;
  activeDays: string[];
  firstSeenAt: string | null;
  firstCloseAt: string | null;
  firstTodayMinutes: number | null;
  accountAgeDays: number | null;
  legacyNoticeSeen: boolean;
  hydrate: (user: { id: string; createdAt?: string | null }, today: string) => Promise<void>;
  recordActiveDay: (today: string) => void;
  markFirstClose: (today: string) => void;
  setTool: (tool: TodayToolId, choice: ToolChoice | null) => void;
  resetTools: () => void;
  dismissLegacyNotice: () => void;
};

function capDays(days: readonly string[]): string[] {
  const unique = [...new Set(days.filter((d) => typeof d === 'string' && YMD_RE.test(d)))];
  return unique.length > MAX_ACTIVE_DAYS ? unique.slice(unique.length - MAX_ACTIVE_DAYS) : unique;
}

function sanitizeChoices(raw: unknown): ToolChoices | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: ToolChoices = {};
  const rec = raw as Record<string, unknown>;
  for (const key of TODAY_TOOL_IDS) {
    const val = rec[key];
    if (val === 'on' || val === 'off') {
      out[key] = val;
    } else if (val !== undefined) {
      return null;
    }
  }
  return out;
}

function parsePersisted(raw: string | null): PersistedDisclosureV1 | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.v !== 1) return null;
    if (typeof obj.firstSeenAt !== 'string') return null;
    if (!Array.isArray(obj.activeDays) || !obj.activeDays.every((x) => typeof x === 'string')) return null;
    if (obj.firstCloseAt !== null && typeof obj.firstCloseAt !== 'string') return null;
    if (obj.firstTodayMinutes !== null && (typeof obj.firstTodayMinutes !== 'number' || !Number.isFinite(obj.firstTodayMinutes))) {
      return null;
    }
    if (typeof obj.legacyNoticeSeen !== 'boolean') return null;
    const choices = sanitizeChoices(obj.choices);
    if (!choices) return null;
    return {
      v: 1,
      firstSeenAt: obj.firstSeenAt,
      activeDays: capDays(obj.activeDays),
      firstCloseAt: obj.firstCloseAt,
      firstTodayMinutes: obj.firstTodayMinutes,
      choices,
      legacyNoticeSeen: obj.legacyNoticeSeen,
    };
  } catch {
    return null;
  }
}

function computeAccountAgeDays(createdAt: string | null | undefined, nowMs: number): number | null {
  if (typeof createdAt !== 'string' || createdAt.length === 0) return null;
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 86_400_000));
}

export const useDisclosureStore: UseBoundStore<StoreApi<DisclosureState>> = create<DisclosureState>((set, get) => {
  function persistCurrent(): void {
    const st = get();
    const uid = st.userId;
    if (!uid) return;
    const payload: PersistedDisclosureV1 = {
      v: 1,
      firstSeenAt: st.firstSeenAt ?? new Date().toISOString(),
      activeDays: st.activeDays,
      firstCloseAt: st.firstCloseAt,
      firstTodayMinutes: st.firstTodayMinutes,
      choices: st.choices,
      legacyNoticeSeen: st.legacyNoticeSeen,
    };
    const serialized = JSON.stringify(payload);
    AsyncStorage.setItem(disclosureKey(uid), serialized).catch(() => undefined);
  }

  function recomputeStage(overrides: Partial<Pick<DisclosureState, 'accountAgeDays' | 'activeDays' | 'firstCloseAt' | 'firstTodayMinutes'>> = {}): DisclosureStage {
    const st = get();
    const accountAgeDays = 'accountAgeDays' in overrides ? overrides.accountAgeDays ?? null : st.accountAgeDays;
    const activeDays = overrides.activeDays ?? st.activeDays;
    const firstCloseAt = 'firstCloseAt' in overrides ? overrides.firstCloseAt ?? null : st.firstCloseAt;
    const firstTodayMinutes = 'firstTodayMinutes' in overrides ? overrides.firstTodayMinutes ?? null : st.firstTodayMinutes;
    return computeStage({
      accountAgeDays,
      activeDays: activeDays.length,
      firstCloseDone: firstCloseAt !== null,
      firstTodayMinutes,
    });
  }

  return {
    userId: null,
    hydrated: false,
    stage: 'first_day',
    choices: {},
    activeDays: [],
    firstSeenAt: null,
    firstCloseAt: null,
    firstTodayMinutes: null,
    accountAgeDays: null,
    legacyNoticeSeen: true,

    hydrate: async (user, _today) => {
      if (!user?.id) return;
      if (get().hydrated && get().userId === user.id) return;

      const epoch = accountEpoch();
      const preDays = get().userId === null || get().userId === user.id ? get().activeDays : [];

      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(disclosureKey(user.id));
      } catch {
        raw = null;
      }
      if (epoch !== accountEpoch()) return;

      const nowMs = Date.now();
      const accountAgeDays = computeAccountAgeDays(user.createdAt, nowMs);
      const midDays = get().userId === null || get().userId === user.id ? get().activeDays : [];
      const midChoices = get().userId === null || get().userId === user.id ? get().choices : {};
      const midClose = get().userId === null || get().userId === user.id ? get().firstCloseAt : null;

      const saved = parsePersisted(raw);
      if (saved) {
        const activeDays = capDays([...saved.activeDays, ...preDays, ...midDays]);
        const firstCloseAt = saved.firstCloseAt ?? midClose;
        const choices: ToolChoices = { ...saved.choices, ...midChoices };
        const stage = computeStage({
          accountAgeDays,
          activeDays: activeDays.length,
          firstCloseDone: firstCloseAt !== null,
          firstTodayMinutes: saved.firstTodayMinutes,
        });
        set({
          userId: user.id,
          hydrated: true,
          stage,
          choices,
          activeDays,
          firstSeenAt: saved.firstSeenAt,
          firstCloseAt,
          firstTodayMinutes: saved.firstTodayMinutes,
          accountAgeDays,
          legacyNoticeSeen: saved.legacyNoticeSeen,
        });
        if (activeDays.length !== saved.activeDays.length || Object.keys(midChoices).length > 0 || (midClose && !saved.firstCloseAt)) {
          persistCurrent();
        }
        return;
      }

      const createdMs = typeof user.createdAt === 'string' ? Date.parse(user.createdAt) : Number.NaN;
      const firstTodayMinutes = Number.isFinite(createdMs)
        ? Math.max(0, Math.round((nowMs - createdMs) / 60_000))
        : null;
      const firstSeenAt = new Date(nowMs).toISOString();
      const activeDays = capDays([...preDays, ...midDays]);
      const firstCloseAt = midClose;
      const legacyNoticeSeen = !isLegacyAccount(accountAgeDays);
      const stage = computeStage({
        accountAgeDays,
        activeDays: activeDays.length,
        firstCloseDone: firstCloseAt !== null,
        firstTodayMinutes,
      });

      set({
        userId: user.id,
        hydrated: true,
        stage,
        choices: { ...midChoices },
        activeDays,
        firstSeenAt,
        firstCloseAt,
        firstTodayMinutes,
        accountAgeDays,
        legacyNoticeSeen,
      });

      // Only write fresh defaults when key was genuinely absent; never clobber an unparseable blob automatically.
      if (raw === null) {
        persistCurrent();
      }
    },

    recordActiveDay: (today) => {
      if (!YMD_RE.test(today)) return;
      const cur = get().activeDays;
      if (cur.includes(today)) return;
      const activeDays = capDays([...cur, today]);
      const stage = recomputeStage({ activeDays });
      set({ activeDays, stage });
      persistCurrent();
    },

    markFirstClose: (today) => {
      if (get().firstCloseAt !== null) return;
      const firstCloseAt = today;
      const stage = recomputeStage({ firstCloseAt });
      set({ firstCloseAt, stage });
      persistCurrent();
    },

    setTool: (tool, choice) => {
      const next: ToolChoices = { ...get().choices };
      if (choice === null) {
        delete next[tool];
      } else {
        next[tool] = choice;
      }
      set({ choices: next });
      persistCurrent();
    },

    resetTools: () => {
      if (Object.keys(get().choices).length === 0) return;
      set({ choices: {} });
      persistCurrent();
    },

    dismissLegacyNotice: () => {
      if (get().legacyNoticeSeen) return;
      set({ legacyNoticeSeen: true });
      persistCurrent();
    },
  };
});

registerAccountScoped({ name: 'disclosure', store: useDisclosureStore });
registerAccountStorage({
  name: 'disclosure',
  transient: false,
  keysFor: (uid) => [disclosureKey(uid)],
});
