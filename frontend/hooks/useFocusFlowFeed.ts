import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useShallow } from 'zustand/react/shallow';
import {
  accountEpoch,
  registerAccountScoped,
  registerAccountStorage,
} from '../lib/accountScope';
import { todayLocal } from '../lib/date';
import {
  FOCUS_FLOW_ITEMS,
  FLOW_DAILY_CAP,
  addSeen,
  buildFeedEntries,
  capFlowFeed,
  flowSeenKey,
  isCappedCategory,
  parseFlowSeen,
  pickClosureAction,
  rankFocusFlowForUser,
  type FocusFeedEntry,
  type FocusFeedItem,
  type FocusFlowCategoryKey,
} from '../lib/focusFlowCatalog';
import { currentUser } from '../lib/session';
import { useFocusStore } from '../store/focusStore';
import { useHabitStore } from '../store/habitStore';
import { isLowEnergyOn, useLowEnergyStore } from '../store/lowEnergyStore';
import { useTaskStore } from '../store/taskStore';

type Habit = ReturnType<typeof useHabitStore.getState>['habits'][number];

const SAVED_FLOW_STORAGE_KEY = 'aderyth:focus_flow_saved_v1';

export const SEEN_DWELL_MS = 1200;

export type UseFocusFlowFeedArgs = {
  initialItemId: string | null;
  initialCategory: FocusFlowCategoryKey;
};

export type UseFocusFlowFeedResult = {
  category: FocusFlowCategoryKey;
  setCategory: (c: FocusFlowCategoryKey) => void;
  entries: FocusFeedEntry[];
  savedIds: ReadonlySet<string>;
  toggleSaved: (itemId: string) => Promise<boolean>;
  markSeen: (itemId: string) => void;
  seenToday: readonly string[];
  capped: boolean;
  exhausted: boolean;
  lowEnergy: boolean;
  existingHabitNames: ReadonlySet<string>;
  activeHabits: Habit[];
};

type SeenMemoryState = {
  epoch: number;
  day: string;
  ids: string[];
};

const accountResetListeners = new Set<() => void>();

registerAccountScoped({
  name: 'focusFlowSeenMemory',
  onReset: () => {
    for (const listener of accountResetListeners) {
      listener();
    }
  },
});

registerAccountStorage({
  name: 'focusFlowSeen',
  transient: false,
  keysFor: (uid) => [flowSeenKey(uid)],
});

export function useFocusFlowFeed({
  initialItemId,
  initialCategory,
}: UseFocusFlowFeedArgs): UseFocusFlowFeedResult {
  const { habits, fetchHabits } = useHabitStore(
    useShallow((s) => ({ habits: s.habits, fetchHabits: s.fetchHabits })),
  );
  const tasks = useTaskStore((s) => s.tasks);
  const sessionsCompleted = useFocusStore((s) => s.sessionsCompleted);

  const today = todayLocal();
  const lowEnergy = useLowEnergyStore((st) => isLowEnergyOn(st, today));

  const [category, setCategory] = useState<FocusFlowCategoryKey>(initialCategory);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const [epochTick, setEpochTick] = useState(0);
  const [seenState, setSeenState] = useState<SeenMemoryState>(() => ({
    epoch: accountEpoch(),
    day: today,
    ids: [],
  }));

  useEffect(() => {
    const onReset = () => setEpochTick((n) => n + 1);
    accountResetListeners.add(onReset);
    return () => {
      accountResetListeners.delete(onReset);
    };
  }, []);

  useEffect(() => {
    fetchHabits();
    AsyncStorage.getItem(SAVED_FLOW_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSavedIds(new Set(parsed.filter((x): x is string => typeof x === 'string')));
        }
      })
      .catch(() => {});
  }, [fetchHabits]);

  const curEpoch = accountEpoch();

  useEffect(() => {
    let alive = true;
    const capturedEpoch = accountEpoch();
    const capturedDay = todayLocal();
    void (async () => {
      try {
        const user = await currentUser();
        if (!alive || capturedEpoch !== accountEpoch()) return;
        if (!user?.id) {
          setSeenState((prev) =>
            prev.epoch === capturedEpoch && prev.day === capturedDay
              ? prev
              : { epoch: capturedEpoch, day: capturedDay, ids: [] },
          );
          return;
        }
        const raw = await AsyncStorage.getItem(flowSeenKey(user.id));
        if (!alive || capturedEpoch !== accountEpoch()) return;
        const loaded = parseFlowSeen(raw, capturedDay);
        setSeenState((prev) => {
          if (prev.epoch === capturedEpoch && prev.day === capturedDay && prev.ids.length > 0) {
            let merged = loaded;
            for (const id of prev.ids) {
              merged = addSeen(merged, id, FLOW_DAILY_CAP);
            }
            return { epoch: capturedEpoch, day: capturedDay, ids: merged };
          }
          return { epoch: capturedEpoch, day: capturedDay, ids: loaded };
        });
      } catch {
        // Ignore storage read failures
      }
    })();
    return () => {
      alive = false;
    };
  }, [curEpoch, epochTick, today]);

  const seenToday = useMemo<readonly string[]>(
    () =>
      seenState.epoch === curEpoch && seenState.day === today ? seenState.ids : [],
    [seenState, curEpoch, today],
  );

  const capped = isCappedCategory(category);

  const markSeen = useCallback(
    (itemId: string) => {
      if (!capped) return;
      const capturedEpoch = accountEpoch();
      const capturedDay = todayLocal();

      setSeenState((prev) => {
        const baseIds =
          prev.epoch === capturedEpoch && prev.day === capturedDay ? prev.ids : [];
        if (baseIds.includes(itemId) || baseIds.length >= FLOW_DAILY_CAP) {
          if (prev.epoch === capturedEpoch && prev.day === capturedDay) return prev;
          return { epoch: capturedEpoch, day: capturedDay, ids: baseIds };
        }
        const nextIds = addSeen(baseIds, itemId, FLOW_DAILY_CAP);
        void (async () => {
          try {
            const user = await currentUser();
            if (!user?.id || capturedEpoch !== accountEpoch()) return;
            await AsyncStorage.setItem(
              flowSeenKey(user.id),
              JSON.stringify({ day: capturedDay, ids: nextIds }),
            );
          } catch {
            // Ignore storage write failures
          }
        })();
        return { epoch: capturedEpoch, day: capturedDay, ids: nextIds };
      });
    },
    [capped],
  );

  const toggleSaved = useCallback(async (itemId: string): Promise<boolean> => {
    let added = false;
    let snapshot: string[] = [];
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
        added = false;
      } else {
        next.add(itemId);
        added = true;
      }
      snapshot = [...next];
      return next;
    });
    try {
      await AsyncStorage.setItem(SAVED_FLOW_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore storage error
    }
    return added;
  }, []);

  const activeHabits = useMemo(
    () => habits.filter((h) => h.status === 'active'),
    [habits],
  );

  const existingHabitNames = useMemo(() => {
    const set = new Set<string>();
    for (const h of habits) {
      if (h.status !== 'archived') {
        set.add(h.name.trim().toLocaleLowerCase('tr-TR'));
      }
    }
    return set;
  }, [habits]);

  const overdueCount = useMemo(
    () =>
      tasks.filter((t) => !t.completed && Boolean(t.due_date && t.due_date < today))
        .length,
    [tasks, today],
  );

  const rankedForYou = useMemo(
    () =>
      rankFocusFlowForUser({
        hour: new Date().getHours(),
        overdueCount,
        lowEnergy,
        activeHabitCount: activeHabits.length,
        focusSessionsToday: sessionsCompleted,
        startItemId: initialItemId,
      }),
    [overdueCount, lowEnergy, activeHabits.length, sessionsCompleted, initialItemId],
  );

  const filteredItems = useMemo<FocusFeedItem[]>(() => {
    if (category === 'for_you') return rankedForYou;
    if (category === 'all') {
      if (!initialItemId) return FOCUS_FLOW_ITEMS;
      const pin = FOCUS_FLOW_ITEMS.find((i) => i.id === initialItemId);
      if (!pin) return FOCUS_FLOW_ITEMS;
      return [pin, ...FOCUS_FLOW_ITEMS.filter((i) => i.id !== initialItemId)];
    }
    if (category === 'saved') {
      return FOCUS_FLOW_ITEMS.filter((i) => savedIds.has(i.id));
    }
    return rankedForYou.filter((i) => i.category === category);
  }, [category, rankedForYou, savedIds, initialItemId]);

  const { entries, exhausted } = useMemo(() => {
    if (!capped) {
      return {
        entries: buildFeedEntries(filteredItems, 5, null),
        exhausted: false,
      };
    }
    const cappedFeed = capFlowFeed(filteredItems, seenToday, FLOW_DAILY_CAP);
    if (!cappedFeed.exhausted) {
      return {
        entries: buildFeedEntries(cappedFeed.items, 5, null),
        exhausted: false,
      };
    }
    const seenItems = seenToday
      .map((id) => FOCUS_FLOW_ITEMS.find((it) => it.id === id))
      .filter((it): it is FocusFeedItem => Boolean(it));
    const action = pickClosureAction(seenItems, existingHabitNames);
    return {
      entries: buildFeedEntries(cappedFeed.items, 5, {
        seenCount: cappedFeed.seenCount,
        action,
      }),
      exhausted: true,
    };
  }, [capped, filteredItems, seenToday, existingHabitNames]);

  return {
    category,
    setCategory,
    entries,
    savedIds,
    toggleSaved,
    markSeen,
    seenToday,
    capped,
    exhausted,
    lowEnergy,
    existingHabitNames,
    activeHabits,
  };
}
