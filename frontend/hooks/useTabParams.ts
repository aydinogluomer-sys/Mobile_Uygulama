import { useLocalSearchParams } from 'expo-router';

function firstParam(raw: string | string[] | undefined): string | null {
  if (typeof raw === 'string') return raw.length > 0 ? raw : null;
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].length > 0) return raw[0];
  return null;
}

export function useTabParam<T extends string>(
  allowed: readonly T[],
  name: string = 'tab',
): { value: T | null; stamp: string | null } {
  const params = useLocalSearchParams();
  const raw = firstParam(params[name]);
  const stamp = firstParam(params._t);
  const value =
    raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
  return { value, stamp };
}
