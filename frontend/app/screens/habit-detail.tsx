/**
 * Habit Detail screen.  (Phase 2, CODER-H, plan §11)
 *
 * Header block (name + Strength/Current streak/Best streak/Completion) is
 * always visible above four tabs -- GENEL / GEÇMİŞ / TAKVİM / İÇGÖRÜ.
 *
 * ## The one rule every Result-consuming line here obeys
 *
 * `lib/behaviorIntelligence.ts` returns `{ ok: true, value }` for a real
 * answer and `{ ok: false, reason }` when the sample is too thin to trust --
 * see that file's own doc for why. This screen NEVER substitutes a literal
 * `0` (or any other fabricated number) for a `{ ok: false }` result -- every
 * such branch renders `result.reason` instead, exactly as `willpowerStore`
 * already does for "no reading yet" elsewhere in this codebase. See
 * `__tests__/repo/habitDetailScreen.test.ts` for the regression fence.
 *
 * ## Where the data comes from
 *
 * `habit` itself is read straight from `useHabitStore()` (already fetched by
 * whichever screen navigated here) rather than re-queried -- Rule 4 governs
 * DB access, not in-memory store reads. Logs are fetched ONCE, for the whole
 * [habit.created_at, today] window, via the new
 * `repositories/habitLogRepository.fetchHabitLogsForHabit` (added for this
 * task -- see that function's own doc for why no existing repository shape
 * fit). Every tab/range below derives its view from that same in-memory log
 * array; switching ranges or tabs never re-fetches.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';

import { useHabitStore } from '../../store/habitStore';
import type { Habit, FrequencyConfig } from '../../lib/supabase';
import { colors, space, radius, font, hexA } from '../../lib/tokens';
import { Card, SectionHeader, EmptyState, Chip, IconCircle, StatTile, Skeleton, SkeletonLines } from '../../components/ui';
import { haptic } from '../../lib/haptics';
import { addDaysLocal, parseLocalDate, ymd, ymdFromIso, type Ymd } from '../../lib/date';
import { isCountBasedSchedule, isEligibleOn } from '../../lib/habitSchedule';
// KD-09 — the schedule is shown with the same sentence the form uses, and edited
// with the same controls (one component, one set of pure transitions).
import { frequencySummary, frequencyEditPatch, isFrequencyComplete } from '../../lib/frequencyForm';
import FrequencyEditor from '../../components/FrequencyEditor';
// R01.05 — a dated break for this habit, and the holiday it may be in.
import TimeOffSheet from '../../components/TimeOffSheet';
import { activePauseOn } from '../../lib/habitPauses';
import { completionPercent, isMeasurableTracking } from '../../lib/habitEngine';
import { habitStrength, type StrengthLog } from '../../lib/habitStrength';
import {
  habitCompletionRate,
  weekdayBreakdown,
  bestWeekday,
  worstWeekday,
  habitFragility,
  completionTrend,
  streakStability,
  currentStreak,
  longestStreak,
  type Result,
} from '../../lib/behaviorIntelligence';
import { logsForHabit, type HabitDetailLogRow } from '../../services/habitService';
import { LIFE_AREAS } from '../../store/lifeAreasStore';
import { endConditionLabel } from '../../lib/triage';
import { DOW_TR } from '../../lib/focusReport';

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------

type TabKey = 'genel' | 'gecmis' | 'takvim' | 'icgoru';

const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'genel', label: 'GENEL', icon: 'information-circle-outline' },
  { key: 'gecmis', label: 'GEÇMİŞ', icon: 'time-outline' },
  { key: 'takvim', label: 'TAKVİM', icon: 'calendar-outline' },
  { key: 'icgoru', label: 'İÇGÖRÜ', icon: 'bulb-outline' },
];

// ---------------------------------------------------------------------------
// TAKVİM -- five visually distinct states (plan §11: "must not share a colour")
// ---------------------------------------------------------------------------

type CalendarDayState = 'full' | 'partial' | 'miss' | 'skip' | 'not_scheduled';

/**
 * One colour per plan §11 calendar state. Sourced from lib/tokens.ts's
 * existing semantic palette (never a hardcoded hex, per that file's own
 * convention) -- five DIFFERENT tokens chosen specifically because they
 * resolve to five different hex values, which is what the plan actually
 * requires and what __tests__/repo/habitDetailScreen.test.ts verifies by
 * resolving each token against the real palette rather than trusting the
 * token names alone.
 */
const CALENDAR_STATE_COLORS: Record<CalendarDayState, string> = {
  full: colors.success,
  partial: colors.warning,
  miss: colors.error,
  skip: colors.info,
  not_scheduled: colors.textGhost,
};

const STATE_LABELS: Record<CalendarDayState, string> = {
  full: 'Tamamlandı',
  partial: 'Kısmi',
  miss: 'Kaçırıldı',
  skip: 'Atlandı',
  not_scheduled: 'Planlı değil',
};

/** A day after "today" has no verdict yet -- distinct from every real state, never one of the five. */
function cellColor(state: CalendarDayState | 'future'): string {
  return state === 'future' ? colors.borderSubtle : CALENDAR_STATE_COLORS[state];
}

// ---------------------------------------------------------------------------
// GEÇMİŞ -- range options
// ---------------------------------------------------------------------------

const RANGE_OPTIONS: { key: string; label: string; days: number | null }[] = [
  { key: '7', label: 'Son 7 gün', days: 7 },
  { key: '30', label: 'Son 30 gün', days: 30 },
  { key: '90', label: 'Son 90 gün', days: 90 },
  { key: '365', label: '1 yıl', days: 365 },
  { key: 'all', label: 'Tümü', days: null },
];

/** Bar-strip is capped from the recent end, purely for render cost -- the completion RATE shown next to it always covers the full selected range, uncapped. */
const MAX_STRIP_DAYS = 400;

const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// ---------------------------------------------------------------------------
// pure helpers -- presentational only, no domain logic re-implemented here
// (isDueOn/currentStreak/etc. are all reused from lib/**, never redecided)
// ---------------------------------------------------------------------------

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
function firstWeekdayOfMonth(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1; // Pazartesi = 0, habitSchedule.weekdayIndex ile aynı kural
}

/** Inclusive local-day list; capped from the END (most recent) so a multi-year "Tümü" range still renders a bounded strip. */
function daysInRangeCapped(start: Ymd, end: Ymd, maxDays: number): Ymd[] {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  if (!s || !e || s.getTime() > e.getTime()) return [];
  const out: Ymd[] = [];
  let cur = s;
  while (cur.getTime() <= e.getTime()) {
    out.push(ymd(cur));
    cur = addDaysLocal(cur, 1);
  }
  return out.length > maxDays ? out.slice(out.length - maxDays) : out;
}

/** max(candidateStart, sinceYmd) -- a habit cannot have a range starting before it existed. */
function clampStart(candidateStart: Ymd, sinceYmd: Ymd): Ymd {
  return candidateStart > sinceYmd ? candidateStart : sinceYmd;
}

function rangeStartFor(days: number | null, sinceYmd: Ymd, todayD: Date): Ymd {
  if (days == null) return sinceYmd; // 'Tümü'
  return clampStart(ymd(addDaysLocal(todayD, -(days - 1))), sinceYmd);
}

type DayCell = { date: Ymd; state: CalendarDayState | 'future'; value: number | null };

/**
 * Per-day verdict for the calendar/history views. Reuses the schedule oracle
 * rather than re-deciding due-ness, and treats a DUE day with no log the same
 * way `lib/habitSchedule.streakBroken` does -- as a miss, not a fabricated
 * "unknown".
 *
 * R01.02-b -- a count schedule ("3 a week") gets a different rule, because it
 * has no per-day obligation to miss. Routing it through `isDueOn` was wrong in
 * BOTH directions: the invented Mon/Wed/Sat were painted as misses, and a real
 * Tuesday completion came back `not_scheduled`, so the work the user actually
 * did was hidden from its own calendar. Here a log is the only thing that can
 * give such a day a state; an unlogged one owes nothing. Whether the PERIOD was
 * met is `periodStatus`'s question, not a cell's.
 */
export function dayCellFor(habit: Habit, logIndex: Map<Ymd, HabitDetailLogRow>, dateObj: Date, todayYmd: Ymd): DayCell {
  const d = ymd(dateObj);
  if (d > todayYmd) return { date: d, state: 'future', value: null };
  const log = logIndex.get(d);
  const countBased = isCountBasedSchedule(habit);
  // R01.02-c — day lane: `!countBased` short-circuits first. `isEligibleOn` = `isDueOn` for daily/weekly_days; it adds the every_n_days interval. The date range is not a mode: it is the lifetime envelope (`withinLifetime`) both read.
  if (!countBased && !isEligibleOn(habit, dateObj)) return { date: d, state: 'not_scheduled', value: null };
  if (!log) return { date: d, state: countBased ? 'not_scheduled' : 'miss', value: null };
  if (log.state === 'done') return { date: d, state: 'full', value: log.value };
  if (log.state === 'partial') return { date: d, state: 'partial', value: log.value };
  if (log.state === 'skip') return { date: d, state: 'skip', value: log.value };
  return { date: d, state: 'miss', value: log.value };
}

function trendLabel(direction: 'improving' | 'declining' | 'flat'): string {
  if (direction === 'improving') return 'Yükseliyor';
  if (direction === 'declining') return 'Düşüyor';
  return 'Sabit';
}
function trendIcon(direction: 'improving' | 'declining' | 'flat'): keyof typeof Ionicons.glyphMap {
  if (direction === 'improving') return 'trending-up-outline';
  if (direction === 'declining') return 'trending-down-outline';
  return 'remove-outline';
}

// ---------------------------------------------------------------------------
// small private presentational components -- screen-local, not new shared
// ui/ primitives (plan: reuse ui/, do not invent new ones)
// ---------------------------------------------------------------------------

function InfoRow({ icon, label, value, onEdit, editLabel, editIcon = 'create-outline' }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; value: string;
  /** KD-09 — when set, the row offers an edit button with this a11y label. */
  onEdit?: () => void; editLabel?: string;
  /** R01.05 — the button's glyph, when it is not an edit. */
  editIcon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={s.infoRow}>
      {/* süs ikonu — etiket/değer zaten okunuyor, ekran okuyucuda tekrar etmesin */}
      <Ionicons name={icon} size={15} color={colors.textFaint} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
      {onEdit && (
        <TouchableOpacity
          onPress={onEdit}
          style={s.infoEdit}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={editLabel ?? `${label} düzenle`}
        >
          <Ionicons name={editIcon} size={16} color={colors.accent} />
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * Renders one İÇGÖRÜ metric. On `{ ok: false }` it renders `result.reason`
 * -- never a substituted number -- which is the single choke point that
 * keeps every İÇGÖRÜ metric on this screen honest about insufficient data.
 */
function InsightRow<T>({ icon, label, result, formatOk }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  result: Result<T>;
  formatOk: (value: T) => string;
}) {
  return (
    <Card padding="md" style={s.insightCard}>
      <View style={s.insightHead}>
        <IconCircle icon={icon} color={colors.primary} size={34} radiusKey="sm" />
        <Text style={s.insightLabel}>{label}</Text>
      </View>
      {result.ok ? (
        <Text style={s.insightValue}>{formatOk(result.value)}</Text>
      ) : (
        <Text style={s.insightReason}>{result.reason}</Text>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// screen
// ---------------------------------------------------------------------------

export default function HabitDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { habits, fetchHabits, updateHabit, pauses, timeOffAvailable, addTimeOff, endTimeOff } = useHabitStore();
  const habit = habits.find((h) => h.id === id) ?? null;
  // R01.05 — this habit's current or upcoming break, and any holiday today.
  const [timeOffOpen, setTimeOffOpen] = useState(false);

  const [logs, setLogs] = useState<HabitDetailLogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [tab, setTab] = useState<TabKey>('genel');
  // KD-09 — the schedule draft while the editor is open; null = closed.
  const [freqDraft, setFreqDraft] = useState<FrequencyConfig | null>(null);
  const [savingFreq, setSavingFreq] = useState(false);
  const [rangeKey, setRangeKey] = useState<string>('30');

  const today = new Date();
  const todayYmd = ymd(today);
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  useEffect(() => {
    if (habits.length === 0) fetchHabits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sinceYmd: Ymd = habit?.created_at ? ymdFromIso(habit.created_at) : todayYmd;

  useEffect(() => {
    let cancelled = false;
    if (!habit) {
      setLoadingLogs(false);
      return;
    }
    setLoadingLogs(true);
    logsForHabit({ habitId: habit.id, start: sinceYmd, end: todayYmd }).then((res) => {
      if (cancelled) return;
      if (res.ok) setLogs(res.data);
      setLoadingLogs(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habit?.id, sinceYmd, todayYmd]);

  if (!habit) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        {loadingLogs ? (
          // Gelen ekranın iskeleti: başlık bloğu + sekme şeridi + 2x2 metrik ızgarası.
          // Ortalanmış bir spinner yerine gerçek yerleşimin şeklini göstermek,
          // içerik yerine oturduğunda layout'un zıplamasını önler.
          <View style={s.scroll}>
            <Skeleton width="62%" height={22} />
            <View style={{ marginTop: space.sm }}>
              <SkeletonLines count={2} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.lg }}>
              {TABS.map((t) => <Skeleton key={t.key} width={72} height={30} />)}
            </View>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
              <Skeleton width="48%" height={62} />
              <Skeleton width="48%" height={62} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
              <Skeleton width="48%" height={62} />
              <Skeleton width="48%" height={62} />
            </View>
          </View>
        ) : (
          <View style={s.center}>
            <EmptyState
              icon="alert-circle-outline"
              title="Alışkanlık bulunamadı"
              hint="Bu alışkanlık silinmiş olabilir ya da bağlantı geçersiz."
            />
          </View>
        )}
      </SafeAreaView>
    );
  }

  // From here on `habit` is narrowed to `Habit` (non-null) for the rest of the render.

  const logIndex = new Map<Ymd, HabitDetailLogRow>();
  for (const l of logs) logIndex.set(l.completed_at.slice(0, 10), l); // last wins, same tie-break as behaviorIntelligence.buildLogIndex

  const strengthLogs: StrengthLog[] = logs.map((l) => ({ completed_at: l.completed_at, state: l.state }));
  const createdDate = habit.created_at ? parseLocalDate(ymdFromIso(habit.created_at)) : null;
  const strength = habitStrength(strengthLogs, { asOf: today, since: createdDate ?? undefined });
  const curStreak = currentStreak(habit, logs, today);
  const bestStreak = longestStreak(habit, logs, { asOf: today });
  const overallCompletion: Result<number> = habitCompletionRate(habit, logs, { start: sinceYmd, end: todayYmd });

  const area = LIFE_AREAS.find((a) => a.key === habit.life_area) ?? null;

  const selectedRange = RANGE_OPTIONS.find((r) => r.key === rangeKey) ?? RANGE_OPTIONS[1];
  const rangeStart = rangeStartFor(selectedRange.days, sinceYmd, today);
  const rangeCompletion: Result<number> = habitCompletionRate(habit, logs, { start: rangeStart, end: todayYmd });
  const stripDays = daysInRangeCapped(rangeStart, todayYmd, MAX_STRIP_DAYS);
  const isNumeric = isMeasurableTracking(habit.tracking_type);

  const weekdayStats = weekdayBreakdown([habit], logs, { start: sinceYmd, end: todayYmd });
  const bestDay = bestWeekday(weekdayStats);
  const worstDay = worstWeekday(weekdayStats);
  const fragility = habitFragility(habit, logs);
  const trend4 = completionTrend([habit], logs, { weeks: 4, asOf: today });
  const trend12 = completionTrend([habit], logs, { weeks: 12, asOf: today });
  const stability = streakStability(habit, logs, { asOf: today });

  const dim = daysInMonth(calYear, calMonth);
  const firstDow = firstWeekdayOfMonth(calYear, calMonth);
  const calCells: (DayCell | null)[] = [];
  for (let i = 0; i < firstDow; i++) calCells.push(null);
  for (let day = 1; day <= dim; day++) {
    calCells.push(dayCellFor(habit, logIndex, new Date(calYear, calMonth, day), todayYmd));
  }

  function prevMonth() {
    haptic.select();
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); } else setCalMonth((m) => m - 1);
  }
  function nextMonth() {
    haptic.select();
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); } else setCalMonth((m) => m + 1);
  }

  /**
   * KD-09 — save an edited schedule. `frequencyEditPatch` decides whether the
   * willpower cost follows the new schedule (it does unless the user picked it
   * by hand). Nothing is written while the schedule has no target -- the same
   * gate the creation form's "Devam" uses.
   */
  async function handleSaveFreq() {
    if (!habit || !freqDraft || !isFrequencyComplete(freqDraft)) return;
    setSavingFreq(true);
    try {
      await updateHabit(habit.id, frequencyEditPatch(habit, freqDraft));
      haptic.success();
      setFreqDraft(null);
    } catch (e) {
      Alert.alert('Kaydedilemedi', e instanceof Error ? e.message : 'Sıklık güncellenemedi.');
    } finally {
      setSavingFreq(false);
    }
  }

  // R01.05 — the break that is on now or still ahead (a past one is history).
  const ownBreak = pauses.find(
    (p) => p.habit_id === habit.id && p.kind === 'pause' && (p.end_date === null || p.end_date >= todayYmd),
  ) ?? null;
  const holidayToday = activePauseOn({ pause_intervals: pauses.filter((p) => p.habit_id === null) }, today);

  function confirmEndBreak(pauseId: string) {
    Alert.alert('Arayı bitir', 'Bu alışkanlık bugünden itibaren yeniden takvimine döner.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Bitir',
        onPress: async () => {
          const res = await endTimeOff(pauseId);
          if (!res.ok) Alert.alert('Kaydedilemedi', res.error);
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header block -- plan §11: name + Strength/Current/Best/Completion, visible on every tab */}
        <View style={s.header}>
          <Text style={s.habitName} accessibilityRole="header">{habit.name}</Text>
          <Text style={s.headerMetrics}>
            Strength {strength} · Current {curStreak} gün · Best {bestStreak} gün · Completion{' '}
            {overallCompletion.ok ? `%${completionPercent(overallCompletion.value)}` : '—'}
          </Text>
          {!overallCompletion.ok && <Text style={s.headerReason}>{overallCompletion.reason}</Text>}
        </View>

        <View style={s.tabRow}>
          {TABS.map((t) => {
            const sel = tab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[s.tabBtn, sel && s.tabBtnSel]}
                onPress={() => { haptic.select(); setTab(t.key); }}
                accessibilityRole="tab"
                accessibilityState={{ selected: sel }}
              >
                <Ionicons name={t.icon} size={14} color={sel ? colors.primaryBright : colors.textFaint} />
                <Text style={[s.tabLabel, sel && s.tabLabelSel]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === 'genel' && (
          <View style={s.tabBody}>
            <View style={s.statGrid}>
              <StatTile label="STRENGTH" value={strength} accent={colors.primary} />
              <StatTile label="MEVCUT STREAK" value={`${curStreak} gün`} accent={colors.success} />
            </View>
            <View style={s.statGrid}>
              <StatTile label="EN İYİ STREAK" value={`${bestStreak} gün`} accent={colors.warning} />
              <StatTile
                label="TAMAMLAMA"
                value={overallCompletion.ok ? `%${completionPercent(overallCompletion.value)}` : '—'}
                accent={colors.info}
              />
            </View>
            {!overallCompletion.ok && <Text style={s.reasonHint}>{overallCompletion.reason}</Text>}

            <SectionHeader title="Alışkanlık Bilgisi" variant="title" style={{ marginTop: space.lg }} />
            <Card padding="md">
              <InfoRow
                icon="repeat-outline"
                label="Sıklık"
                value={frequencySummary(habit.frequency_config)}
                onEdit={() => { haptic.select(); setFreqDraft(habit.frequency_config); }}
                editLabel="Sıklığı düzenle"
              />
              {isNumeric && (
                <InfoRow
                  icon="flag-outline"
                  label="Hedef"
                  value={habit.daily_goal != null ? `${habit.daily_goal}${habit.unit ? ` ${habit.unit}` : ''}` : '—'}
                />
              )}
              <InfoRow
                icon="cafe-outline"
                label="Ara"
                value={ownBreak
                  ? `${ownBreak.start_date} → ${ownBreak.end_date ?? 'sen açana kadar'}`
                  : holidayToday ? 'Tatil modunda' : 'Yok'}
                onEdit={ownBreak ? () => confirmEndBreak(ownBreak.id) : () => setTimeOffOpen(true)}
                editLabel={ownBreak ? 'Arayı bitir' : 'Ara ver'}
                editIcon={ownBreak ? 'play-outline' : 'cafe-outline'}
              />
              <InfoRow icon="compass-outline" label="Yaşam Alanı" value={area ? area.label : '—'} />
              <InfoRow icon="flash-outline" label="İrade Maliyeti" value={String(habit.willpower_cost)} />
              {habit.end_condition && (
                <InfoRow icon="hourglass-outline" label="Bitiş Koşulu" value={endConditionLabel(habit.end_condition)} />
              )}
            </Card>
          </View>
        )}

        {tab === 'gecmis' && (
          <View style={s.tabBody}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rangeStripContent}>
              {RANGE_OPTIONS.map((r) => (
                <Chip
                  key={r.key}
                  label={r.label}
                  selected={rangeKey === r.key}
                  color={colors.primaryBright}
                  onPress={() => { haptic.select(); setRangeKey(r.key); }}
                />
              ))}
            </ScrollView>

            <Text style={s.rangeSummary}>
              {rangeCompletion.ok ? `%${completionPercent(rangeCompletion.value)} tamamlama` : rangeCompletion.reason}
            </Text>

            {loadingLogs ? (
              // A bar strip is arriving -- show its shape, not a spinner, so the
              // layout does not jump when the real bars replace this.
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: space.lg, height: 56 }}>
                {Array.from({ length: 24 }, (_, i) => (
                  <Skeleton key={i} width={6} height={12 + ((i * 7) % 40)} />
                ))}
              </View>
            ) : stripDays.length === 0 ? (
              <EmptyState icon="bar-chart-outline" title="Bu aralıkta veri yok" compact />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.historyStripContent}>
                {stripDays.map((d) => {
                  const dateObj = parseLocalDate(d);
                  if (!dateObj) return null;
                  const cell = dayCellFor(habit, logIndex, dateObj, todayYmd);
                  const ratio = isNumeric && cell.value != null && habit.daily_goal
                    ? Math.max(0, Math.min(1, cell.value / habit.daily_goal))
                    : cell.state === 'full' ? 1 : cell.state === 'partial' ? 0.5 : 0;
                  return (
                    <View key={d} style={s.historyCol}>
                      <View style={s.historyBarTrack}>
                        <View style={[s.historyBarFill, { height: `${Math.round(ratio * 100)}%`, backgroundColor: cellColor(cell.state) }]} />
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}

        {tab === 'takvim' && (
          <View style={s.tabBody}>
            <View style={s.calNav}>
              <TouchableOpacity
                onPress={prevMonth}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Önceki ay"
              >
                <Ionicons name="chevron-back" size={20} color={colors.textDim} />
              </TouchableOpacity>
              <Text style={s.calNavLabel}>{MONTHS_TR[calMonth]} {calYear}</Text>
              <TouchableOpacity
                onPress={nextMonth}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Sonraki ay"
              >
                <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>

            <View style={s.calDowRow}>
              {DOW_TR.map((d) => <Text key={d} style={s.calDow}>{d}</Text>)}
            </View>

            <View style={s.calGrid}>
              {calCells.map((cell, i) => (
                <View key={i} style={s.calCell}>
                  {cell && (
                    <>
                      <Text style={s.calDayNum}>{Number(cell.date.slice(8, 10))}</Text>
                      <View style={[s.calDot, { backgroundColor: cellColor(cell.state) }]} />
                    </>
                  )}
                </View>
              ))}
            </View>

            <View style={s.legendRow}>
              {(Object.keys(STATE_LABELS) as CalendarDayState[]).map((k) => (
                <View key={k} style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: CALENDAR_STATE_COLORS[k] }]} />
                  <Text style={s.legendLabel}>{STATE_LABELS[k]}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {tab === 'icgoru' && (
          <View style={s.tabBody}>
            <InsightRow
              icon="trending-up-outline"
              label="En başarılı gün"
              result={bestDay}
              formatOk={(v) => `${DOW_TR[v.weekday]} · %${Math.round(v.rate * 100)}`}
            />
            <InsightRow
              icon="trending-down-outline"
              label="En zayıf gün"
              result={worstDay}
              formatOk={(v) => `${DOW_TR[v.weekday]} · %${Math.round(v.rate * 100)}`}
            />
            <InsightRow
              icon="pulse-outline"
              label="Kırılganlık (son 8 hafta)"
              result={fragility}
              formatOk={(v) => `%${Math.round(v.volatility * 100)} oynaklık · ${v.weeksUsed} hafta veri`}
            />
            <InsightRow
              icon={trendIcon(trend4.ok ? trend4.value.direction : 'flat')}
              label="4 haftalık trend"
              result={trend4}
              formatOk={(v) => `${trendLabel(v.direction)} · ${v.magnitude >= 0 ? '+' : ''}${Math.round(v.magnitude * 100)} puan${v.partialWindow ? ` (${v.weeksUsed}/${v.weeksRequested} hafta)` : ''}`}
            />
            <InsightRow
              icon={trendIcon(trend12.ok ? trend12.value.direction : 'flat')}
              label="12 haftalık trend"
              result={trend12}
              formatOk={(v) => `${trendLabel(v.direction)} · ${v.magnitude >= 0 ? '+' : ''}${Math.round(v.magnitude * 100)} puan${v.partialWindow ? ` (${v.weeksUsed}/${v.weeksRequested} hafta)` : ''}`}
            />
            <InsightRow
              icon="git-compare-outline"
              label="Streak istikrarı"
              result={stability}
              formatOk={(v) => `%${Math.round(v * 100)} (mevcut / en iyi streak)`}
            />
          </View>
        )}
      </ScrollView>

      {/* KD-09 — sıklık düzenleme: oluşturma formuyla aynı kontroller */}
      <Modal visible={freqDraft !== null} transparent animationType="slide" onRequestClose={() => setFreqDraft(null)}>
        <View style={s.sheetOverlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Sıklığı düzenle</Text>
            {/* R01.05 — say which days the new goal judges. */}
            <Text style={s.versionNote}>
              {timeOffAvailable
                ? 'Yeni sıklık bugünden itibaren geçerli; geçmiş günler eski hedefle değerlendirilmeye devam eder.'
                : 'Not: sunucu güncellemesi beklendiği için geçmiş günler de yeni sıklıkla değerlendirilir.'}
            </Text>
            <ScrollView style={s.sheetBody} keyboardShouldPersistTaps="handled">
              {freqDraft && <FrequencyEditor value={freqDraft} onChange={setFreqDraft} />}
            </ScrollView>
            <View style={s.sheetActions}>
              <TouchableOpacity
                style={s.sheetCancel}
                onPress={() => setFreqDraft(null)}
                accessibilityRole="button"
                accessibilityLabel="Vazgeç"
              >
                <Text style={s.sheetCancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.sheetSave, (!freqDraft || !isFrequencyComplete(freqDraft) || savingFreq) && s.sheetSaveDisabled]}
                onPress={handleSaveFreq}
                disabled={!freqDraft || !isFrequencyComplete(freqDraft) || savingFreq}
                accessibilityRole="button"
                accessibilityLabel="Sıklığı kaydet"
                accessibilityState={{ disabled: !freqDraft || !isFrequencyComplete(freqDraft) || savingFreq }}
              >
                <Text style={s.sheetSaveText}>{savingFreq ? 'Kaydediliyor…' : 'Kaydet'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <TimeOffSheet
        visible={timeOffOpen}
        kind="pause"
        habitName={habit.name}
        today={todayYmd}
        available={timeOffAvailable === true}
        onClose={() => setTimeOffOpen(false)}
        onConfirm={async (draft) => {
          const res = await addTimeOff(habit.id, draft);
          if (res.ok) setTimeOffOpen(false);
          return res;
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  versionNote: { fontSize: 12, color: colors.textFaint, lineHeight: 17, marginBottom: space.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  scroll: { padding: space.lg, paddingBottom: space.xxl },

  header: { marginBottom: space.lg },
  habitName: { ...font.title, fontSize: 24, color: colors.text, marginBottom: space.xs },
  headerMetrics: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
  headerReason: { fontSize: 12, color: colors.textFaint, marginTop: 4, lineHeight: 17 },

  tabRow: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: 4, marginBottom: space.lg,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 9, borderRadius: radius.sm,
  },
  tabBtnSel: { backgroundColor: hexA(colors.primary, 0.14) },
  tabLabel: { ...font.overline, fontSize: 10, color: colors.textFaint },
  tabLabelSel: { color: colors.primaryBright },

  tabBody: { gap: space.md },

  statGrid: { flexDirection: 'row', gap: space.md },
  reasonHint: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },

  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  infoLabel: { fontSize: 13, color: colors.textFaint, flex: 1 },
  infoValue: { fontSize: 13, color: colors.text, fontWeight: '600', maxWidth: '55%' },
  infoEdit: { marginLeft: space.sm, padding: 2 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: space.lg, maxHeight: '85%',
  },
  sheetTitle: { ...font.title, fontSize: 18, color: colors.text, marginBottom: space.md },
  sheetBody: { flexGrow: 0 },
  sheetActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  sheetCancel: {
    flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  sheetCancelText: { color: colors.textDim, fontWeight: '600' },
  sheetSave: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.accent },
  sheetSaveDisabled: { opacity: 0.4 },
  sheetSaveText: { color: colors.white, fontWeight: '700' },

  rangeStripContent: { gap: space.sm, paddingBottom: space.xs },
  rangeSummary: { fontSize: 13, color: colors.textDim, marginTop: space.sm, marginBottom: space.sm, lineHeight: 18 },

  historyStripContent: { alignItems: 'flex-end', gap: 3, paddingVertical: space.sm },
  historyCol: { alignItems: 'center' },
  historyBarTrack: {
    width: 6, height: 64, borderRadius: 3, backgroundColor: hexA(colors.white, 0.06),
    justifyContent: 'flex-end', overflow: 'hidden',
  },
  historyBarFill: { width: '100%', borderRadius: 3, minHeight: 2 },

  calNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  calNavLabel: { ...font.h3, color: colors.text },
  calDowRow: { flexDirection: 'row' },
  calDow: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.textFaint, fontWeight: '700', marginBottom: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calDayNum: { fontSize: 12, color: colors.textDim, marginBottom: 3 },
  calDot: { width: 8, height: 8, borderRadius: 4 },

  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, color: colors.textFaint },

  insightCard: { gap: 4 },
  insightHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  insightLabel: { fontSize: 13, color: colors.textDim, fontWeight: '600', flex: 1 },
  insightValue: { fontSize: 15, color: colors.text, fontWeight: '700' },
  insightReason: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
});
