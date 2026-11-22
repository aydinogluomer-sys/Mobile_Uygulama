import { useCallback, useEffect, useRef, useState } from 'react';
import { accountEpoch } from '../lib/accountScope';
import type { Ymd } from '../lib/date';
import {
  closingDayFor,
  dayAfter,
  loadDayClose,
  mergeDayClose,
  movePatch,
  saveDayClose,
  selectCloseCandidates,
  undoPatch,
  visibleCandidates,
  type CloseDecision,
} from '../lib/dayClose';
import { currentUser } from '../lib/session';
import { useMoodStore } from '../store/moodStore';
import { useTaskStore, type ListType, type Task } from '../store/taskStore';

const SYNC_NOTICE_DELAY_MS = 1200;

export type DayCloseRow = {
  task: Task;
  decision: CloseDecision | null;
  /** Geri al için ilk durum. */
  prev: { due_date: string | null; list_type: ListType };
};

export type UseDayClose = {
  closingDay: Ymd;
  tomorrow: Ymd;
  /** Modal her açıldığında yeniden alınan anlık görüntü (en çok CLOSE_LIST_LIMIT). */
  rows: DayCloseRow[];
  hasMore: boolean;
  /** Seçili ruh hali değeri (1-5) ya da null. */
  mood: number | null;
  chooseMood: (value: 1 | 2 | 3 | 4 | 5) => void;
  decide: (taskId: string, decision: CloseDecision) => Promise<void>;
  undo: (taskId: string) => Promise<void>;
  moveVisibleToTomorrow: () => Promise<void>;
  /** Kayıt yazılır, taslak sıfırlanır. easedCount: bugün hafifletilmiş ritüel sayısı. Yazılamazsa false (kapanışı engellemez). */
  finish: (easedCount: number) => Promise<boolean>;
  /** Bekleyen görev değişikliği 1200 ms'den uzun sürdüyse true ("Eşitlenince uygulanacak."). */
  waitingForSync: boolean;
};

type SessionDraft = {
  day: Ymd | null;
  moved: Set<string>;
  released: Set<string>;
  prevById: Map<string, { due_date: string | null; list_type: ListType }>;
  moodCheckinId: string | null;
  moodValue: number | null;
};

function createEmptyDraft(): SessionDraft {
  return {
    day: null,
    moved: new Set<string>(),
    released: new Set<string>(),
    prevById: new Map<string, { due_date: string | null; list_type: ListType }>(),
    moodCheckinId: null,
    moodValue: null,
  };
}

export function useDayClose(open: boolean, now?: () => Date): UseDayClose {
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);

  const readNow = useCallback((): Date => {
    return nowRef.current ? nowRef.current() : new Date();
  }, []);

  const [closingDay, setClosingDay] = useState<Ymd>(() =>
    closingDayFor(now ? now() : new Date()),
  );
  const tomorrow = dayAfter(closingDay);
  const tomorrowRef = useRef<Ymd>(tomorrow);

  const [rows, setRows] = useState<DayCloseRow[]>([]);
  const rowsRef = useRef<DayCloseRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [mood, setMood] = useState<number | null>(null);

  const prevOpenRef = useRef(false);
  const draftRef = useRef<SessionDraft>(createEmptyDraft());
  const moodSeqRef = useRef(0);

  const hasPendingSync = useTaskStore((s) => s.sync.pending > 0);
  const [syncElapsed, setSyncElapsed] = useState(false);

  useEffect(() => {
    if (!hasPendingSync) return;
    const timer = setTimeout(() => {
      setSyncElapsed(true);
    }, SYNC_NOTICE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setSyncElapsed(false);
    };
  }, [hasPendingSync]);

  const waitingForSync = hasPendingSync && syncElapsed;

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) return;

    const currentDay = closingDayFor(readNow());
    const nextDay = dayAfter(currentDay);
    setClosingDay(currentDay);
    tomorrowRef.current = nextDay;

    if (draftRef.current.day !== null && draftRef.current.day !== currentDay) {
      draftRef.current = createEmptyDraft();
      moodSeqRef.current += 1;
      setMood(null);
    }
    draftRef.current.day = currentDay;

    const candidates = selectCloseCandidates(useTaskStore.getState().tasks, currentDay);
    const visible = visibleCandidates(candidates);
    const snapshotRows: DayCloseRow[] = visible.rows.map((t) => {
      const savedPrev = draftRef.current.prevById.get(t.id) ?? {
        due_date: t.due_date ?? null,
        list_type: t.list_type,
      };
      draftRef.current.prevById.set(t.id, savedPrev);
      const existingDecision: CloseDecision | null = draftRef.current.moved.has(t.id)
        ? 'tomorrow'
        : draftRef.current.released.has(t.id)
          ? 'release'
          : null;
      return {
        task: t,
        decision: existingDecision,
        prev: savedPrev,
      };
    });

    rowsRef.current = snapshotRows;
    setRows(snapshotRows);
    setHasMore(visible.hasMore);
  }, [open, readNow]);

  const chooseMood = useCallback((value: 1 | 2 | 3 | 4 | 5) => {
    const epoch = accountEpoch();
    moodSeqRef.current += 1;
    const seq = moodSeqRef.current;

    void (async () => {
      await useMoodStore.getState().hydrate();
      if (epoch !== accountEpoch() || seq !== moodSeqRef.current) return;

      const prevId = draftRef.current.moodCheckinId;
      if (prevId) {
        useMoodStore.getState().removeCheckin(prevId);
        draftRef.current.moodCheckinId = null;
      }

      const recorded = useMoodStore.getState().checkIn(`builtin-${value}`, 2);
      if (!recorded) return;

      const newest = useMoodStore.getState().checkins[0];
      draftRef.current.moodCheckinId = newest ? newest.id : null;
      draftRef.current.moodValue = value;
      setMood(value);
    })();
  }, []);

  const decide = useCallback(async (taskId: string, decision: CloseDecision): Promise<void> => {
    const idx = rowsRef.current.findIndex((r) => r.task.id === taskId);
    if (idx === -1) return;
    const row = rowsRef.current[idx];
    if (row.decision === decision) return;

    const patch =
      row.decision === null
        ? movePatch(decision, tomorrowRef.current)
        : { ...undoPatch(row.prev), ...movePatch(decision, tomorrowRef.current) };

    const updatedRow: DayCloseRow = { ...row, decision };
    const nextRows = rowsRef.current.map((r, i) => (i === idx ? updatedRow : r));
    rowsRef.current = nextRows;
    setRows(nextRows);

    if (decision === 'tomorrow') {
      draftRef.current.moved.add(taskId);
      draftRef.current.released.delete(taskId);
    } else {
      draftRef.current.released.add(taskId);
      draftRef.current.moved.delete(taskId);
    }

    await useTaskStore.getState().updateTask(taskId, patch);
  }, []);

  const undo = useCallback(async (taskId: string): Promise<void> => {
    const idx = rowsRef.current.findIndex((r) => r.task.id === taskId);
    if (idx === -1) return;
    const row = rowsRef.current[idx];
    if (row.decision === null) return;

    const updatedRow: DayCloseRow = { ...row, decision: null };
    const nextRows = rowsRef.current.map((r, i) => (i === idx ? updatedRow : r));
    rowsRef.current = nextRows;
    setRows(nextRows);

    draftRef.current.moved.delete(taskId);
    draftRef.current.released.delete(taskId);

    await useTaskStore.getState().updateTask(taskId, undoPatch(row.prev));
  }, []);

  const moveVisibleToTomorrow = useCallback(async (): Promise<void> => {
    const undecidedIds = rowsRef.current
      .filter((r) => r.decision === null)
      .map((r) => r.task.id);
    for (const id of undecidedIds) {
      await decide(id, 'tomorrow');
    }
  }, [decide]);

  const finish = useCallback(
    async (easedCount: number): Promise<boolean> => {
      const epoch = accountEpoch();
      const isStaleEpoch = (): boolean => epoch !== accountEpoch();
      const movedCount = draftRef.current.moved.size;
      const targetDay = draftRef.current.day ?? closingDayFor(readNow());
      const closedAt = readNow().toISOString();

      const resetDraft = () => {
        draftRef.current = createEmptyDraft();
        moodSeqRef.current += 1;
        setMood(null);
      };

      const user = await currentUser();
      if (!user?.id || isStaleEpoch()) {
        resetDraft();
        return false;
      }

      const prevRecord = await loadDayClose(user.id);
      if (isStaleEpoch()) {
        resetDraft();
        return false;
      }

      const merged = mergeDayClose(prevRecord, {
        date: targetDay,
        movedCount,
        easedCount,
        closedAt,
      });

      const ok = await saveDayClose(user.id, merged);
      resetDraft();
      return ok;
    },
    [readNow],
  );

  return {
    closingDay,
    tomorrow,
    rows,
    hasMore,
    mood,
    chooseMood,
    decide,
    undo,
    moveVisibleToTomorrow,
    finish,
    waitingForSync,
  };
}
