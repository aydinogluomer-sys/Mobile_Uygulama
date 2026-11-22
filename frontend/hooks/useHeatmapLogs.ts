import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { addDaysLocal, ymd } from '../lib/date';
import { YEAR_GRID_MAX_WEEKS } from '../lib/yearGrid';
import { heatmapLogs } from '../services/habitService';

export type HeatmapRow = { completed_at: string; state: 'done' | 'partial' };

export type UseHeatmapLogs = {
  rows: HeatmapRow[];
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  reload: () => void;
};

const useSafeFocusEffect: typeof useFocusEffect =
  typeof useFocusEffect === 'function'
    ? useFocusEffect
    : (effect) => {
        useEffect(effect, [effect]);
      };

/** Odakta yeniden yükler; yarış korumalı (son istek kazanır); unmount sonrası durum yazmaz. */
export function useHeatmapLogs(opts?: { weeks?: number; asOf?: Date }): UseHeatmapLogs {
  const weeks = opts?.weeks ?? YEAR_GRID_MAX_WEEKS;
  const asOfMs = opts?.asOf ? opts.asOf.getTime() : null;

  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const reqIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    const reqId = ++reqIdRef.current;
    if (mountedRef.current) {
      setStatus('loading');
      setError(null);
    }
    const base = asOfMs !== null ? new Date(asOfMs) : new Date();
    const since = ymd(addDaysLocal(base, -(weeks * 7)));

    void heatmapLogs({ since }).then(
      (res) => {
        if (!mountedRef.current || reqId !== reqIdRef.current) return;
        if (!res.ok) {
          setError(res.error);
          setStatus('error');
          return;
        }
        const filtered: HeatmapRow[] = [];
        for (const r of res.data) {
          if (
            typeof r.completed_at === 'string' &&
            (r.state === 'done' || r.state === 'partial')
          ) {
            filtered.push({ completed_at: r.completed_at, state: r.state });
          }
        }
        setRows(filtered);
        setError(null);
        setStatus('ready');
      },
      (err: unknown) => {
        if (!mountedRef.current || reqId !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Kayıtlar okunamadı.');
        setStatus('error');
      },
    );
  }, [weeks, asOfMs]);

  useSafeFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { rows, status, error, reload };
}
