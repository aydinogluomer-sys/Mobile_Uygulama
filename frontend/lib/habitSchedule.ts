import { addDaysLocal, daysBetweenLocal, parseLocalDate, startOfWeekLocal, ymd } from './date';
import type { Habit, HabitLog } from './supabase';

// HabitOnboarding WEEKDAYS = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz']
// → saklanan frequency_config.days indeksi: 0=Pazartesi … 6=Pazar.
// JS Date.getDay(): 0=Pazar … 6=Cumartesi. Dönüşüm:
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7; // Pzt=0 … Paz=6
}

/**
 * Alışkanlık belirli bir günde "yapılması gereken" (due) mi?
 * Belirsiz frekanslar (haftalık-günsüz, aylık) güvenli tarafta `false` döner; böylece
 * yanlış "kaçırıldı" üretilmez (aşırı sayım yerine eksik sayım tercih edilir).
 */
/**
 * Is this habit scheduled on `date`?
 *
 * ## Why `behavior_type` is not consulted
 *
 * This used to open with `if (habit.behavior_type !== 'positive') return
 * false`, so a negative habit was due on NO day — and everything built on due
 * days skipped it: the completion average, the weekly and monthly reports,
 * and the missed-day backlog that feeds recovery. A user could create "at
 * most 2 cigarettes", log it faithfully, have it scored correctly by the
 * engine, and see it reported nowhere.
 *
 * That conflated two orthogonal things. `behavior_type` says which DIRECTION
 * counts as success; the schedule comes from `frequency_config`. A habit you
 * are trying to quit is due every day you committed to it, exactly like one
 * you are trying to build.
 *
 * The asymmetry that IS real lives in `isMissedOn` below: for a negative
 * habit, the absence of a log is not evidence of failure.
 */
/**
 * Was the habit alive on `date`? Not before it was created, not after a dated
 * end condition. Shared by `isDueOn` (legacy obligation) and `isEligibleOn`
 * (canonical eligibility) so the two cannot drift on the one rule they agree on.
 */
function withinLifetime(habit: Habit, date: Date): boolean {
  const ds = ymd(date);
  // Oluşturulmadan önceki günlerde due değil
  if (habit.created_at && ymd(new Date(habit.created_at)) > ds) return false;
  // Tarihli bitiş koşulu geçmişse due değil
  const ec = habit.end_condition;
  if (ec && ec.kind === 'date' && typeof ec.value === 'string' && ds > ec.value) return false;
  return true;
}

/**
 * LEGACY OBLIGATION PREDICATE — kept behaviour-identical on purpose.
 *
 * R01.02-a classified every production call site (recovery backlog, completion
 * denominators, streaks, the calendar cell verdict, per-day load): all of them
 * read `true` as "this day was expected; no log means a miss". None reads it as
 * "may I log today". For count-based schedules that meaning is only satisfiable
 * by inventing days, which `countDueDays` does. Turning the count branch into
 * "every day" would therefore turn three invented misses into seven real ones.
 *
 * So this function is a compatibility bridge, and as of R01.02-b it is a bridge
 * with no traffic on the count lane: NO production caller can hand a count-based
 * habit to it any more.
 *
 * As of R01.02-c it has no direct production caller outside this module at all.
 * The day-lane consumers (reportMetrics, behaviorIntelligence, recovery,
 * habit-detail, `scheduledCompletionRate`, `carriesDayLoad`) call `isEligibleOn`
 * instead -- identical for daily/weekly_days, and the only predicate that sees
 * `interval_days` / `range_start` / `range_end`. Each still guards count
 * schedules first. The remaining caller is `dueOnExtended` (below), which uses
 * it for the base guards.
 *
 * ONE HOLE, pre-existing and recorded (STATE.md KD-06), not closed here: a
 * `weekly` row with `count` AND `range_start`/`range_end` is classified
 * `date_range` by `scheduleKind` (range wins, kind is not consulted), so it is
 * not count-based to any guard, and `dueOnExtended`'s range branch then calls
 * this function, whose count branch invents weekdays. No such row can be
 * written today (the client validator rejects the range keys); R01.02-d must
 * decide the combination before it opens them.
 *
 * The count branch and `countDueDays` are therefore dead for every real input,
 * and `__tests__/repo/periodConsumerMigration.test.ts` pins that. They are still
 * here on purpose: `isDueOn` is exported API whose count behaviour is pinned by
 * the AC-H03 tests, so deleting the branch means rewriting a deliberate test
 * contract -- an owner decision, not a side effect of this card.
 *
 * New code must not call this for count-based schedules: use `periodStatus`
 * (period success), `isEligibleOn` (eligibility) or `carriesDayLoad` (day load).
 */
export function isDueOn(habit: Habit, date: Date): boolean {
  if (!withinLifetime(habit, date)) return false;

  const kind = habit.frequency_config?.kind ?? 'daily';
  if (kind === 'daily') return true;
  if (kind === 'weekly') {
    const days = habit.frequency_config?.days;
    if (days && days.length > 0) return days.includes(weekdayIndex(date));

    // "Haftada X kez" — gün seçilmemiş. Eskiden burada `false` dönülüyordu,
    // yani count tabanlı bir alışkanlık YILIN HİÇBİR GÜNÜNDE due olmuyordu:
    // hiç kaçırılmıyor, hiç sayılmıyor, telafiye hiç girmiyordu (AC-H03).
    const count = habit.frequency_config?.count;
    if (typeof count === 'number' && count > 0) {
      return countDueDays(count).includes(weekdayIndex(date));
    }
    return false; // ne gün ne sayı → sabitlenecek bir şey yok
  }
  // monthly → belirli güne sabitlenemez.
  // Bu bilinçli bir karardır, eksik uygulama değil: ayın hangi gününde due
  // olduğu saklanmıyor, dolayısıyla tahmin etmek yanlış "kaçırıldı" üretirdi.
  // Aylık alışkanlıklar için due/miss kavramı ayrı bir tasarım işidir.
  return false;
}

/**
 * LEGACY — fixed-distribution workaround; not on any canonical path.
 *
 * Sole caller: the count branch of `isDueOn` above (verified R01.02-a, re-
 * verified R01.02-b). After R01.02-b every production path guards count
 * schedules before reaching that branch, so this function no longer runs for
 * any real habit -- see the caller table on `isDueOn`.
 *
 * It is NOT deleted, and that is a decision rather than an oversight: the
 * AC-H03 tests pin `isDueOn`'s count behaviour on purpose (they were written
 * before the fix and observed to fail), and `isDueOn` stays exported. Removing
 * the branch means rewriting that pinned contract, which the owner should
 * sanction explicitly. `isEligibleOn`, `periodStatus`, `carriesDayLoad` and the
 * count-mode path of `scheduledCompletionRate` never call it.
 *
 * `count` haftalık hedefi için haftanın hangi günleri due sayılır.
 *
 * Günler haftaya MÜMKÜN OLDUĞUNCA EŞİT dağıtılır — 3 için Pzt/Çar/Cum gibi —
 * çünkü ardışık ilk N günü seçmek (Pzt/Sal/Çar) hafta sonunu yapısal olarak
 * boş bırakır ve gerçek kullanım örüntüsüne uymaz.
 *
 * Deterministiktir: aynı `count` her hafta aynı günleri verir, böylece
 * raporlar haftalar arasında karşılaştırılabilir kalır.
 *
 * SINIR — bilerek: bu fonksiyonun tamamlanma verisi yoktur. "Haftada 3" hedefi
 * olan biri Sal/Per/Cmt yaparsa, bu takvim Pzt/Çar/Cum bekler ve üç "kaçırma"
 * üretir. Saf, tarih-temelli bir yanıt için doğru davranış budur; gerçek
 * kaçırma tespiti tamamlanma sayısını görmek zorundadır ve çağıranın işidir.
 */
function countDueDays(count: number): number[] {
  const n = Math.min(Math.max(Math.floor(count), 1), 7);
  if (n >= 7) return [0, 1, 2, 3, 4, 5, 6];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(Math.round((i * 7) / n)); // n=3 → 0,2,5 (Pzt/Çar/Cmt)
  }
  return Array.from(new Set(out));
}

// =====================================================================================
// V2 — Esnek zamanlama (task 1-W3, IMPLEMENTATION_V2.md §8.7)
//
// Her şey ADDITIVE'dir. `isDueOn`, `weekdayIndex` ve `countDueDays` yukarıda BİREBİR
// aynı kaldı — imzaları, davranışları ve mevcut testleri değişmedi. Aşağıdaki
// fonksiyonlar onları TÜKETİR, değiştirmez.
//
// `FrequencyConfig` artık üç opsiyonel alan daha taşıyor (`interval_days`,
// `range_start`, `range_end` — bkz. lib/supabase.ts). DB tarafı jsonb'dir ve
// bunları kabul eder (canlıda doğrulandı, R00); persist edilmemelerinin sebebi
// istemci validator'ıdır (`routineProposal.ALLOWED_FREQUENCY_KEYS`), migration
// değil. Bu modülün V2/V3 fonksiyonları onları okur; var olan hiçbir satır bu
// alanları taşımadığı için (hepsi undefined) eski davranış tamamen korunuyor.
// =====================================================================================

/** `scheduleKind`'ın döndürdüğü ayrık (discriminated) görünüm — §8.7'nin altı modu. */
export type ScheduleKind =
  | { readonly kind: 'daily' }
  | { readonly kind: 'weekly_days'; readonly days: number[] }
  | { readonly kind: 'weekly_count'; readonly count: number }
  | { readonly kind: 'monthly_count'; readonly count: number }
  | { readonly kind: 'every_n_days'; readonly intervalDays: number }
  | { readonly kind: 'date_range'; readonly start: string | null; readonly end: string | null };

/**
 * `habit.frequency_config`'i §8.7'nin altı zamanlama moduna sınıflandırır.
 *
 * Öncelik sırası (en spesifikten en genele):
 *  1. `range_start`/`range_end` verilmişse → `'date_range'`. Kullanıcı açık bir
 *     tarih penceresi tanımlamışsa bu, o pencere içinde HER GÜN due anlamına gelir.
 *     SINIR — bilerek: date_range bugün haftalık-gün/haftalık-sayı deseniyle
 *     BİRLEŞTİRİLEMİYOR ("Pzt/Çar/Cum, ama yalnızca 1-15 Ağustos" ifade edilemez).
 *     Bu basitleştirme kabul edilebilir çünkü istemci validator'ı bu alanları henüz
 *     kabul etmiyor ve hiçbir kombinasyon kalıcı hâle gelmiyor; V1 kapsamı yalnızca
 *     "bu pencerede her gün" senaryosunu kapsıyor.
 *  2. `kind: 'daily'` + `interval_days > 1` → `'every_n_days'`. `interval_days`
 *     verilmemiş veya `<=1` ise sıradan `'daily'` olarak kalır — bu, var olan hiçbir
 *     `kind:'daily'` satırının (hepsi `interval_days` taşımıyor) anlamını değiştirmez.
 *  3. `kind: 'weekly'` + `days` doluysa → `'weekly_days'` (mevcut `isDueOn` davranışıyla
 *     birebir aynı gün kümesi).
 *  4. `kind: 'weekly'` + `days` boş/yok → `'weekly_count'`. `count` yoksa/≤0 ise
 *     `count: 0` döner (bkz. `windowFor`/`streakBroken` — hedef 0 iken "bozulacak"
 *     bir şey yoktur, `isDueOn`'un "belirsizlikte az say" ilkesiyle tutarlı).
 *  5. `kind: 'monthly'` → `'monthly_count'`. `isDueOn` aylık deseni bilerek
 *     desteklemiyor (dosya başındaki not); burada da aynı dürüstlükle `count` yoksa
 *     `0` döner — "ayda kaç kez" hesaba katılamıyorsa hedef karşılanamaz sayılmaz,
 *     yalnızca hiç sayılmaz.
 */
export function scheduleKind(habit: Habit): ScheduleKind {
  const fc = habit.frequency_config;

  if (fc?.range_start || fc?.range_end) {
    return { kind: 'date_range', start: fc.range_start ?? null, end: fc.range_end ?? null };
  }

  const kind = fc?.kind ?? 'daily';

  if (kind === 'daily') {
    const interval = fc?.interval_days;
    if (typeof interval === 'number' && interval > 1) {
      return { kind: 'every_n_days', intervalDays: Math.floor(interval) };
    }
    return { kind: 'daily' };
  }

  if (kind === 'weekly') {
    if (fc?.days && fc.days.length > 0) return { kind: 'weekly_days', days: fc.days };
    const count = fc?.count;
    return { kind: 'weekly_count', count: typeof count === 'number' && count > 0 ? Math.floor(count) : 0 };
  }

  // kind === 'monthly'
  const count = fc?.count;
  return { kind: 'monthly_count', count: typeof count === 'number' && count > 0 ? Math.floor(count) : 0 };
}

/**
 * `isDueOn`'un GENİŞLETİLMİŞ hâli — yalnızca bu modülün V2 alanlarını (`every_n_days`,
 * `date_range`) hesaba katar. `isDueOn`'un kendisi BİLEREK değiştirilmedi; bu ayrı,
 * modül-içi bir yardımcıdır ve `streakBroken`'ın gün-bazlı dallarında kullanılır.
 * `weekly_count`/`monthly_count` bu fonksiyona hiç girmez — onlar pencere bazlı
 * değerlendirilir (bkz. `windowFor`/`streakBroken`).
 */
function dueOnExtended(habit: Habit, date: Date): boolean {
  const sk = scheduleKind(habit);

  if (sk.kind === 'every_n_days') {
    if (!isDueOn(habit, date)) return false; // temel korumalar (behavior_type/created_at/end_condition) önce
    if (!habit.created_at) return true; // referans yoksa daraltamayız — temel korumaya güven
    const anchor = parseLocalDate(ymd(new Date(habit.created_at)));
    if (!anchor) return true;
    const diff = daysBetweenLocal(anchor, date);
    if (diff < 0) return false;
    return diff % Math.max(1, sk.intervalDays) === 0;
  }

  if (sk.kind === 'date_range') {
    if (!isDueOn(habit, date)) return false; // temel korumalar önce
    const ds = ymd(date);
    if (sk.start && ds < sk.start) return false;
    if (sk.end && ds > sk.end) return false;
    return true;
  }

  return isDueOn(habit, date); // daily / weekly_days — davranış değişmedi
}

/** Sayaç-tabanlı (weekly_count/monthly_count) bir alışkanlığın değerlendirildiği pencere. */
export type ScheduleWindow = { start: Date; end: Date; targetCount: number };

/**
 * `weekly_count`/`monthly_count` için `date`'i kapsayan değerlendirme penceresi.
 * Diğer tüm modlar için `null` döner — onlarda "pencere" kavramı yoktur, kaçırma
 * gün bazında değerlendirilir (bkz. `streakBroken`).
 *
 * Hafta sınırı `startOfWeekLocal` ile hesaplanır — repo'nun haftası Pazartesi başlar
 * (bkz. `lib/date.ts`), varsayılmadı, doğrulandı.
 */
export function windowFor(habit: Habit, date: Date): ScheduleWindow | null {
  const sk = scheduleKind(habit);

  if (sk.kind === 'weekly_count') {
    const start = startOfWeekLocal(date);
    const end = addDaysLocal(start, 6);
    return { start, end, targetCount: sk.count };
  }

  if (sk.kind === 'monthly_count') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0); // ayın son günü, yerel
    return { start, end, targetCount: sk.count };
  }

  return null;
}

/**
 * `logs` içinde, `window` aralığına düşen (dahil) `done`/`partial` sayısı.
 *
 * `isCompletedState` (lib/reportMetrics.ts) burada BİLEREK yeniden import edilmedi:
 * `reportMetrics.ts` zaten `isDueOn`'u bu modülden import ediyor, ters yönde bir
 * import döngüsel bağımlılık yaratırdı. Aynı iki satırlık kural (`done`/`partial`
 * sayılır, `miss`/`skip` sayılmaz — AC-H07/AC-H08) burada kasıtlı olarak yinelendi.
 */
function completedCountInWindow(
  habit: Habit,
  logs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>[],
  window: { start: Date; end: Date },
): number {
  const startYmd = ymd(window.start);
  const endYmd = ymd(window.end);
  let count = 0;
  for (const log of logs) {
    if (log.habit_id !== habit.id) continue;
    const d = log.completed_at.slice(0, 10); // completed_at zaten yerel 'date' kolonu — UTC dönüşümü yok, no-op.
    if (d < startYmd || d > endYmd) continue;
    if (log.state === 'done' || log.state === 'partial') count += 1;
  }
  return count;
}

/**
 * Sayaç-tabanlı bir alışkanlığın penceresi, hedefini KARŞILAMIŞ mı?
 * Pencere kavramı olmayan modlarda (`daily`/`weekly_days`/`every_n_days`/`date_range`)
 * bilinçli olarak `true` döner — "boş sorgu, boş doğru": bu fonksiyon onlar için
 * anlamsızdır ve `false` dönmesi çağıranı yanlışlıkla "kaçırıldı" sonucuna
 * götürebilirdi. Bu modların kaçırma tespiti tamamen `streakBroken`'ın gün-bazlı
 * dalındadır.
 */
export function isWindowSatisfied(
  habit: Habit,
  logs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>[],
  date: Date,
): boolean {
  const window = windowFor(habit, date);
  if (!window) return true;
  if (window.targetCount <= 0) return true; // hedef yoksa karşılanamayacak bir şey de yok
  return completedCountInWindow(habit, logs, window) >= window.targetCount;
}

/**
 * Bir alışkanlığın akışı `date` itibarıyla BOZULDU mu?
 *
 * Planın başlık örneği (§8.7): "Gym, haftada 3" alışkanlığı Pazartesi'yi kaçırırsa
 * akış BOZULMAZ — başarı GÜNLÜK değil, HAFTALIK PENCERE üzerinden değerlendirilir.
 *
 * Sayaç-tabanlı (`weekly_count`/`monthly_count`) modlar için: pencerede hedef zaten
 * karşılanmışsa bozulmamıştır; karşılanmamışsa, pencerenin KALAN günleriyle hedefe
 * ulaşmak hâlâ MATEMATİKSEL olarak mümkün olduğu sürece de bozulmamıştır — ancak
 * hedefe ulaşmak artık imkânsız hâle geldiğinde (kalan gün sayısı, eksik kalan sayıdan
 * azsa) bozulmuş sayılır. `skip` günleri bu sayıma hiç girmez (ne pay ne payda) —
 * dolayısıyla bir skip, kalan günleri azaltmaz ve tek başına akışı bozamaz.
 *
 * Gün-bazlı modlar (`daily`/`weekly_days`/`every_n_days`/`date_range`) için: yalnızca
 * `date` gerçekten due İSE ve o gün için `done`/`partial` bir log YOKSA bozulmuş
 * sayılır. `skip` burada da AÇIKÇA cezasızdır: due bir günün logu `skip` ise akış
 * bozulmaz (§8.5 — "skip akış cezası yaratmamalı").
 */
export function streakBroken(
  habit: Habit,
  logs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>[],
  date: Date,
): boolean {
  const sk = scheduleKind(habit);

  if (sk.kind === 'weekly_count' || sk.kind === 'monthly_count') {
    if (sk.count <= 0) return false; // hedef yok → bozulacak bir şey yok

    const window = windowFor(habit, date);
    if (!window) return false; // teorik olarak ulaşılamaz (sk zaten sayaç-tabanlı); savunma amaçlı

    const doneSoFar = completedCountInWindow(habit, logs, window);
    if (doneSoFar >= window.targetCount) return false; // hedef zaten karşılandı

    const remainingDays = daysBetweenLocal(date, window.end) + 1; // `date` dahil, pencere sonuna kalan gün
    if (remainingDays <= 0) return true; // pencere bitti, hedef karşılanmadı
    return (window.targetCount - doneSoFar) > remainingDays; // kalan günlerle bile yetişilemez mi?
  }

  // Gün-bazlı modlar
  if (!dueOnExtended(habit, date)) return false; // due değilse bozulacak bir şey yok

  const ds = ymd(date);
  const logForDay = logs.find((l) => l.habit_id === habit.id && l.completed_at.slice(0, 10) === ds);
  if (logForDay?.state === 'skip') return false; // skip cezasız (§8.5)
  const hasCompletion = logForDay ? (logForDay.state === 'done' || logForDay.state === 'partial') : false;
  return !hasCompletion;
}

/**
 * How often the habit was actually done, over the days it was actually DUE.
 *
 * ## Why this exists here and not in `capacity.ts`
 *
 * `capacity.masteryStatus` carried this note:
 *
 *     TODO(phase1-wiring): `recent_completion_rate` here is a LOCAL
 *     approximation -- `done` logs divided by TOTAL logs within the trailing
 *     window. It does not know the habit's actual due-schedule.
 *
 * That approximation is not merely imprecise, it is biased in one direction:
 * the denominator is the days the user TOUCHED, so a habit due seven days a
 * week and logged `done` on the two days it was remembered scores 1.00 — a
 * perfect completion rate for 2/7 adherence. Mastery is granted on that
 * number, so the weakest habits were the easiest to certify.
 *
 * The correct denominator is due days, and which days are due is this
 * module's job. Putting the calculation in `capacity.ts` would have meant a
 * second implementation of "is it due today" living next to `isDueOn`, which
 * is the duplication the note was avoiding by leaving it undone.
 *
 * ## The two exclusions, both reused rather than re-decided
 *
 *  - `state === 'skip'` leaves the numerator AND the denominator. A day the
 *    user explicitly excused is not evidence either way — the same rule
 *    `habitStrength` applies.
 *  - `countsTowardAverage` decides unlogged days. For a negative habit an
 *    empty day is excluded rather than scored zero, because scoring it zero
 *    asserts the day went badly on no evidence. That decision already exists
 *    directly below; it is called, not repeated.
 *
 * A window with no due days returns `rate: 0` with `dueDays: 0`. Callers that
 * care about the difference between "never due" and "due and never done"
 * must read `dueDays` — the rate alone cannot carry it, and returning `1` for
 * an empty window would certify a habit that has done nothing.
 */
export type ScheduledCompletion = {
  /** doneDays / dueDays, or 0 when nothing was due. */
  rate: number;
  /** Due days in the window, after the skip and negative-habit exclusions. */
  dueDays: number;
  doneDays: number;
};

export function scheduledCompletionRate(
  habit: Habit,
  logs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>[],
  range: { from: Date; to: Date; since?: Date | null },
): ScheduledCompletion {
  // Count-based schedules have no "due days" to enumerate. Their denominator is
  // the PERIOD TARGET (3 for "3 a week", 10 for "10 a month"), never 7 calendar
  // days and never the weekdays `countDueDays` used to invent; the day walk
  // below would score a Tue/Thu/Sun user 0/3. Routed through the canonical
  // evaluator instead (R01.02-a).
  const sk = scheduleKind(habit);
  if (sk.kind === 'weekly_count' || sk.kind === 'monthly_count') {
    return periodCompletionRate(habit, logs, range);
  }

  const fromYmd = ymd(range.from);
  const toYmd = ymd(range.to);
  const sinceYmd = range.since ? ymd(range.since) : null;

  // One log per habit per day is a store-level invariant; if it is violated
  // the last entry in array order wins, matching `habitStrength`'s documented
  // tiebreak rather than inventing a second one.
  const byDay = new Map<string, { state: string }>();
  for (const l of logs) {
    if (l.habit_id != null && l.habit_id !== habit.id) continue;
    const d = l.completed_at.slice(0, 10);
    if (d < fromYmd || d > toYmd) continue;
    byDay.set(d, { state: l.state });
  }

  let dueDays = 0;
  let doneDays = 0;

  for (let cursor = range.from; ymd(cursor) <= toYmd; cursor = addDaysLocal(cursor, 1)) {
    const day = ymd(cursor);
    if (sinceYmd && day < sinceYmd) continue;   // the habit did not exist yet
    // R01.02-c — day lane only (count modes returned above via `scheduleKind`).
    // `isEligibleOn` == `dueOnExtended` here: identical to `isDueOn` for
    // daily/weekly_days, and the only path that honours interval_days/ranges.
    if (!isEligibleOn(habit, cursor)) continue;

    const log = byDay.get(day);
    if (log?.state === 'skip') continue;        // excused: out of both sides
    if (!countsTowardAverage(habit, log)) continue;

    dueDays += 1;
    if (log?.state === 'done') doneDays += 1;
  }

  return { rate: dueDays === 0 ? 0 : doneDays / dueDays, dueDays, doneDays };
}

/**
 * `scheduledCompletionRate` for count-based schedules, in period units.
 *
 * Every calendar period overlapping `[max(from, since), to]` contributes its
 * TARGET to the denominator and its unique done/partial days (within the
 * overlap) to the numerator -- both taken from `periodStatus`, so this can
 * never disagree with the canonical evaluator on the same fixture. A period the
 * range only partly covers (the current, still-open week; a 7-day bucket that
 * straddles two calendar weeks) contributes its target PRORATED by the covered
 * fraction: a week seen Mon..Wed carries 3 x 3/7, not 3 -- an open week is
 * never charged for days that have not happened. The numerator is capped at
 * the share so five completions in a "3 a week" period are 100%, not 166%.
 *
 * `dueDays` is therefore a target sum and may be fractional; callers already
 * use it only as "was anything due at all".
 *
 * KNOWN APPROXIMATION, stated rather than hidden: proration assumes the user's
 * completions spread evenly across a period. A range edge that cuts a period
 * unevenly relative to the days the user actually chose moves the rate a few
 * points either way -- a 28-day window ending on a Thursday sees Fri..Sun of
 * its first week and charges 3/7 of the target while a Tue/Thu/Sun user only
 * has Sunday there (0.98 instead of 1.00 in the mastery fixture). Full
 * periods are exact. The alternative -- dropping partial periods -- would zero
 * out every 7-day stability bucket, which is worse than a bounded edge error.
 */
function periodCompletionRate(
  habit: Habit,
  logs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>[],
  range: { from: Date; to: Date; since?: Date | null },
): ScheduledCompletion {
  const start = range.since && ymd(range.since) > ymd(range.from) ? range.since : range.from;
  const startYmd = ymd(start);
  const toYmd = ymd(range.to);
  if (startYmd > toYmd) return { rate: 0, dueDays: 0, doneDays: 0 };

  // Only what falls inside the range can count toward it.
  const inRange = logs.filter((l) => {
    const d = l.completed_at.slice(0, 10);
    return d >= startYmd && d <= toYmd;
  });

  let due = 0;
  let done = 0;
  let cursor = start;
  while (ymd(cursor) <= toYmd) {
    const st = periodStatus(habit, inRange, cursor, { asOf: range.to });
    if (st.target > 0) {
      const overlapStart = ymd(st.periodStart) > startYmd ? st.periodStart : start;
      const overlapEnd = ymd(st.periodEnd) < toYmd ? st.periodEnd : range.to;
      const covered = daysBetweenLocal(overlapStart, overlapEnd) + 1;
      const periodDays = daysBetweenLocal(st.periodStart, st.periodEnd) + 1;
      const share = st.target * (covered / periodDays);
      due += share;
      done += Math.min(st.counted, share);
    }
    cursor = addDaysLocal(st.periodEnd, 1);
  }

  // Prorated shares are fractions of sevenths and thirtieths; round so the
  // sum does not surface as 11.999999999999998 in a reasons string.
  const dueDays = Math.round(due * 1e6) / 1e6;
  const doneDays = Math.round(done * 1e6) / 1e6;
  return { rate: dueDays === 0 ? 0 : doneDays / dueDays, dueDays, doneDays };
}

/**
 * CANONICAL ELIGIBILITY -- "can the user log this habit on `date`?"
 *
 * This is the question `isDueOn` was never actually answering for anyone (see
 * its doc). The two differ only where they must:
 *
 *   weekly count / monthly count   eligible on EVERY day of a period the habit
 *                                  is alive in and has a target for. Whether the
 *                                  period is met is `periodStatus`'s question;
 *                                  no day is an obligation, so no day is a miss.
 *   fixed weekdays                 only the configured days (unchanged)
 *   daily / every N days / date range   as today (`dueOnExtended`)
 *
 * There is no yearly-date mode in the schema or in `scheduleKind`; none is
 * fabricated here.
 */
export function isEligibleOn(habit: Habit, date: Date): boolean {
  const sk = scheduleKind(habit);
  if (sk.kind === 'weekly_count' || sk.kind === 'monthly_count') {
    return sk.count > 0 && withinLifetime(habit, date);
  }
  return dueOnExtended(habit, date);
}

/**
 * Did the user MISS this habit on a due day?
 *
 * The rule is deliberately asymmetric, and the asymmetry is the whole point
 * of separating this from `isDueOn`:
 *
 *   positive habit  — no log means missed. You either did the thing or you
 *                     did not, and not recording it is not doing it.
 *   negative habit  — no log means UNKNOWN, not missed. "At most 2
 *                     cigarettes" with nothing recorded says nothing about
 *                     the day; treating it as a failure would fill the
 *                     recovery backlog with days the user simply did not
 *                     open the app, and would drag the completion average
 *                     down for behaviour that may well have been perfect.
 *
 * A negative habit is missed only when there IS a log saying so — an explicit
 * `miss`, or a value over its ceiling, which `deriveState` already resolves.
 */
export function isMissedOn(
  habit: Pick<Habit, 'behavior_type'>,
  log: { state: string } | undefined,
): boolean {
  if (!log) return habit.behavior_type !== 'negative';
  return log.state === 'miss';
}

/**
 * Should this due day count towards a completion average?
 *
 * Mirrors `isMissedOn`: an unlogged day for a negative habit is excluded from
 * the denominator rather than scored zero, because scoring it zero is the
 * same claim — that nothing recorded means it went badly.
 */
export function countsTowardAverage(
  habit: Pick<Habit, 'behavior_type'>,
  log: { state: string } | undefined,
): boolean {
  return !!log || habit.behavior_type !== 'negative';
}

// =====================================================================================
// V3 — Canonical period status (Implementation v3.0, R01.01-a; guide §7.1)
//
// ADDITIVE. Nothing above this line changed. `isDueOn`, `streakBroken`,
// `windowFor` and `completedCountInWindow` keep their behaviour and their tests;
// `periodStatus` CONSUMES them. It is the single answer to "where does this habit
// stand in its period?" that the R01.02 consumer migration will route every
// screen through, so that Bugün, detay, raporlar, recovery, review, bildirim ve
// AI aynı sayıyı görür.
//
// What it separates that the older helpers conflate:
//   - DAILY ELIGIBILITY ("can I log this today?", `isDueOn`) from PERIOD SUCCESS
//     ("did I meet the week's target?"). For count modes the fixed-day mapping in
//     `isDueOn` is precisely the defect R01 exists to remove (Sal/Per/Paz users
//     scored as three misses); this evaluator never goes near `countDueDays`.
//   - What is COUNTED (unique local days, sessions, amount) from what was TARGETED.
//   - "not met YET" from "not met" -- an open period is never `closed_unmet`.
//
// What it does NOT do: invent data the schema does not hold. There is no session
// identity in `habit_logs` (one row per habit per local day), so `unit:'sessions'`
// is honestly `unknown`. There is no per-habit timezone or week-start column, so
// the basis is the device-local day and a Monday week, and it SAYS so in every
// result rather than pretending a persisted preference exists.
// =====================================================================================

/** What the period target is denominated in. */
export type PeriodUnit = 'days' | 'sessions' | 'amount';

/**
 * Where the habit stands in the period that contains `date`.
 *
 *   not_started   open period, nothing counted yet
 *   in_progress   open period, some progress, target not yet met
 *   satisfied     target met (open or closed -- success does not expire)
 *   closed_unmet  period is over (as of `asOf`) and the target was not met
 *   paused        the habit is paused; nothing is evaluated
 *   unknown       no target, unsupported unit, or not scheduled -- see `reason`
 *
 * Turkish labels for the UI are the consumer's job; these are API values.
 */
export type PeriodStatusKind =
  | 'not_started' | 'in_progress' | 'satisfied' | 'closed_unmet' | 'paused' | 'unknown';

/** Machine-readable explanation. Every `unknown` names its cause. */
export type PeriodReason =
  | 'ok'
  | 'habit_paused'
  | 'no_target'
  | 'sessions_unsupported'
  | 'amount_unsupported'
  | 'not_scheduled'
  | 'period_not_started'
  | 'unreachable_in_remaining_days'
  | 'skipped'
  | 'explicit_miss'
  | 'provisional_until_close';

export type PeriodStatus = {
  /** Local calendar bounds of the period, inclusive. Day-based modes: the day itself. */
  periodStart: Date;
  periodEnd: Date;
  unit: PeriodUnit;
  /** The target in `unit`. 0 when there is none. */
  target: number;
  /** Entries that contributed: unique local days for `days`, logs carrying a value for `amount`. */
  counted: number;
  /** Progress toward `target`, in `unit`. Equals `counted` for `days`. */
  actual: number;
  /** `max(target - actual, 0)`. 0 whenever the target is met or undefined. */
  remaining: number;
  status: PeriodStatusKind;
  reason: PeriodReason;
  /**
   * What the calendar arithmetic assumed. Neither is persisted per habit
   * (verified: `habits` has no `timezone` / `week_start` column), so the
   * evaluator states its basis instead of implying a preference exists.
   */
  basis: { readonly timezone: 'device-local'; readonly weekStart: 'monday' };
};

export type PeriodStatusOptions = {
  /**
   * The moment "now" is judged from. Decides whether the period containing
   * `date` is still open. Defaults to the real clock; tests pass it explicitly.
   */
  asOf?: Date;
  /**
   * Force the unit. `'sessions'` is accepted so callers can ask, and is answered
   * honestly with `unknown`/`sessions_unsupported` until R05 introduces session
   * identities. Omit to let the habit decide.
   */
  unit?: PeriodUnit;
};

const PERIOD_BASIS = Object.freeze({ timezone: 'device-local', weekStart: 'monday' } as const);

type LogForPeriod = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'> & { value?: number | null };

function unknownStatus(
  periodStart: Date, periodEnd: Date, unit: PeriodUnit, reason: PeriodReason,
): PeriodStatus {
  return {
    periodStart, periodEnd, unit,
    target: 0, counted: 0, actual: 0, remaining: 0,
    status: 'unknown', reason, basis: PERIOD_BASIS,
  };
}

/**
 * One representative log per (habit, local day), so that a day is counted once.
 *
 * `completedCountInWindow` counts ROWS and leans on the store's one-row-per-day
 * invariant. That invariant holds in the database (`UNIQUE (habit_id, date)`),
 * but not necessarily in the array a consumer hands over: an optimistic row
 * next to its synced twin, a retried completion, a merged offline queue. The
 * guide's rule is explicit -- "aynı gün üç kayıt üç gün değildir" -- so the
 * evaluator collapses duplicates BEFORE counting instead of changing the
 * helper's contract. Within a day, `done` beats `partial` beats the rest, so a
 * day that was completed is not demoted by a stale partial row.
 */
function oneLogPerDay(habit: Habit, logs: LogForPeriod[]): LogForPeriod[] {
  const rank = (state: string) => (state === 'done' ? 3 : state === 'partial' ? 2 : state === 'skip' ? 1 : 0);
  const byDay = new Map<string, LogForPeriod>();
  for (const l of logs) {
    if (l.habit_id !== habit.id) continue;
    const day = l.completed_at.slice(0, 10);
    const cur = byDay.get(day);
    if (!cur || rank(l.state) >= rank(cur.state)) byDay.set(day, l);
  }
  return Array.from(byDay.values());
}

/** Does the habit's own model measure an amount per day? `daily_goal` is the target. */
function amountTarget(habit: Habit): number | null {
  const measured = habit.tracking_type === 'numeric' || habit.tracking_type === 'duration';
  const goal = habit.daily_goal;
  return measured && typeof goal === 'number' && goal > 0 ? goal : null;
}

/**
 * Canonical period evaluator.
 *
 * `date` selects the period; `opts.asOf` decides whether that period is over.
 * Reuses the module's own machinery -- `scheduleKind` for the mode, `windowFor`
 * for count-mode bounds, `completedCountInWindow` for unique done/partial days
 * (its done+partial rule is AC-H07/AC-H08, inherited not re-decided), and the
 * private `dueOnExtended` for day-based eligibility -- so there is one window
 * engine, not two.
 */
export function periodStatus(
  habit: Habit,
  logs: LogForPeriod[],
  date: Date,
  opts: PeriodStatusOptions = {},
): PeriodStatus {
  const asOf = opts.asOf ?? new Date();
  const window = windowFor(habit, date);
  const periodStart = window ? window.start : date;
  const periodEnd = window ? window.end : date;

  // Sessions: the schema has no session identity (one log row per habit per
  // local day), and counting days as sessions would be the fake count the
  // guide forbids. Answered before anything else so the caller cannot mistake
  // a day count for a session count.
  if (opts.unit === 'sessions') {
    return unknownStatus(periodStart, periodEnd, 'sessions', 'sessions_unsupported');
  }

  // Paused: nothing is evaluated. There is no pause-interval model in the
  // schema, only the habit-level status; that is what this reflects.
  if (habit.status === 'paused') {
    const unit: PeriodUnit = opts.unit ?? (window ? 'days' : amountTarget(habit) ? 'amount' : 'days');
    return { ...unknownStatus(periodStart, periodEnd, unit, 'habit_paused'), status: 'paused' };
  }

  const closed = ymd(asOf) > ymd(periodEnd);
  const beforeStart = ymd(asOf) < ymd(periodStart);

  // ---- Count modes: weekly_count / monthly_count -> unit 'days' ----------------
  if (window) {
    if (opts.unit === 'amount') {
      // No period-level amount target exists in the model (daily_goal is per
      // day, count is per period). Not aggregated, not guessed.
      return unknownStatus(periodStart, periodEnd, 'amount', 'amount_unsupported');
    }
    const target = window.targetCount;
    if (target <= 0) return unknownStatus(periodStart, periodEnd, 'days', 'no_target');

    const counted = completedCountInWindow(habit, oneLogPerDay(habit, logs), window);
    const remaining = Math.max(target - counted, 0);
    const base = {
      periodStart, periodEnd, unit: 'days' as const, target, counted, actual: counted, remaining, basis: PERIOD_BASIS,
    };

    if (counted >= target) return { ...base, status: 'satisfied', reason: 'ok' };
    if (beforeStart) return { ...base, status: 'not_started', reason: 'period_not_started' };
    if (closed) return { ...base, status: 'closed_unmet', reason: 'ok' };
    if (counted === 0) return { ...base, status: 'not_started', reason: 'ok' };
    // Open and short of target. `streakBroken` already knows whether the rest
    // of the window can still carry it; surface that as a reason, not as a
    // status -- the period is not over, so it is not failed.
    const daysLeft = daysBetweenLocal(asOf, window.end) + 1;
    const reason: PeriodReason = remaining > daysLeft ? 'unreachable_in_remaining_days' : 'ok';
    return { ...base, status: 'in_progress', reason };
  }

  // ---- Day-based modes: daily / weekly_days / every_n_days / date_range -------
  // The period is the day. Eligibility comes from the SAME predicate the
  // day-based branch of `streakBroken` uses; `isDueOn`'s count-mode mapping is
  // never reached here because count modes took the window branch above.
  if (!dueOnExtended(habit, date)) {
    const unit: PeriodUnit = opts.unit ?? (amountTarget(habit) ? 'amount' : 'days');
    return unknownStatus(periodStart, periodEnd, unit, 'not_scheduled');
  }

  const ds = ymd(date);
  const dayLogs = logs.filter((l) => l.habit_id === habit.id && l.completed_at.slice(0, 10) === ds);
  // One log per habit per day is the store invariant; if it is violated the
  // last one wins, matching `scheduledCompletionRate`'s documented tiebreak.
  const log = dayLogs.length > 0 ? dayLogs[dayLogs.length - 1] : undefined;
  const done = log?.state === 'done' || log?.state === 'partial';

  const goal = amountTarget(habit);
  const wantAmount = opts.unit === 'amount' || (opts.unit === undefined && goal !== null);
  const unitForDay: PeriodUnit = wantAmount ? 'amount' : 'days';

  // An excused day is out of both numerator and denominator -- the same rule
  // `scheduledCompletionRate` and `habitStrength` apply. Not a success, not a
  // failure, not "nothing happened": it is `unknown` with its own reason.
  if (log?.state === 'skip') return unknownStatus(periodStart, periodEnd, unitForDay, 'skipped');

  // An explicit `miss` is the user's (or the engine's ceiling) verdict on the
  // day. The calendar has not closed the period; the log has. Reported as
  // `closed_unmet` with a reason that says which of the two closed it.
  const explicitMiss = log?.state === 'miss';

  if (wantAmount) {
    if (goal === null) return unknownStatus(periodStart, periodEnd, 'amount', 'amount_unsupported');
    const value = typeof log?.value === 'number' ? log.value : null;
    const counted = value === null ? 0 : 1;
    const actual = value ?? 0;
    // For `at_most` (ceiling) habits "remaining" has no meaning; the engine's
    // `state` already carries the verdict. Reported as 0 rather than invented.
    const remaining = habit.target_direction === 'at_most' ? 0 : Math.max(goal - actual, 0);
    const base = {
      periodStart, periodEnd, unit: 'amount' as const, target: goal, counted, actual, remaining, basis: PERIOD_BASIS,
    };
    // Satisfaction is decided by the same `state` the engine wrote
    // (`completionFor`/`deriveState`), so ceiling and floor semantics are not
    // re-derived here. A `partial` is progress, not satisfaction, for amount.
    if (explicitMiss) return { ...base, status: 'closed_unmet', reason: 'explicit_miss' };
    if (log?.state === 'done') {
      // A ceiling met mid-day can still be exceeded before the day closes
      // (guide §7.1: "sabah 1 kayıt, gün sonunda 3"). Satisfied, but flagged.
      const provisional = habit.target_direction === 'at_most' && !closed;
      return { ...base, status: 'satisfied', reason: provisional ? 'provisional_until_close' : 'ok' };
    }
    if (beforeStart) return { ...base, status: 'not_started', reason: 'period_not_started' };
    if (closed) return { ...base, status: 'closed_unmet', reason: 'ok' };
    if (counted === 0) return { ...base, status: 'not_started', reason: 'ok' };
    return { ...base, status: 'in_progress', reason: 'ok' };
  }

  const counted = done ? 1 : 0;
  const base = {
    periodStart, periodEnd, unit: 'days' as const, target: 1, counted, actual: counted, remaining: done ? 0 : 1, basis: PERIOD_BASIS,
  };
  if (explicitMiss) return { ...base, status: 'closed_unmet', reason: 'explicit_miss' };
  if (done) return { ...base, status: 'satisfied', reason: 'ok' };
  if (beforeStart) return { ...base, status: 'not_started', reason: 'period_not_started' };
  if (closed) return { ...base, status: 'closed_unmet', reason: 'ok' };
  return { ...base, status: 'not_started', reason: 'ok' };
}

// =====================================================================================
// R01.02-b — per-day LOAD, for the screens that ask "how much does this day carry?"
// =====================================================================================

/**
 * Does `habit` put work on `date` that the user could still discharge that day?
 *
 * This is the question `dailyLoad`'s `habits` argument actually asks, and it is
 * NOT `isDueOn`. For a day-based schedule the two coincide, so those habits keep
 * their exact previous behaviour. For a count-based one ("3 a week", "10 a
 * month") `isDueOn` answered it by inventing fixed weekdays via `countDueDays`,
 * which put load on Mon/Wed/Fri for a Tue/Thu/Sun user and none on the days they
 * actually worked.
 *
 * The period-aware answer: a count-based habit carries load on every day its
 * period is still open and the target is not yet met, and none once it is. So
 * "3 a week" finished by Wednesday stops loading Thu-Sun, and a week left at 1/3
 * loads every remaining day -- no invented weekdays in either direction.
 *
 * `date` is judged AS OF ITSELF, not as of now: walking a past week must see what
 * was still outstanding on each of its days, not what the week eventually became.
 * A `paused`/`unknown` period carries nothing.
 */
/**
 * Is this a "N per period" schedule ("3 a week", "10 a month") rather than one
 * pinned to particular days?
 *
 * The distinction decides whether a DAY-level verdict exists at all. A count
 * schedule has no per-day obligation, so "was this day missed?" has no answer
 * for it -- only "was the period met?" (`periodStatus`). Callers that produce
 * per-day misses must consult this first; `isDueOn` answers them by inventing
 * weekdays and is the defect R01 removes.
 */
export function isCountBasedSchedule(habit: Habit): boolean {
  const kind = scheduleKind(habit).kind;
  return kind === 'weekly_count' || kind === 'monthly_count';
}

export function carriesDayLoad(habit: Habit, logs: LogForPeriod[], date: Date): boolean {
  if (!isCountBasedSchedule(habit)) {
    // R01.02-c — day lane (guard: the `if` above). `isEligibleOn` is `isDueOn`
    // for daily/weekly_days and additionally narrows every_n_days/date_range.
    return isEligibleOn(habit, date);
  }
  if (!isEligibleOn(habit, date)) return false;
  // `periodStatus`'s `asOf` decides whether the period is CLOSED; it does not
  // hide later completions, so the logs must be clipped as well -- otherwise a
  // week finished on Wednesday would read as zero-load on Monday too, and a week
  // nobody touched would be the only kind that ever looks busy.
  //
  // The clip is STRICTLY BEFORE `date`: the question is what the day BEGAN owing.
  // Including the day's own completion would make exactly the days the user did
  // the work the days that count as free. With this rule a "3 a week" habit
  // finished Mon-Wed carries load on Mon, Tue and Wed and nothing after -- three
  // loaded days for a target of three, on the days it actually happened.
  const ds = ymd(date);
  const before = logs.filter((l) => l.completed_at.slice(0, 10) < ds);
  const st = periodStatus(habit, before, date, { asOf: date });
  return st.status === 'not_started' || st.status === 'in_progress';
}
