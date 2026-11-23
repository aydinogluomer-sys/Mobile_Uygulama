/**
 * F37 — Device-local low-day time capsule rules, validation, eligibility, and persistence.
 * Pure domain + AsyncStorage/accountScope only: imports no React, store, repository, supabase, or analytics.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerAccountStorage } from './accountScope';
import { parseLocalDate, type Ymd } from './date';

export const CAPSULE_MAX_CHARS = 280;
export const CAPSULE_MAX_ITEMS = 5;

export const timeCapsuleKey = (userId: string): string => `aderyth:time_capsules:v1:${userId}`;

export type TimeCapsule = {
  id: string;
  text: string;
  day: Ymd;
  createdAt: string;
  openedAt?: string;
};

export type AddCapsuleResult =
  | { ok: true; items: TimeCapsule[] }
  | { ok: false; reason: 'empty' | 'too_long' | 'full' };

type CapsuleBlob = {
  v: 1;
  items: readonly TimeCapsule[];
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Corrupt JSON, wrong version, or invalid item -> dropped / []; never throws. Text is clamped to 280. */
export function parseCapsules(raw: string | null): TimeCapsule[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  let list: unknown[];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const env = parsed as { v?: unknown; items?: unknown };
    if (env.v !== 1 || !Array.isArray(env.items)) return [];
    list = env.items;
  } else {
    return [];
  }

  const out: TimeCapsule[] = [];
  const seenIds = new Set<string>();

  for (const elem of list) {
    if (out.length >= CAPSULE_MAX_ITEMS) break;
    if (!elem || typeof elem !== 'object') continue;
    const rec = elem as Record<string, unknown>;
    if (
      typeof rec.id !== 'string' ||
      typeof rec.text !== 'string' ||
      typeof rec.day !== 'string' ||
      typeof rec.createdAt !== 'string'
    ) {
      continue;
    }

    const id = rec.id.trim();
    const createdAt = rec.createdAt.trim();
    if (!id || !createdAt || seenIds.has(id)) continue;
    if (!YMD_RE.test(rec.day) || parseLocalDate(rec.day) === null) continue;

    const text = rec.text.trim().slice(0, CAPSULE_MAX_CHARS);
    if (!text) continue;

    const openedAt =
      typeof rec.openedAt === 'string' && rec.openedAt.trim().length > 0
        ? rec.openedAt.trim()
        : undefined;

    seenIds.add(id);
    out.push({
      id,
      text,
      day: rec.day,
      createdAt,
      ...(openedAt ? { openedAt } : {}),
    });
  }

  return out;
}

export function addCapsule(
  items: readonly TimeCapsule[],
  input: { id: string; text: string; now: Date; today: Ymd },
): AddCapsuleResult {
  const trimmed = input.text.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (trimmed.length > CAPSULE_MAX_CHARS) return { ok: false, reason: 'too_long' };
  if (items.length >= CAPSULE_MAX_ITEMS) return { ok: false, reason: 'full' };

  const created: TimeCapsule = {
    id: input.id,
    text: trimmed,
    day: input.today,
    createdAt: input.now.toISOString(),
  };
  return { ok: true, items: [...items, created] };
}

export function removeCapsule(items: readonly TimeCapsule[], id: string): TimeCapsule[] {
  return items.filter((c) => c.id !== id);
}

export function markOpened(items: readonly TimeCapsule[], id: string, now: Date): TimeCapsule[] {
  const iso = now.toISOString();
  return items.map((c) => {
    if (c.id !== id || c.openedAt) return c;
    return { ...c, openedAt: iso };
  });
}

/** Oldest unread note written on a day strictly before `today` (`createdAt`, then `id`); else `null`. */
export function eligibleCapsule(items: readonly TimeCapsule[], today: Ymd): TimeCapsule | null {
  let best: TimeCapsule | null = null;
  for (const c of items) {
    if (c.openedAt) continue;
    if (!(c.day < today)) continue;
    if (
      best === null ||
      c.createdAt < best.createdAt ||
      (c.createdAt === best.createdAt && c.id.localeCompare(best.id) < 0)
    ) {
      best = c;
    }
  }
  return best;
}

export function waitingCount(items: readonly TimeCapsule[], _today?: Ymd): number {
  let count = 0;
  for (const c of items) {
    if (!c.openedAt) count += 1;
  }
  return count;
}

export async function loadCapsules(userId: string): Promise<TimeCapsule[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(timeCapsuleKey(userId));
    return parseCapsules(raw);
  } catch {
    return [];
  }
}

export async function saveCapsules(
  userId: string,
  items: readonly TimeCapsule[],
): Promise<boolean> {
  if (!userId) return false;
  const blob: CapsuleBlob = { v: 1, items };
  try {
    await AsyncStorage.setItem(timeCapsuleKey(userId), JSON.stringify(blob));
    return true;
  } catch {
    return false;
  }
}

export const CAPSULE_COPY = {
  composerTitle: 'Zor bir gün için kendine not bırak',
  composerHint:
    'İyi bir günündeysen, ileride zor bir günde okuyacağın kısa bir not yaz. Not yalnız bu cihazda tutulur.',
  placeholder: 'Gelecekteki sana ne söylemek istersin?',
  save: 'Notu bırak',
  saved: 'Not bırakıldı. Bir sonraki hafifletilmiş günde ya da Telafi ekranında bir kez gösterilecek.',
  full: 'En çok beş not tutulur; birini silince yenisini bırakabilirsin.',
  cardTitle: 'Geçmişten bir not',
  cardSub: 'Daha iyi bir günde kendine yazdığın not:',
  read: 'Okudum',
  later: 'Şimdi değil',
  waiting: (n: number): string => `${n} not bekliyor`,
} as const;

registerAccountStorage({
  name: 'timeCapsule',
  transient: false,
  keysFor: (uid) => [timeCapsuleKey(uid)],
});
