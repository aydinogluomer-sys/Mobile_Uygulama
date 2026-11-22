import { useEffect, useMemo, useRef } from 'react';

export type TimeoutRef = {
  set: (fn: () => void, ms: number) => void;
  clear: () => void;
};

export function useTimeoutRef(): TimeoutRef {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const api = useMemo<TimeoutRef>(
    () => ({
      clear: () => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      },
      set: (fn: () => void, ms: number) => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          fn();
        }, ms);
      },
    }),
    [],
  );

  useEffect(() => () => api.clear(), [api]);

  return api;
}
