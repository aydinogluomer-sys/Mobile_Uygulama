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
export function isDueOn(habit: Habit, date: Date): boolean {
  const ds = ymd(date);
  // Oluşturulmadan önceki günlerde due değil
  if (habit.created_at && ymd(new Date(habit.created_at)) > ds) return false;
  // Tarihli bitiş koşulu geçmişse due değil
  const ec = habit.end_condition;
  if (ec && ec.kind === 'date' && typeof ec.value === 'string' && ds > ec.value) return false;

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
// `range_start`, `range_end` — bkz. lib/supabase.ts). Bunlar bugün hiçbir yerde
// persist edilmiyor (migration bloklu); yalnızca bu modülün V2 fonksiyonları onları
// okuyor. Var olan hiçbir satır bu alanları taşımadığı için (hepsi undefined),
// eski davranış tamamen korunuyor.
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
 *     Bu basitleştirme kabul edilebilir çünkü migration bloklu olduğu sürece hiçbir
 *     kombinasyon zaten kalıcı hâle gelemiyor; V1 kapsamı yalnızca "bu pencerede her
 *     gün" senaryosunu kapsıyor.
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
  logs: Array<Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>>,
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
  logs: Array<Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>>,
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
  logs: Array<Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>>,
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
