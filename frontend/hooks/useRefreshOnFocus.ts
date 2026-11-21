import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

export type RefreshOnFocusOptions = {
  /** İki yenileme arasındaki en kısa süre. Varsayılan 30_000. */
  minIntervalMs?: number;
  /** İlk odaklanma (ekranın kendi mount yüklemesi zaten çalışıyor) yenilemeyi tetiklemez. Varsayılan true. */
  skipFirstFocus?: boolean;
};

/** `refetch` bir söz döndürebilir; reddi yutulur (ekran kendi hata durumunu zaten taşır). */
export function useRefreshOnFocus(refetch: () => void | Promise<void>, opts?: RefreshOnFocusOptions): void {
  const minIntervalMs = opts?.minIntervalMs ?? 30_000;
  const skipFirstFocus = opts?.skipFirstFocus ?? true;
  const latestRefetch = useRef(refetch);
  const lastRunAt = useRef(0);
  const focusedOnce = useRef(false);

  useEffect(() => {
    latestRefetch.current = refetch;
  }, [refetch]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        if (skipFirstFocus) {
          lastRunAt.current = now;
          return;
        }
      }
      if (now - lastRunAt.current < minIntervalMs) return;
      lastRunAt.current = now;
      try {
        const out = latestRefetch.current();
        if (out && typeof (out as Promise<void>).catch === 'function') {
          void (out as Promise<void>).catch(() => undefined);
        }
      } catch {
        // Ekran kendi hata durumunu taşır; odak yenilemesi sessizce vazgeçer.
      }
    }, [minIntervalMs, skipFirstFocus]),
  );
}
