/**
 * F36 — Dakika sınırına hizalı sakin saat.
 *
 * `active` false iken hiçbir zamanlayıcı ve dinleyici kurulmaz; son değer döner.
 * `active` true iken bir sonraki dakika sınırına kurulan `setTimeout` zinciriyle
 * her dakika günceller; `AppState === 'active'` olunca hemen yeniler; unmount ve
 * `active: false` geçişinde tüm kaynakları temizler.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

function msUntilNextMinute(d: Date): number {
  const intoMinute = d.getSeconds() * 1_000 + d.getMilliseconds();
  if (intoMinute === 0) return 60_000;
  return Math.max(50, 60_000 - intoMinute + 50);
}

const defaultClock = (): Date => new Date();

export function useMinuteClock(active: boolean, clock: () => Date = defaultClock): Date {
  const clockRef = useRef(clock);
  const [now, setNow] = useState<Date>(() => clock());

  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);

  useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      const next = clockRef.current();
      setNow((prev) =>
        Math.floor(prev.getTime() / 60_000) === Math.floor(next.getTime() / 60_000) ? prev : next,
      );
    };

    const scheduleNext = () => {
      const cur = clockRef.current();
      timer = setTimeout(() => {
        setNow(clockRef.current());
        scheduleNext();
      }, msUntilNextMinute(cur));
    };

    refresh();
    scheduleNext();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        setNow(clockRef.current());
        scheduleNext();
      }
    });

    return () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      sub.remove();
    };
  }, [active]);

  return now;
}
