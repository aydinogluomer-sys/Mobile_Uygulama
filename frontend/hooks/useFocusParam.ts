import { useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

export function useFocusParam(): { id: string | null; consume: () => void } {
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string | string[] }>();
  const raw = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const id = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;

  const consume = useCallback(() => {
    if (typeof router.setParams === 'function') {
      router.setParams({ focus: undefined });
    }
  }, [router]);

  return { id, consume };
}
