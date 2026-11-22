/**
 * Weekly and monthly reviews.  (plan §8, §9)
 *
 * A review is an aggregate over several tables — habit logs, recovery plans,
 * focus sessions, tasks — for a period, plus the user's own reflections. The
 * screens were assembling it themselves, each reaching into whichever
 * repositories it happened to need, which is why the AI Coach screen imported
 * two repositories directly.
 */
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';
import { fetchHabitLogsForReview, type ReviewLogRow } from '../repositories/habitLogRepository';
import { fetchRecoveryPlansForReview } from '../repositories/recoveryRepository';
import { fetchWeeklyReview, upsertWeeklyReview, type WeeklyReviewInput } from '../repositories/reviewRepository';
import { fetchMonthlyReview, upsertMonthlyReview } from '../repositories/monthlyReviewRepository';
import type { RepoResult } from '../repositories/shared';
import { currentUser } from '../lib/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RecoveryPlan } from '../lib/supabase';

function emitAnalytics(name: AnalyticsEventName, props: Record<string, unknown>): void {
  try {
    emitEvent(buildEvent(name, props));
  } catch {
    /* §22: an analytics failure is never a product failure. */
  }
}

function answered(v: string | null): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export type { ReviewLogRow };
export type ReviewWindow = { start: string; end: string };

export type ReviewData = {
  logs: ReviewLogRow[];
  recoveryPlans: RecoveryPlan[];
};

/**
 * Everything a review period needs, fetched together.
 *
 * Both queries are issued in parallel and BOTH must succeed: a review built
 * from habit logs plus an empty recovery list, because that query failed, is
 * a report that silently understates how much the user caught up.
 */
export async function loadReviewData(
  window: ReviewWindow,
): Promise<{ ok: true; data: ReviewData } | { ok: false; error: string }> {
  const [logs, plans] = await Promise.all([
    fetchHabitLogsForReview(window),
    fetchRecoveryPlansForReview(window),
  ]);
  if (!logs.ok) return { ok: false, error: logs.error };
  if (!plans.ok) return { ok: false, error: plans.error };
  return { ok: true, data: { logs: logs.data, recoveryPlans: plans.data as RecoveryPlan[] } };
}


/** The user's saved reflections for one week. */
export const loadWeeklyReflection = (params: Parameters<typeof fetchWeeklyReview>[0]) =>
  fetchWeeklyReview(params);

export async function saveWeeklyReflection(params: WeeklyReviewInput): Promise<RepoResult<void>> {
  const res = await upsertWeeklyReview(params);
  if (!res.ok) return res;
  if (res.data.created) {
    emitAnalytics('weekly_review_completed', {
      week_key: params.weekKey,
      has_wins: answered(params.wins),
      has_challenges: answered(params.challenges),
      has_next_week: answered(params.next_week),
    });
  }
  return { ok: true, data: undefined };
}


/**
 * The two period reads, separately.
 *
 * `loadReviewData` fetches both over ONE window, which is right when they
 * describe the same period. The monthly and weekly screens deliberately use
 * different windows — habit logs go back far enough to compute behaviour
 * intelligence, recovery only to the previous period — so merging them there
 * would silently change what those reports measure.
 */
export const logsForPeriod = (window: ReviewWindow) => fetchHabitLogsForReview(window);
export const recoveryForPeriod = (window: ReviewWindow) => fetchRecoveryPlansForReview(window);

// ---------------------------------------------------------------------------
// Monthly reflection: cloud is the truth, AsyncStorage is a draft
// ---------------------------------------------------------------------------
//
// The screen used to write `monthly_review_<YYYY-MM>` to AsyncStorage and read
// it back, with no account in the key and no copy anywhere else. Now the row
// in `monthly_reviews` is authoritative and the local entry survives only as
// a draft of the month being edited, so a user who types and loses signal
// does not lose the paragraph they were writing.
//
// The migration of what is already on disk is the delicate part. Those entries
// are unscoped, so their owner is unknown; the rule below is the one that
// cannot attribute someone else's writing to the wrong account.

/** Per-account draft key. The unscoped one is only ever READ, never written. */
const draftKey = (userId: string, monthKey: string) => `monthly_review:${userId}:${monthKey}`;
const LEGACY_DRAFT_KEY = (monthKey: string) => `monthly_review_${monthKey}`;

export type MonthlyReflection = {
  answers: Record<string, string>;
  savedAt: string | null;
  /** Where the answers on screen came from — the screen labels the state. */
  source: 'cloud' | 'draft' | 'legacy' | 'empty' | 'error';
  /** Set when the cloud read failed; the screen keeps draft editing open and disables overwrite saves. */
  cloudError?: string;
};

function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // The table's CHECK refuses a non-string value, so filtering here turns a
    // rejected write into a dropped field rather than a failed save.
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Loads one month, preferring the cloud.
 *
 * ## The order, and why
 *
 *  1. the cloud row — the source of truth, and the only copy another device
 *     can see;
 *  2. this account's local draft, if it is NEWER than the cloud row — that is
 *     unsaved typing, and discarding it would lose work;
 *  3. the unscoped legacy entry, ONLY when the cloud has nothing for this
 *     month. Adopting it when the cloud already has an answer would let a
 *     stale device-local copy overwrite what another device wrote.
 *
 * The legacy entry is not deleted on read. It cannot be attributed to an
 * account with certainty — that is the defect it embodies — so it is adopted
 * as a starting point and removed only once this account has SAVED the month,
 * at which point the content demonstrably belongs to whoever saved it.
 */
export async function loadMonthlyReflection(monthKey: string): Promise<MonthlyReflection> {
  const cloud = await fetchMonthlyReview(monthKey);
  const user = await currentUser();
  const cloudError = cloud.ok ? undefined : cloud.error;
  const withCloudError = cloudError ? { cloudError } : {};

  const cloudAnswers = cloud.ok && cloud.data ? asStringMap(cloud.data.answers) : null;
  const cloudSavedAt = cloud.ok && cloud.data ? cloud.data.updated_at : null;

  if (user) {
    const rawDraft = await AsyncStorage.getItem(draftKey(user.id, monthKey));
    if (rawDraft) {
      try {
        const parsed = JSON.parse(rawDraft) as { answers?: unknown; savedAt?: string | null };
        const draftAt = parsed.savedAt ?? null;
        const newerThanCloud = !cloud.ok || !cloudSavedAt || (draftAt !== null && draftAt > cloudSavedAt);
        if (newerThanCloud) {
          // Bulut cevapları varsa taslağın altında kalır: taslakta olmayan anahtarlar kaybolmaz.
          return {
            answers: { ...(cloudAnswers ?? {}), ...asStringMap(parsed.answers) },
            savedAt: draftAt,
            source: 'draft',
            ...withCloudError,
          };
        }
      } catch {
        // A corrupt draft is not a reason to show nothing; fall through.
      }
    }
  }

  if (cloudAnswers && Object.keys(cloudAnswers).length > 0) {
    return { answers: cloudAnswers, savedAt: cloudSavedAt, source: 'cloud' };
  }

  // Nothing in the cloud: this may be a device that wrote before the move.
  const legacy = await AsyncStorage.getItem(LEGACY_DRAFT_KEY(monthKey));
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as { answers?: unknown; savedAt?: string | null };
      const answers = asStringMap(parsed.answers);
      if (Object.keys(answers).length > 0) {
        return { answers, savedAt: parsed.savedAt ?? null, source: 'legacy', ...withCloudError };
      }
    } catch {
      // ignore
    }
  }

  return {
    answers: {},
    savedAt: cloudSavedAt,
    source: cloudAnswers ? 'cloud' : cloud.ok ? 'empty' : 'error',
    ...withCloudError,
  };
}

/** Keeps the in-progress text on the device without touching the cloud. */
export async function saveMonthlyDraft(monthKey: string, answers: Record<string, string>): Promise<void> {
  const user = await currentUser();
  if (!user) return; // a signed-out draft has no owner to file it under
  await AsyncStorage.setItem(
    draftKey(user.id, monthKey),
    JSON.stringify({ answers, savedAt: new Date().toISOString() }),
  );
}

/**
 * Commits the month.
 *
 * The draft is cleared only after the write is accepted — clearing first
 * would turn a failed save into lost text. The legacy entry is retired here
 * too, for the reason in `loadMonthlyReflection`: this is the first moment
 * its content is provably attributable to an account.
 */
export async function saveMonthlyReflection(
  monthKey: string,
  answers: Record<string, string>,
): Promise<{ ok: true; savedAt: string } | { ok: false; error: string }> {
  // Körlemesine yazmak, bu cihazın görmediği cevapları siler: önce bulut satırını oku.
  const current = await fetchMonthlyReview(monthKey);
  if (!current.ok) {
    return { ok: false, error: 'Bulut okunamadı; kaydedilmedi. Yazdıkların cihazda taslak olarak duruyor.' };
  }
  // Yerel `answers` içinde HİÇ bulunmayan bulut anahtarları korunur; bulunanlar (boş dize dahil) bulutun üstüne yazar.
  const merged = { ...asStringMap(current.data?.answers), ...asStringMap(answers) };
  const res = await upsertMonthlyReview({ monthKey, answers: merged });
  if (!res.ok) return { ok: false, error: res.error };

  const user = await currentUser();
  if (user) await AsyncStorage.removeItem(draftKey(user.id, monthKey));
  await AsyncStorage.removeItem(LEGACY_DRAFT_KEY(monthKey));

  return { ok: true, savedAt: res.data.updated_at };
}
