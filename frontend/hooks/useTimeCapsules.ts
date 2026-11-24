import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ExpoRouter from 'expo-router';
import { accountEpoch } from '../lib/accountScope';
import { todayLocal, type Ymd } from '../lib/date';
import { newOperationId } from '../lib/outbox';
import { currentUser } from '../lib/session';
import {
  addCapsule,
  eligibleCapsule,
  loadCapsules,
  markOpened,
  removeCapsule,
  saveCapsules,
  waitingCount,
  type TimeCapsule,
} from '../lib/timeCapsule';

export type AddOutcome =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too_long' | 'full' | 'no_user' | 'save_failed' };

export type UseTimeCapsules = {
  ready: boolean;
  items: readonly TimeCapsule[];
  eligible: TimeCapsule | null;
  waiting: number;
  add: (text: string) => Promise<AddOutcome>;
  remove: (id: string) => Promise<void>;
  open: (id: string) => Promise<void>;
};

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
const useAlwaysFocused = (): boolean => true;
const useResolvedIsFocused: () => boolean =
  !IS_TEST && typeof ExpoRouter.useIsFocused === 'function'
    ? ExpoRouter.useIsFocused
    : useAlwaysFocused;

export function useTimeCapsules(): UseTimeCapsules {
  const isFocused = useResolvedIsFocused();
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<readonly TimeCapsule[]>([]);
  const [today, setToday] = useState<Ymd>(() => todayLocal());
  const itemsRef = useRef<readonly TimeCapsule[]>([]);

  useEffect(() => {
    if (!isFocused) return;
    let alive = true;
    const epoch = accountEpoch();
    void (async () => {
      const u = await currentUser();
      if (!alive || epoch !== accountEpoch()) return;
      const freshToday = todayLocal();
      if (!u?.id) {
        itemsRef.current = [];
        setItems([]);
        setToday(freshToday);
        setReady(true);
        return;
      }
      const loaded = await loadCapsules(u.id);
      if (!alive || epoch !== accountEpoch()) return;
      itemsRef.current = loaded;
      setItems(loaded);
      setToday(freshToday);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [isFocused]);

  const add = useCallback(async (text: string): Promise<AddOutcome> => {
    const epoch = accountEpoch();
    const u = await currentUser();
    if (epoch !== accountEpoch()) return { ok: false, reason: 'no_user' };
    if (!u?.id) {
      itemsRef.current = [];
      setItems([]);
      return { ok: false, reason: 'no_user' };
    }
    const now = new Date();
    const freshToday = todayLocal(now);
    const prev = itemsRef.current;
    const res = addCapsule(prev, { id: newOperationId(), text, now, today: freshToday });
    if (!res.ok) return res;

    itemsRef.current = res.items;
    setItems(res.items);
    setToday(freshToday);

    const saved = await saveCapsules(u.id, res.items);
    if (epoch !== accountEpoch()) return { ok: false, reason: 'save_failed' };
    if (!saved) {
      itemsRef.current = prev;
      setItems(prev);
      return { ok: false, reason: 'save_failed' };
    }
    return { ok: true };
  }, []);

  const remove = useCallback(async (id: string): Promise<void> => {
    const epoch = accountEpoch();
    const u = await currentUser();
    if (!u?.id || epoch !== accountEpoch()) return;
    const freshToday = todayLocal();
    const prev = itemsRef.current;
    const next = removeCapsule(prev, id);
    itemsRef.current = next;
    setItems(next);
    setToday(freshToday);

    const saved = await saveCapsules(u.id, next);
    if (epoch !== accountEpoch()) return;
    if (!saved) {
      itemsRef.current = prev;
      setItems(prev);
    }
  }, []);

  const open = useCallback(async (id: string): Promise<void> => {
    const epoch = accountEpoch();
    const u = await currentUser();
    if (!u?.id || epoch !== accountEpoch()) return;
    const now = new Date();
    const freshToday = todayLocal(now);
    const prev = itemsRef.current;
    const next = markOpened(prev, id, now);
    itemsRef.current = next;
    setItems(next);
    setToday(freshToday);

    const saved = await saveCapsules(u.id, next);
    if (epoch !== accountEpoch()) return;
    if (!saved) {
      itemsRef.current = prev;
      setItems(prev);
    }
  }, []);

  const eligible = useMemo(() => eligibleCapsule(items, today), [items, today]);
  const waiting = useMemo(() => waitingCount(items, today), [items, today]);

  return {
    ready,
    items,
    eligible,
    waiting,
    add,
    remove,
    open,
  };
}
