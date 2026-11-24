import { useEffect, useState, useCallback, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { notify } from '../../lib/dialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, subDays, addDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { currentUser } from '../../lib/session';
import type { Habit, RecoveryStrategy } from '../../lib/supabase';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { deficitFor, type TrackingTypeV2 } from '../../lib/recovery';
// R03.05 — what moving the make-up does to that day's load.
import { makeupLoadPreview, LOAD_BANDS, type LoadBandKey } from '../../lib/capacity';
import { BACKLOG_PAGE_SIZE, capBacklog, recoveryBacklog, consecutiveMissedDue as consecutiveMissedDueOf } from '../../lib/recoveryBacklog';
import { currentStreak } from '../../lib/behaviorIntelligence';
import {
  BACKLOG_BADGE_PARTIAL,
  BACKLOG_BADGE_PENDING,
  RETURN_NUDGE_TITLE,
  backlogMoreLabel,
  returnNudgeMany,
  returnNudgeOne,
} from '../../lib/metricCopy';
import { space, radius, font, hexA, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { haptic } from '../../lib/haptics';
import { Image } from 'expo-image';
import { Card, SectionHeader, EmptyState, IconCircle, Badge, Button, Chip, Skeleton, FormError, EditorialBanner } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { GoldMendShimmer } from '../../components/motion';
import { BENTO_ART, CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import { todayLocal, type Ymd } from '../../lib/date';
import { newOperationId } from '../../lib/outbox';
import {
  applyPreviewItemOverride,
  buildDayPlanPreview,
  evaluatePreviewFreshness,
  formatMinutesToHm,
  parseHmToMinutes,
  previewItemKey,
  resolveEffectivePlanningDay,
  type DayPlanAction,
  type DayPlanEntityKind,
  type DayPlanPreview,
  type DayPlanPreviewInput,
  type FixedPlanBlock,
  type ProtectedRef,
} from '../../lib/dayPlanPreview';
import type { Task } from '../../lib/taskTypes';
import {
  commitDayPlan,
  retryFailedDayPlanItems,
  undoDayPlanCommit,
  type DayPlanCommitReceipt,
  type DayPlanCommitResult,
  type PlanMutationItem,
} from '../../services/dayPlanCommitService';
import { logsForHabitsSince as fetchHabitLogsForHabitsSince } from '../../services/habitService';
import { completePlanWithMakeup, makeupNeedsValue, makeupSuggestedValue } from '../../services/recoveryService';
// KD-12 — a measurable make-up asks for the amount instead of inventing one;
// the state then comes from the value, exactly as the timeline does (R01.03-a).
import { measuredEntryFor } from '../../services/habitLogService';
import MeasurableInputModal from '../../components/MeasurableInputModal';
import { useTimeCapsules } from '../../hooks/useTimeCapsules';
import TimeCapsuleCard from '../../components/recovery/TimeCapsuleCard';

// Telafi gününü hesaplayan hızlı seçenekler (date-picker dep yok)
function nextSaturdayOffset(): number {
  const dow = new Date().getDay(); // 0=Paz..6=Cmt
  const diff = (6 - dow + 7) % 7;
  return diff === 0 ? 7 : diff; // bugün cumartesiyse gelecek cumartesi
}
const WHEN_OPTIONS: { key: string; label: string; offset: () => number }[] = [
  { key: 'today', label: 'Bugün', offset: () => 0 },
  { key: 'tomorrow', label: 'Yarın', offset: () => 1 },
  { key: 'weekend', label: 'Hafta sonu', offset: nextSaturdayOffset },
];

type StreakMap = Record<string, number>;

// v2 sozlugu. Eski dort secenek ('full'|'half'|'mini'|'reschedule') ile
// bire bir ayni sey DEGIL: 'mini' ("2 dk minimum") v2'de karsiligi olmayan
// bir kavramdi ve adaptor onu 'skip'e -- yani "telafi etme"ye -- esliyordu.
// Artik dort secenek de kalici sozlukte adlandirildigi gibi.
const STRATEGY_ART: Record<RecoveryStrategy, (typeof BENTO_ART)[keyof typeof BENTO_ART]> = {
  complete_today: BENTO_ART.recoveryToday,
  push_tomorrow: BENTO_ART.recoveryTomorrow,
  split_two_days: BENTO_ART.recoverySplit,
  skip: BENTO_ART.recoveryRelease,
};
type IoniconName = keyof typeof Ionicons.glyphMap;

function toIoniconName(icon: string | null | undefined, fallback: IoniconName = 'star-outline'): IoniconName {
  return icon && Ionicons.glyphMap && Object.prototype.hasOwnProperty.call(Ionicons.glyphMap, icon)
    ? (icon as IoniconName)
    : fallback;
}

const getStrategyMeta = (
  colors: Palette,
): Record<RecoveryStrategy, { label: string; desc: string; icon: IoniconName; color: string }> => ({
  complete_today: { label: 'Bugün Tamamla', desc: 'Tamamını bugün yap', icon: 'refresh', color: colors.success },
  push_tomorrow: { label: 'Yarına Aktar', desc: 'İleri bir güne taşı', icon: 'calendar-outline', color: colors.primaryBright },
  split_two_days: { label: 'İkiye Böl', desc: 'İki güne dağıt', icon: 'contrast-outline', color: colors.warning },
  skip: { label: 'Telafi Etme', desc: 'Bu sefer geç, yarına odaklan', icon: 'flash-outline', color: colors.info },
});

type ReplanStep = 'closed' | 'protect' | 'preview' | 'apply';

function splitFixedBlockTasks(
  allTasks: readonly Task[],
  dayKey: Ymd,
): { fixedBlocks: FixedPlanBlock[]; movableTasks: Task[] } {
  const fixedBlocks: FixedPlanBlock[] = [];
  const movableTasks: Task[] = [];
  for (const task of allTasks) {
    if (!task.completed && task.status !== 'cancelled' && task.due_date === dayKey) {
      const startMin = parseHmToMinutes(task.time_block_start);
      if (startMin !== null) {
        const rawEnd = parseHmToMinutes(task.time_block_end);
        const fallbackEnd = Math.min(1439, startMin + Math.max(15, task.estimated_minutes ?? 30));
        const endMin = rawEnd !== null && rawEnd > startMin ? rawEnd : fallbackEnd;
        if (endMin > startMin) {
          fixedBlocks.push({
            id: task.id,
            user_id: task.user_id,
            title: task.title,
            local_day: dayKey,
            start_time: formatMinutesToHm(startMin),
            end_time: formatMinutesToHm(endMin),
            locked: true,
            source: 'internal_fixed',
          });
          continue;
        }
      }
    }
    movableTasks.push(task);
  }
  return { fixedBlocks, movableTasks };
}

function replanActionLabel(action: DayPlanAction): string {
  switch (action) {
    case 'keep':
      return 'Bugünde tut';
    case 'shrink':
      return '5 dk ilk adıma küçült';
    case 'postpone_tomorrow':
      return 'Yarına taşı';
    case 'release_someday':
      return 'Bir Gün listesine bırak';
    case 'skip_today':
      return 'Bugünlük atla';
    case 'do_not_recover':
      return 'Telafi etme';
  }
}

function buildMutationsFromPreview(preview: DayPlanPreview): PlanMutationItem[] {
  const items: PlanMutationItem[] = [];
  for (const ch of preview.changes) {
    if (ch.action === 'keep') continue;
    if (ch.sourceRef.entity === 'task') {
      if (ch.action === 'postpone_tomorrow') {
        items.push({
          itemId: previewItemKey('task', ch.sourceRef.id),
          entity: 'task',
          targetId: ch.sourceRef.id,
          title: ch.sourceRef.title,
          expectedVersion: ch.expectedVersion,
          action: 'postpone_tomorrow',
          taskPatch: {
            due_date: preview.tomorrowDayKey,
            time_block_start: null,
            time_block_end: null,
          },
        });
      } else if (ch.action === 'release_someday') {
        items.push({
          itemId: previewItemKey('task', ch.sourceRef.id),
          entity: 'task',
          targetId: ch.sourceRef.id,
          title: ch.sourceRef.title,
          expectedVersion: ch.expectedVersion,
          action: 'release_someday',
          taskPatch: {
            list_type: 'someday',
            due_date: null,
            time_block_start: null,
            time_block_end: null,
          },
        });
      } else if (ch.action === 'shrink') {
        items.push({
          itemId: previewItemKey('task', ch.sourceRef.id),
          entity: 'task',
          targetId: ch.sourceRef.id,
          title: ch.sourceRef.title,
          expectedVersion: ch.expectedVersion,
          action: 'update_time_block',
          taskPatch: {
            due_date: preview.localDayKey,
            time_block_start: null,
            time_block_end: null,
          },
        });
      }
      continue;
    }

    if (ch.sourceRef.entity === 'habit') {
      const hasPartialProgress =
        ch.before.habitState === 'partial' ||
        (ch.before.loggedValue !== null && ch.before.loggedValue > 0);
      // P04: Prior partial progress is preserved intact without inventing or clobbering amounts.
      if (hasPartialProgress) continue;
      if (ch.action === 'skip_today' || ch.action === 'do_not_recover') {
        items.push({
          itemId: previewItemKey('habit', ch.sourceRef.id),
          entity: 'habit',
          targetId: ch.sourceRef.id,
          title: ch.sourceRef.title,
          expectedVersion: ch.before.habitState,
          action: ch.action === 'do_not_recover' ? 'do_not_recover' : 'skip_today',
          priorHabitLogState: ch.before.habitState,
        });
      }
      continue;
    }

    if (
      ch.sourceRef.entity === 'recovery_plan' &&
      (ch.action === 'do_not_recover' || ch.action === 'postpone_tomorrow')
    ) {
      items.push({
        itemId: previewItemKey('recovery_plan', ch.sourceRef.id),
        entity: 'recovery_plan',
        targetId: ch.sourceRef.id,
        title: ch.sourceRef.title,
        expectedVersion: ch.expectedVersion,
        action: ch.action === 'postpone_tomorrow' ? 'postpone_tomorrow' : 'do_not_recover',
      });
    }
  }
  return items;
}

export default function RecoveryScreen() {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const STRATEGY_META = getStrategyMeta(colors);
  const { tasks, fetchTasks, toggleDone, moveToList } = useTaskStore(
    useShallow((st) => ({ tasks: st.tasks, fetchTasks: st.fetchTasks, toggleDone: st.toggleDone, moveToList: st.moveToList })),
  );
  const habits = useHabitStore((st) => st.habits);
  const fetchHabits = useHabitStore((st) => st.fetchHabits);
  const fetchLogsForDate = useLogStore((st) => st.fetchLogsForDate);
  const logHabit = useLogStore((st) => st.logHabit);
  const storeLogs = useLogStore((st) => st.logs);
  const todayLogs = storeLogs ?? [];
  const { plans, fetchPlans, addPlan, skipPlan, deletePlan, planForHabit, recoveryOptionsFor } = useRecoveryStore(useShallow((st) => ({ plans: st.plans, fetchPlans: st.fetchPlans, addPlan: st.addPlan, skipPlan: st.skipPlan, deletePlan: st.deletePlan, planForHabit: st.planForHabit, recoveryOptionsFor: st.recoveryOptionsFor })));
  const caps = useTimeCapsules();
  const [capsuleLater, setCapsuleLater] = useState(false);
  const eligibleCapsuleItem = caps.eligible;
  const [sessionUserId, setSessionUserId] = useState('local-user');
  const [replanStep, setReplanStep] = useState<ReplanStep>('closed');
  const [replanDayKey, setReplanDayKey] = useState<Ymd | null>(null);
  const [replanProtectedRef, setReplanProtectedRef] = useState<ProtectedRef | null>(null);
  const [replanPreviewState, setReplanPreviewState] = useState<{
    input: DayPlanPreviewInput;
    preview: DayPlanPreview;
  } | null>(null);
  const [replanOperationId, setReplanOperationId] = useState<string | null>(null);
  const [replanStaleMessage, setReplanStaleMessage] = useState<string | null>(null);
  const [replanCommitting, setReplanCommitting] = useState(false);
  const [replanRetrying, setReplanRetrying] = useState(false);
  const [replanUndoing, setReplanUndoing] = useState(false);
  const [replanMutations, setReplanMutations] = useState<PlanMutationItem[]>([]);
  const [replanCommitResult, setReplanCommitResult] = useState<DayPlanCommitResult | null>(null);
  const [replanReceipt, setReplanReceipt] = useState<DayPlanCommitReceipt | null>(null);
  const [replanUndoFeedback, setReplanUndoFeedback] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [streaks, setStreaks] = useState<StreakMap>({});
  // Geçmiş günlerde tamamlanmış/kısmi/atlanan günler — "habitId|yyyy-mm-dd" anahtarlı
  const [doneSet, setDoneSet] = useState<Set<string>>(new Set());
  const [partialSet, setPartialSet] = useState<Set<string>>(new Set());
  /** Days the user explicitly logged as missed — distinct from never logged. */
  const [missedSet, setMissedSet] = useState<Set<string>>(new Set());
  const [skippedSet, setSkippedSet] = useState<Set<string>>(new Set());
  const [backlogVisible, setBacklogVisible] = useState(BACKLOG_PAGE_SIZE);
  // Kısmi günün GERÇEK değeri — "habitId|yyyy-mm-dd" -> value. Plan §9'un
  // başlığı (10.000 hedef / 8.000 fiili -> 2.000 eksik) bu olmadan çalışmaz.
  const [valueMap, setValueMap] = useState<Record<string, number>>({});
  const [loggingId, setLoggingId] = useState<string | null>(null);

  // KD-12 — the amount prompt for a measurable make-up. `planId` null means the
  // retroactive "yaptım" on a backlog day; otherwise a recovery plan is being
  // closed and the service writes the log and the plan together.
  const [makeupTarget, setMakeupTarget] = useState<
    { habit: Habit; date: string; planId: string | null; prior: number; suggested: number | null } | null
  >(null);

  // Planlama sheet'i
  const [planTarget, setPlanTarget] = useState<Habit | null>(null);
  const [planSource, setPlanSource] = useState<string>('');
  const [whenOffset, setWhenOffset] = useState(0);
  const [strategy, setStrategy] = useState<RecoveryStrategy>('complete_today');
  const [note, setNote] = useState('');
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderTime, setReminderTime] = useState('20:00');
  const [saving, setSaving] = useState(false);
  // R06.03 — a plan that could not be saved keeps the sheet and what was chosen.
  const [planError, setPlanError] = useState<string | null>(null);

  const today = todayLocal();

  const overdueTasks = tasks.filter(
    (t) => t.due_date && t.due_date < today && !t.completed && t.status !== 'cancelled'
  );
  const activeHabits = habits.filter((h) => h.status === 'active');
  const habitById = (id: string) => habits.find((h) => h.id === id);

  const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  // Geçmiş günlerde (BUGÜN HARİÇ) frekansa göre "due" olup tamamlanmamış günler = backlog.
  // R01.07 — the walk lives in lib/recoveryBacklog (pure, clock injected) so the
  // same date fixtures pin it as pin Today, reports, capacity and reminders.
  const plannedKeys = new Set(plans.map((p) => `${p.habit_id}|${p.source_date}`));
  const backlogNow = new Date();
  const backlogEntries = recoveryBacklog({ habits: activeHabits, today: backlogNow, doneSet, partialSet, missedSet, skippedSet, plannedKeys });
  const { shown: shownBacklog, hidden: hiddenBacklog } = capBacklog(backlogEntries, backlogVisible);
  const consecutiveMissedDue = (h: Habit) => consecutiveMissedDueOf(h, { today: backlogNow, doneSet, partialSet, skippedSet });

  // Telafi günü (gelecek/bugün) insan etiketi
  function targetLabel(date: string): string {
    if (date === today) return 'Bugün';
    if (date === format(addDays(new Date(), 1), 'yyyy-MM-dd')) return 'Yarın';
    const [y, mo, d] = date.split('-').map(Number);
    return format(new Date(y, mo - 1, d), 'd MMM EEE', { locale: tr });
  }
  // Geçmiş gün insan etiketi
  function pastLabel(date: string): string {
    if (date === yesterdayStr) return 'Dün';
    const diff = Math.round((Date.parse(today) - Date.parse(date)) / 86400000);
    return `${diff} gün önce`;
  }

  // KD-12 — the day the amount prompt is writing to. "5 Ağustos", used as
  // "5 Ağustos gününe": the explicit `gününe` avoids the Turkish dative
  // suffix having to agree with the month's vowels, which "Ağustos'a" /
  // "Eylül'e" would.
  function makeupDayText(date: string): string {
    const [y, mo, d] = date.split('-').map(Number);
    return format(new Date(y, mo - 1, d), 'd MMMM', { locale: tr });
  }

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const computeStreaks = useCallback(async (habitList: Habit[]) => {
    if (habitList.length === 0) return;
    const habitIds = habitList.map((h) => h.id);
    const since = format(subDays(new Date(), 60), 'yyyy-MM-dd');
    const user = await currentUser();
    if (!user || !mountedRef.current) return;
    const res = await fetchHabitLogsForHabitsSince({ habitIds, since });
    if (!res.ok || !mountedRef.current) return;
    const data = res.data;
    const now = new Date();
    const map: StreakMap = {};
    for (const h of habitList) {
      map[h.id] = currentStreak(h, data.filter((l) => l.habit_id === h.id), now);
    }
    setStreaks(map);

    // Geçmiş gün set'leri — bekleyen/kısmi/atlanan tespiti backlog için bunları kullanır
    const done = new Set<string>();
    const partial = new Set<string>();
    const missed = new Set<string>();
    const skipped = new Set<string>();
    const vals: Record<string, number> = {};
    for (const l of data) {
      const k = `${l.habit_id}|${l.completed_at}`;
      // Split by STATE. Explicitly skipped (`skip`) days are tracked separately
      // (DOM-08) so recoveryBacklog excludes them and consecutiveMissedDue bridges them.
      if (l.state === 'partial') partial.add(k);
      else if (l.state === 'miss') missed.add(k);
      else if (l.state === 'done') done.add(k);
      else if (l.state === 'skip') skipped.add(k);
      if (typeof l.value === 'number') vals[k] = l.value;
    }
    setDoneSet(done);
    setPartialSet(partial);
    setMissedSet(missed);
    setSkippedSet(skipped);
    setValueMap(vals);
  }, []);

  useEffect(() => {
    void Promise.all([fetchTasks(), fetchHabits(), fetchLogsForDate(today), fetchPlans()]).finally(() => {
      if (mountedRef.current) setLoading(false);
    });
  }, [today, fetchTasks, fetchHabits, fetchLogsForDate, fetchPlans]);

  useEffect(() => {
    const active = habits.filter((h) => h.status === 'active');
    if (active.length > 0) computeStreaks(active);
  }, [habits, computeStreaks]);

  async function onRefresh() {
    haptic.light();
    setRefreshing(true);
    await Promise.all([fetchTasks(), fetchHabits(), fetchLogsForDate(today), fetchPlans()]);
    setRefreshing(false);
  }

  async function refreshSets() {
    await computeStreaks(activeHabits);
  }

  // Geçmiş bir günü retroaktif "yaptım" olarak işaretle
  //
  // KD-12 — for a measurable habit this used to write `done` with NO value,
  // which `completionRatio` reads as 0%: the user caught the day up and their
  // completion rate counted it as nothing. The amount is asked for now; the
  // state is derived from it, so the row cannot contradict itself.
  async function handleLogNow(habitId: string, date: string) {
    const habit = habitById(habitId);
    if (makeupNeedsValue(habit)) {
      haptic.select();
      setMakeupTarget({
        habit: habit!,
        date,
        planId: null,
        prior: valueMap[`${habitId}|${date}`] ?? 0,
        suggested: habit!.daily_goal ?? null,
      });
      return;
    }
    haptic.success();
    setLoggingId(`${habitId}|${date}`);
    const [y, mo, d] = date.split('-').map(Number);
    const res = await logHabit({ habitId, date: new Date(y, mo - 1, d), state: 'done' });
    if (!res.ok) {
      void notify('Kaydedilemedi', res.error);
      setLoggingId(null);
      return;
    }
    await refreshSets();
    setLoggingId(null);
  }

  function openPlan(h: Habit, sourceDate: string) {
    haptic.select();
    setPlanTarget(h);
    setPlanError(null);
    setPlanSource(sourceDate);
    setWhenOffset(0);
    setStrategy('complete_today');
    setNote('');
    setReminderOn(false);
    setReminderTime('20:00');
  }

  const targetDate = format(addDays(new Date(), whenOffset), 'yyyy-MM-dd');

  // W3 (task Phase-1 CODER-F, Plan §9) — planlama sheet'inin hedef alışkanlığı
  // için GERÇEK açık. Yalnızca GÖSTERİM amaçlı: `addPlan` hâlâ yalnızca
  // bugünün gerçek `recovery_plans` sütunlarını yazıyor (bkz. addPlan/
  // recoveryOptionsFor'un store'daki belgeleri) -- açık burada asla
  // kalıcılaştırılmıyor.
  //
  // `value` artık GERÇEK okunuyor: `fetchHabitLogsForHabitsSince` `value`
  // sütununu da seçiyor, bu yüzden ölçülebilir bir alışkanlıkta 'kısmi' bir
  // gün için planın §9 başlığı doğru çalışıyor: 10.000 hedef / 8.000 fiili
  // -> 2.000 eksik. Değer yoksa (binary alışkanlık, ya da kayıtta `value`
  // null) `null` geçilir ve `deficitFor` kendi belgelenmiş muhafazakâr
  // davranışına düşer -- hedefin tamamını açık sayar, ASLA olduğundan az
  // göstermez.
  // `TrackingTypeV2` artık `Habit['tracking_type']` ile birebir aynı; eskiden
  // buradaki üçlü koşul 'numeric' dışındaki HER ŞEYİ 'boolean'a düşürüyordu,
  // yani süreli bir alışkanlığın eksiği "20 dakika kaldı" yerine "tamamen
  // kaçırıldı" diye hesaplanıyordu. Eşleme kimlik olduğu için kaldırıldı.
  const planTrackingType: TrackingTypeV2 = planTarget?.tracking_type ?? 'boolean';
  const planLogKey = planTarget ? `${planTarget.id}|${planSource}` : '';
  const planState: 'done' | 'partial' | 'miss' =
    doneSet.has(planLogKey) ? 'done' : partialSet.has(planLogKey) ? 'partial' : 'miss';
  const planLoggedValue: number | null =
    planLogKey && Object.prototype.hasOwnProperty.call(valueMap, planLogKey) ? valueMap[planLogKey] : null;
  const planDirection = planTarget?.target_direction ?? null;
  const planDeficit = planTarget
    ? deficitFor({ trackingType: planTrackingType, target: planTarget.daily_goal, value: planLoggedValue, state: planState, direction: planDirection })
    : null;
  const planOptions = planTarget
    ? recoveryOptionsFor({
        trackingType: planTrackingType,
        target: planTarget.daily_goal,
        value: planLoggedValue,
        state: planState,
        direction: planDirection,
        fromDate: planSource || today,
      })
    : [];

  // R03.05 — the target day's load before and after this make-up. A preview
  // that informs the choice; it never blocks a plan.
  const makeupShare = strategy === 'skip' ? 0 : strategy === 'split_two_days' ? 0.5 : 1;
  const loadPreview = planTarget && makeupShare > 0
    ? makeupLoadPreview({
        day: addDays(new Date(), whenOffset),
        activeHabits,
        incoming: planTarget,
        share: makeupShare,
        tasksDue: tasks.filter((t) => t.due_date === targetDate && t.status !== 'cancelled').map(() => ({})),
        plannedMakeups: plans
          .filter((pl) => pl.status === 'planned' && pl.target_date === targetDate)
          .flatMap((pl) => {
            const h = habitById(pl.habit_id);
            return h ? [{ habit: h, share: pl.strategy === 'split_two_days' ? 0.5 : 1 }] : [];
          }),
      })
    : null;
  const bandLabel = (k: LoadBandKey) => LOAD_BANDS.find((b) => b.key === k)?.label ?? k;

  async function submitPlan() {
    if (!planTarget) return;
    setSaving(true);
    setPlanError(null);
    const created = await addPlan({
      habitId: planTarget.id,
      habitName: planTarget.name,
      sourceDate: planSource,
      targetDate,
      strategy,
      note: note.trim() || null,
      reminderTime: reminderOn ? reminderTime.trim() : null,
    });
    setSaving(false);
    if (!created) { setPlanError('Plan kaydedilemedi. Seçimlerin duruyor; tekrar deneyebilirsin.'); return; }
    haptic.success();
    setPlanTarget(null);
  }

  async function handleCompletePlan(plan: typeof plans[number]) {
    const planHabit = habitById(plan.habit_id);
    if (makeupNeedsValue(planHabit)) {
      // KD-12 — same rule as the backlog "yaptım": ask, never invent. The
      // suggestion is sized by the strategy (`split_two_days` -> half), and the
      // user can overwrite it.
      haptic.select();
      setMakeupTarget({
        habit: planHabit!,
        date: plan.target_date,
        planId: plan.id,
        prior: valueMap[`${plan.habit_id}|${plan.target_date}`] ?? 0,
        suggested: makeupSuggestedValue(plan, planHabit),
      });
      return;
    }
    haptic.success();
    // What a make-up logs (done vs partial, and the reduced value) and the
    // rule that the LOG is written before the plan is closed both live in
    // `services/recoveryService.completePlanWithMakeup`. Closing the plan
    // without a log leaves the two permanently contradicting each other
    // (finding N-04), so the ordering is a domain rule, not screen code.
    const res = await completePlanWithMakeup({
      plan,
      habit: habitById(plan.habit_id),
      writeLog: (input) => logHabit(input),
    });
    if (!res.ok) {
      void notify('Kaydedilemedi', res.error);
      return;
    }
    await refreshSets();
    if (plan.target_date === today) await fetchLogsForDate(today);
  }

  /**
   * KD-12 — the amount the user entered for a measurable make-up.
   *
   * The entry is an ADDITION to whatever that day already holds, and the state
   * is derived from the resulting total (`measuredEntryFor` -> `stateForValue`),
   * never chosen here. A plan goes through `completePlanWithMakeup` so the log
   * and the plan are still written in that order; a backlog day writes directly.
   * A failure leaves the modal open so the entry is not lost.
   */
  async function handleMakeupConfirm(entered: number) {
    if (!makeupTarget) return;
    const { habit, date, planId, prior } = makeupTarget;
    haptic.success();

    if (planId) {
      const plan = plans.find((pl) => pl.id === planId);
      if (!plan) { setMakeupTarget(null); return; }
      const res = await completePlanWithMakeup({
        plan,
        habit,
        writeLog: (input) => logHabit(input),
        enteredValue: entered,
        priorDayValue: prior,
      });
      if (!res.ok) { void notify('Kaydedilemedi', res.error); return; }
      await refreshSets();
      if (plan.target_date === today) await fetchLogsForDate(today);
      setMakeupTarget(null);
      return;
    }

    setLoggingId(`${habit.id}|${date}`);
    const [y, mo, d] = date.split('-').map(Number);
    const intent = measuredEntryFor(habit, prior, entered);
    const res = await logHabit({
      habitId: habit.id,
      date: new Date(y, mo - 1, d),
      state: intent.state,
      value: intent.value,
      targetValue: intent.targetValue,
      targetDirection: intent.targetDirection,
    });
    if (!res.ok) { void notify('Kaydedilemedi', res.error); setLoggingId(null); return; }
    await refreshSets();
    if (date === today) await fetchLogsForDate(today);
    setLoggingId(null);
    setMakeupTarget(null);
  }

  function buildFreshPreviewSnapshot(
    protectedSelection: ProtectedRef | null,
    overrides: Record<string, DayPlanAction>,
    uid: string,
  ): { input: DayPlanPreviewInput; preview: DayPlanPreview; dayKey: Ymd } {
    const now = new Date();
    const eff = resolveEffectivePlanningDay(now);
    const liveTasks = useTaskStore.getState().tasks;
    const liveHabits = useHabitStore.getState().habits;
    const liveLogs = useLogStore.getState().logs ?? [];
    const livePlans = useRecoveryStore.getState().plans;
    const { fixedBlocks, movableTasks } = splitFixedBlockTasks(liveTasks, eff.effectiveDayKey);
    const input: DayPlanPreviewInput = {
      userId: uid,
      localDayKey: eff.effectiveDayKey,
      nowLocalMinutes: eff.nowLocalMinutes,
      generatedAtIso: now.toISOString(),
      protectedRef: protectedSelection,
      fixedBlocks,
      tasks: movableTasks,
      habits: liveHabits,
      todayLogs: liveLogs,
      recoveryPlans: livePlans,
      itemOverrides: overrides,
    };
    return {
      input,
      preview: buildDayPlanPreview(input),
      dayKey: eff.effectiveDayKey,
    };
  }

  function openReplanFlow() {
    haptic.select();
    const eff = resolveEffectivePlanningDay(new Date());
    setReplanDayKey(eff.effectiveDayKey);
    setReplanProtectedRef(null);
    setReplanPreviewState(null);
    setReplanOperationId(null);
    setReplanStaleMessage(null);
    setReplanCommitResult(null);
    setReplanUndoFeedback(null);
    setReplanStep('protect');
    void currentUser().then((u) => {
      if (mountedRef.current && u?.id) setSessionUserId(u.id);
    });
  }

  function closeReplanFlow() {
    haptic.light();
    setReplanStep('closed');
    setReplanStaleMessage(null);
    setReplanOperationId(null);
  }

  function proceedToReplanPreview() {
    haptic.select();
    const snap = buildFreshPreviewSnapshot(replanProtectedRef, {}, sessionUserId);
    setReplanDayKey(snap.dayKey);
    setReplanPreviewState({ input: snap.input, preview: snap.preview });
    setReplanOperationId(null);
    setReplanStaleMessage(null);
    setReplanStep('preview');
  }

  function refreshReplanPreview() {
    haptic.select();
    const existingOverrides = { ...(replanPreviewState?.input.itemOverrides ?? {}) };
    const snap = buildFreshPreviewSnapshot(replanProtectedRef, existingOverrides, sessionUserId);
    setReplanDayKey(snap.dayKey);
    setReplanPreviewState({ input: snap.input, preview: snap.preview });
    setReplanOperationId(null);
    setReplanStaleMessage(null);
  }

  function handleReplanOverride(
    previewInput: DayPlanPreviewInput,
    entity: DayPlanEntityKind,
    id: string,
    action: DayPlanAction,
  ) {
    haptic.select();
    const key = previewItemKey(entity, id);
    const updatedPreview = applyPreviewItemOverride(previewInput, key, action);
    const nextOverrides: Record<string, DayPlanAction> = {
      ...(previewInput.itemOverrides ?? {}),
      [key]: action,
    };
    setReplanPreviewState({
      input: { ...previewInput, itemOverrides: nextOverrides },
      preview: updatedPreview,
    });
    setReplanOperationId(null);
    setReplanStaleMessage(null);
  }

  async function handleApplyReplan(previewToCommit: DayPlanPreview) {
    const now = new Date();
    const effNow = resolveEffectivePlanningDay(now);
    const liveMovableTasks = splitFixedBlockTasks(
      useTaskStore.getState().tasks,
      effNow.effectiveDayKey,
    ).movableTasks;
    const freshness = evaluatePreviewFreshness(previewToCommit, {
      nowIso: now.toISOString(),
      currentLocalDayKey: effNow.effectiveDayKey,
      tasks: liveMovableTasks,
      habits: useHabitStore.getState().habits,
      todayLogs: useLogStore.getState().logs ?? [],
      recoveryPlans: useRecoveryStore.getState().plans,
    });

    if (!freshness.fresh) {
      const reasonMsg =
        freshness.reason === 'day_changed'
          ? 'Planlama günü değişti. Güncel günü yenileyip tekrar onayla.'
          : freshness.reason === 'expired'
            ? 'Önizleme süresi doldu. Güncel durumu yenileyip tekrar onayla.'
            : 'Bazı öğeler bu sırada değişti. Önizlemeyi yenileyip kontrol et.';
      setReplanStaleMessage(reasonMsg);
      return;
    }

    const opId = replanOperationId ?? newOperationId();
    if (!replanOperationId) {
      setReplanOperationId(opId);
    }
    const mutationItems = buildMutationsFromPreview(previewToCommit);

    setReplanCommitting(true);
    setReplanStaleMessage(null);
    try {
      const result = await commitDayPlan({
        operationId: opId,
        localDayKey: previewToCommit.localDayKey,
        items: mutationItems,
      });
      if (!mountedRef.current) return;
      setReplanMutations(mutationItems);
      setReplanCommitResult(result);
      setReplanReceipt(result.receipt);
      setReplanUndoFeedback(null);
      setReplanStep('apply');
      if (result.overall === 'committed' || result.overall === 'pending') {
        haptic.success();
      }
    } finally {
      if (mountedRef.current) setReplanCommitting(false);
    }
  }

  async function handleRetryFailedReplan() {
    if (!replanCommitResult) return;
    setReplanRetrying(true);
    try {
      const retried = await retryFailedDayPlanItems(replanCommitResult, replanMutations);
      if (!mountedRef.current) return;
      setReplanCommitResult(retried);
      setReplanReceipt(retried.receipt);
      if (retried.overall === 'committed' || retried.overall === 'pending') {
        haptic.success();
      }
    } finally {
      if (mountedRef.current) setReplanRetrying(false);
    }
  }

  async function handleUndoReplan() {
    if (!replanReceipt) return;
    const hasUndoable = replanReceipt.items.some(
      (it) => it.undoable && (it.status === 'committed' || it.status === 'pending'),
    );
    if (!hasUndoable) return;
    setReplanUndoing(true);
    try {
      const undoRes = await undoDayPlanCommit(replanReceipt);
      if (!mountedRef.current) return;
      if (undoRes.failedItemIds.length === 0) {
        setReplanReceipt(null);
      }
      if (undoRes.overall === 'undone') {
        haptic.success();
        setReplanUndoFeedback('Son gün planı değişiklikleri geri alındı.');
      } else if (undoRes.overall === 'pending') {
        setReplanUndoFeedback('Geri alma cihaza kaydedildi; bağlantı geldiğinde eşitlenecek.');
      } else if (undoRes.overall === 'conflict' || undoRes.overall === 'partial') {
        setReplanUndoFeedback('Sonradan değiştirilen maddeler korundu; uygun olanlar geri alındı.');
      } else {
        setReplanUndoFeedback('Geri alınacak uygulanmış değişiklik bulunmadı.');
      }
    } finally {
      if (mountedRef.current) setReplanUndoing(false);
    }
  }

  const effectiveReplanDay: Ymd = replanDayKey ?? (today as Ymd);
  const { fixedBlocks: replanFixedBlocks, movableTasks: replanMovableTasks } = splitFixedBlockTasks(
    tasks,
    effectiveReplanDay,
  );
  const protectableTasks = replanMovableTasks.filter(
    (t) =>
      !t.completed &&
      t.status !== 'completed' &&
      t.status !== 'cancelled' &&
      Boolean(t.due_date && t.due_date <= effectiveReplanDay),
  );
  const completedOrExcusedHabitIdsToday = new Set(
    todayLogs
      .filter(
        (l) =>
          typeof l.completed_at === 'string' &&
          l.completed_at.slice(0, 10) === effectiveReplanDay &&
          (l.state === 'done' || l.state === 'skip' || l.is_completed),
      )
      .map((l) => l.habit_id),
  );
  const protectableHabits = activeHabits.filter(
    (h) =>
      !completedOrExcusedHabitIdsToday.has(h.id) &&
      h.behavior_type !== 'negative' &&
      h.target_direction !== 'at_most',
  );
  const replanPreviewInput = replanPreviewState?.input ?? null;
  const replanPreview = replanPreviewState?.preview ?? null;
  const canUndoReplan =
    replanReceipt !== null &&
    Array.isArray(replanReceipt.items) &&
    replanReceipt.items.some(
      (it) => it.undoable && (it.status === 'committed' || it.status === 'pending'),
    );

  const totalMissed = backlogEntries.filter((e) => e.kind === 'missed').length;
  const totalPartial = backlogEntries.filter((e) => e.kind === 'partial').length;
  const totalOverdue = overdueTasks.length;
  const totalPlans = plans.length;
  // Üst üste ≥2 due-gün kaçıran (ve henüz planı olmayan) alışkanlıklar
  const neverMissTwice = activeHabits.filter((h) => consecutiveMissedDue(h) >= 2 && !planForHabit(h.id));
  const allClear = backlogEntries.length === 0 && totalOverdue === 0 && totalPlans === 0;

  // Yükleme yer tutucusu: hero + 3'lü özet şeridi + kart listesi — aşağıdaki
  // gerçek içeriğin geometrisi. Spinner yerine bu, yüklenince sıçrama olmuyor.
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.kintsugiAtelier} textureSource={TEXTURES.kintsugi} scrim={0.62} tintColor={colors.warning} />
        <View style={s.content}>
          <View style={s.hero}>
            <Skeleton width={64} height={64} circle />
            <Skeleton width={120} height={22} />
            <Skeleton width={240} height={12} />
          </View>
          <View style={s.summaryStrip}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={78} style={{ flex: 1 }} />
            ))}
          </View>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={112} style={{ marginBottom: space.sm }} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.kintsugiAtelier} textureSource={TEXTURES.kintsugi} scrim={0.62} tintColor={colors.warning} />
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.warning} />}
      >
        {/* Hero */}
        <View style={s.hero}>
          <EditorialBanner
            source={SCREEN_BANNERS.recoveryKintsugi}
            textureSource={TEXTURES.kintsugi}
            eyebrow="ŞEFKATLİ ONARIM"
            title="Telafi"
            subtitle="Kaldığın yerden sakin bir adımla devam et. Toparlanma zamanı."
            accentColor={colors.warning}
            minHeight={112}
            style={{ alignSelf: 'stretch' }}
          />


        </View>

        {eligibleCapsuleItem && !capsuleLater && (
          <View style={s.capsuleWrap}>
            <TimeCapsuleCard
              capsule={eligibleCapsuleItem}
              onRead={() => {
                void caps.open(eligibleCapsuleItem.id);
              }}
              onLater={() => setCapsuleLater(true)}
            />
          </View>
        )}

        {/* U05 & P04 — Bugün planım dağıldı · Günü toparla (Koru -> Gör -> Uygula) */}
        <View testID="recovery-day-replan-card" style={s.replanCardWrap}>
          <Card padding="md">
            <View style={s.replanHeadRow}>
              <IconCircle icon="compass-outline" color={colors.warning} size={38} radiusKey="sm" />
              <View style={{ flex: 1 }}>
                <Text style={s.replanEyebrow}>GÜN İÇİ DENGELEME</Text>
                <Text style={s.replanTitle}>Bugün planım dağıldı · Günü toparla</Text>
                <Text style={s.replanSub}>
                  Tek bir odağı koru, kalan kapasiteye neyin sığacağını gör ve güvenle uygula.
                </Text>
              </View>
            </View>

            {replanStep === 'closed' && (
              <View style={s.replanClosedActions}>
                <Button
                  testID="recovery-open-replan"
                  label="Günü toparla"
                  icon="sparkles-outline"
                  size="sm"
                  color={colors.warning}
                  variant="tonal"
                  onPress={openReplanFlow}
                  accessibilityLabel="Günü toparla akışını başlat"
                />

                {canUndoReplan && (
                  <Button
                    testID="recovery-replan-undo"
                    label="Geri al"
                    icon="arrow-undo-outline"
                    variant="ghost"
                    size="sm"
                    color={colors.warning}
                    disabled={replanUndoing}
                    loading={replanUndoing}
                    onPress={handleUndoReplan}
                    accessibilityLabel="Son gün planı değişikliğini geri al"
                  />
                )}

                {replanUndoFeedback && (
                  <Text testID="recovery-replan-undo-feedback" style={s.replanFeedbackText}>
                    {replanUndoFeedback}
                  </Text>
                )}
              </View>
            )}

            {replanStep === 'protect' && (
              <View testID="recovery-replan-step-protect" style={s.replanStepBox}>
                <Text style={s.replanStepLabel}>ADIM 1/3 · KORU</Text>
                <Text style={s.replanStepHint}>
                  Bugün mutlaka yerinde kalsın dediğin tek bir işi seç ya da Hiçbiri ile devam et.
                </Text>
                {replanFixedBlocks.length > 0 && (
                  <Text style={s.replanLockedHint}>
                    {replanFixedBlocks.length} sabit saat bloğu otomatik kilitlidir ve taşınmaz.
                  </Text>
                )}

                <View accessibilityRole="radiogroup" accessibilityLabel="Bugün korunacak odak seçimi" style={s.replanOptionList}>
                  <Card
                    testID="recovery-replan-protect-none"
                    padding="sm"
                    selected={replanProtectedRef === null}
                    accent={colors.warning}
                    onPress={() => {
                      haptic.select();
                      setReplanProtectedRef(null);
                    }}
                    accessibilityRole="radio"
                    accessibilityLabel="Hiçbiri — tüm açık işleri kalan kapasiteye göre değerlendir"
                    accessibilityState={{ checked: replanProtectedRef === null, selected: replanProtectedRef === null }}
                    style={s.replanRadioRow}
                  >
                    <Ionicons
                      name={replanProtectedRef === null ? 'radio-button-on' : 'radio-button-off'}
                      size={18}
                      color={replanProtectedRef === null ? colors.warning : colors.textDim}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />
                    <Text style={s.replanRadioTitle}>Hiçbiri (tümünü kapasiteye göre dengele)</Text>
                  </Card>

                  {protectableTasks.map((task) => {
                    const selected =
                      replanProtectedRef?.entity === 'task' && replanProtectedRef.id === task.id;
                    return (
                      <Card
                        key={`task:${task.id}`}
                        testID={`recovery-replan-protect-task-${task.id}`}
                        padding="sm"
                        selected={selected}
                        accent={colors.warning}
                        onPress={() => {
                          haptic.select();
                          setReplanProtectedRef({ entity: 'task', id: task.id });
                        }}
                        accessibilityRole="radio"
                        accessibilityLabel={`Görev koru: ${task.title}`}
                        accessibilityState={{ checked: selected, selected }}
                        style={s.replanRadioRow}
                      >
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={selected ? colors.warning : colors.textDim}
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={s.replanRadioTitle} numberOfLines={1}>{task.title}</Text>
                          <Text style={s.replanRadioMeta}>Görev</Text>
                        </View>
                      </Card>
                    );
                  })}

                  {protectableHabits.map((habit) => {
                    const selected =
                      replanProtectedRef?.entity === 'habit' && replanProtectedRef.id === habit.id;
                    return (
                      <Card
                        key={`habit:${habit.id}`}
                        testID={`recovery-replan-protect-habit-${habit.id}`}
                        padding="sm"
                        selected={selected}
                        accent={colors.warning}
                        onPress={() => {
                          haptic.select();
                          setReplanProtectedRef({ entity: 'habit', id: habit.id });
                        }}
                        accessibilityRole="radio"
                        accessibilityLabel={`Alışkanlık koru: ${habit.name}`}
                        accessibilityState={{ checked: selected, selected }}
                        style={s.replanRadioRow}
                      >
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={selected ? colors.warning : colors.textDim}
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={s.replanRadioTitle} numberOfLines={1}>{habit.name}</Text>
                          <Text style={s.replanRadioMeta}>Rutin</Text>
                        </View>
                      </Card>
                    );
                  })}
                </View>

                <View style={s.replanFooterRow}>
                  <Button
                    testID="recovery-replan-close"
                    label="Vazgeç"
                    variant="ghost"
                    size="sm"
                    color={colors.textDim}
                    onPress={closeReplanFlow}
                    accessibilityLabel="Günü toparla akışını kapat"
                  />
                  <Button
                    testID="recovery-replan-to-preview"
                    label="Gör →"
                    variant="tonal"
                    size="sm"
                    color={colors.warning}
                    full
                    onPress={proceedToReplanPreview}
                    accessibilityLabel="Önizleme adımına geç"
                  />
                </View>
              </View>
            )}

            {replanStep === 'preview' && replanPreview && replanPreviewInput && (
              <View testID="recovery-replan-step-preview" style={s.replanStepBox}>
                <Text style={s.replanStepLabel}>ADIM 2/3 · GÖR — BUGÜN NE KADARI SIĞAR?</Text>

                <View testID="recovery-replan-load-summary" style={s.replanSummaryBox}>
                  <Text style={s.replanLoadValue}>
                    Gün yükü: {replanPreview.loadBefore} {'->'} {replanPreview.loadAfter} / 100 · {bandLabel(replanPreview.bandAfter)}
                  </Text>
                  <Text style={s.replanLoadMeta}>
                    Kalan odak kapasitesi: {replanPreview.capacitySummary.effectiveCapacityMinutes} dk · Planlanan kullanım: {replanPreview.capacitySummary.usedCapacityMinutes} dk
                  </Text>
                  {!replanPreview.capacitySummary.externalCalendarConnected && (
                    <Text style={s.replanLoadNote}>
                      Dış takvim bağlı değil; yalnızca uygulama içi sabit saat blokları dikkate alındı.
                    </Text>
                  )}
                  {replanPreview.missingEstimateTaskIds.length > 0 && (
                    <Text style={s.replanLoadNote}>
                      {replanPreview.missingEstimateTaskIds.length} görevde kayıtlı süre tahmini yok; varsayılan tahminle değerlendirildi.
                    </Text>
                  )}
                </View>

                {replanPreview.lockedItems.length > 0 && (
                  <View testID="recovery-replan-locked-list" style={s.replanGroupBox}>
                    <Text style={s.replanGroupTitle}>KİLİTLİ SABİT BLOKLAR VE TAMAMLANANLAR</Text>
                    {replanPreview.lockedItems.map((locked) => (
                      <View key={`${locked.kind}:${locked.id}`} style={s.replanLockedItemRow}>
                        <Ionicons name="lock-closed-outline" size={15} color={colors.textDim} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                        <View style={{ flex: 1 }}>
                          <Text style={s.replanItemTitle} numberOfLines={1}>
                            {locked.title}
                            {locked.timeBlock
                              ? ` (${locked.timeBlock.start}${locked.timeBlock.end ? `–${locked.timeBlock.end}` : ''})`
                              : ''}
                          </Text>
                          <Text style={s.replanItemReason}>{locked.displayReason}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                <View testID="recovery-replan-protected-summary" style={s.replanGroupBox}>
                  <Text style={s.replanGroupTitle}>KORUNAN ODAK</Text>
                  {replanPreview.protectedItems.length > 0 ? (
                    replanPreview.protectedItems.map((prot) => (
                      <View key={`${prot.sourceRef.entity}:${prot.sourceRef.id}`} style={s.replanLockedItemRow}>
                        <Ionicons name="shield-checkmark-outline" size={16} color={colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                        <View style={{ flex: 1 }}>
                          <Text style={s.replanItemTitle} numberOfLines={1}>{prot.sourceRef.title}</Text>
                          <Text style={s.replanItemReason}>{prot.displayReason}</Text>
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text style={s.replanItemReason}>Özel korunan tek iş seçilmedi (Hiçbiri).</Text>
                  )}
                </View>

                <View testID="recovery-replan-changes-list" style={s.replanGroupBox}>
                  <Text style={s.replanGroupTitle}>ESNEK ÖĞELER VE ÖNERİLEN KARARLAR</Text>
                  {replanPreview.changes.length === 0 ? (
                    <Text style={s.replanItemReason}>Taşınacak veya hafifletilecek ek açık öğe yok.</Text>
                  ) : (
                    replanPreview.changes.map((ch) => (
                      <View key={ch.changeId} style={s.replanChangeCard}>
                        <Text style={s.replanItemTitle}>{ch.sourceRef.title}</Text>
                        <Text style={s.replanItemReason}>{ch.displayReason}</Text>
                        {ch.action === 'do_not_recover' && (
                          <Text
                            testID={`recovery-replan-p04-note-${ch.sourceRef.id}`}
                            style={s.replanP04Note}
                          >
                            Önceki kısmi ilerleme kaydı olduğu gibi korunur; uydurma miktar eklenmez.
                          </Text>
                        )}
                        <View
                          accessibilityRole="radiogroup"
                          accessibilityLabel={`${ch.sourceRef.title} için karar seçimi`}
                          style={s.replanActionPills}
                        >
                          {ch.availableActions.map((act) => {
                            const active = ch.action === act;
                            return (
                              <Chip
                                key={act}
                                testID={`recovery-replan-action-${ch.sourceRef.entity}-${ch.sourceRef.id}-${act}`}
                                label={replanActionLabel(act)}
                                color={colors.primaryBright}
                                selected={active}
                                onPress={() =>
                                  handleReplanOverride(
                                    replanPreviewInput,
                                    ch.sourceRef.entity,
                                    ch.sourceRef.id,
                                    act,
                                  )
                                }
                                accessibilityRole="radio"
                                accessibilityLabel={`${ch.sourceRef.title}: ${replanActionLabel(act)}`}
                                accessibilityState={{ checked: active, selected: active }}
                              />
                            );
                          })}
                        </View>
                      </View>
                    ))
                  )}
                </View>

                {replanStaleMessage && (
                  <View testID="recovery-replan-stale-banner" style={s.replanStaleBox}>
                    <Text style={s.replanStaleText}>{replanStaleMessage}</Text>
                    <Button
                      testID="recovery-replan-refresh-preview"
                      label="Önizlemeyi yenile"
                      variant="ghost"
                      size="sm"
                      color={colors.warning}
                      onPress={refreshReplanPreview}
                      accessibilityLabel="Güncel verilerle önizlemeyi yenile"
                    />
                  </View>
                )}

                <View style={s.replanFooterRow}>
                  <Button
                    testID="recovery-replan-back"
                    label="Geri"
                    variant="ghost"
                    size="sm"
                    color={colors.textDim}
                    onPress={() => {
                      haptic.light();
                      setReplanStep('protect');
                    }}
                    accessibilityLabel="Koru adımına geri dön"
                  />
                  <Button
                    testID="recovery-replan-close"
                    label="Kapat"
                    variant="ghost"
                    size="sm"
                    color={colors.textDim}
                    onPress={closeReplanFlow}
                    accessibilityLabel="Değişiklik yapmadan kapat"
                  />
                  <Button
                    testID="recovery-replan-confirm"
                    label={replanCommitting ? 'Uygulanıyor...' : 'Uygula'}
                    variant="tonal"
                    size="sm"
                    color={colors.warning}
                    full
                    disabled={replanCommitting}
                    loading={replanCommitting}
                    onPress={() => {
                      void handleApplyReplan(replanPreview);
                    }}
                    accessibilityLabel="Seçilen gün planını uygula"
                  />
                </View>
              </View>
            )}

            {replanStep === 'apply' && replanCommitResult && (
              <View testID="recovery-replan-step-apply" style={s.replanStepBox}>
                <Text style={s.replanStepLabel}>ADIM 3/3 · UYGULA SONUCU</Text>
                <View
                  testID={`recovery-replan-status-${replanCommitResult.overall}`}
                  style={s.replanSummaryBox}
                >
                  <Text style={s.replanLoadValue}>
                    {replanCommitResult.overall === 'committed'
                      ? 'Plan güncellendi ve kaydedildi.'
                      : replanCommitResult.overall === 'pending'
                        ? 'Değişiklikler cihaza kaydedildi; bağlantı geldiğinde eşitlenecek.'
                        : replanCommitResult.overall === 'partial'
                          ? 'Bazı maddeler uygulandı; tamamlanamayanları yeniden deneyebilirsin.'
                          : replanCommitResult.overall === 'conflict'
                            ? 'Çakışma algılandı; başka bir yerde güncellenen maddelerin üzerine yazılmadı.'
                            : 'İşlem oturum veya gün değişimi nedeniyle durduruldu.'}
                  </Text>
                </View>

                {(replanCommitResult.overall === 'partial' ||
                  replanCommitResult.retryableItemIds.length > 0) && (
                  <Button
                    testID="recovery-replan-retry-failed"
                    label={replanRetrying ? 'Yeniden deneniyor...' : 'Başarısızları yeniden dene'}
                    variant="ghost"
                    size="sm"
                    icon="refresh-outline"
                    color={colors.primaryBright}
                    disabled={replanRetrying}
                    loading={replanRetrying}
                    onPress={() => {
                      void handleRetryFailedReplan();
                    }}
                    accessibilityLabel="Yalnızca başarısız maddeleri yeniden dene"
                  />
                )}

                {canUndoReplan && (
                  <Button
                    testID="recovery-replan-undo"
                    label={replanUndoing ? 'Geri alınıyor...' : 'Geri al'}
                    variant="ghost"
                    size="sm"
                    icon="arrow-undo-outline"
                    color={colors.warning}
                    disabled={replanUndoing}
                    loading={replanUndoing}
                    onPress={() => {
                      void handleUndoReplan();
                    }}
                    accessibilityLabel="Uygulanan gün planı değişikliklerini geri al"
                  />
                )}

                {replanUndoFeedback && (
                  <Text testID="recovery-replan-undo-feedback" style={s.replanFeedbackText}>
                    {replanUndoFeedback}
                  </Text>
                )}

                <View style={s.replanFooterRow}>
                  <Button
                    testID="recovery-replan-close"
                    label="Tamam"
                    variant="ghost"
                    size="sm"
                    color={colors.textDim}
                    full
                    onPress={closeReplanFlow}
                    accessibilityLabel="Günü toparla özetini kapat"
                  />
                </View>
              </View>
            )}
          </Card>
        </View>

        {/* Özet şerit */}
        <View style={s.summaryStrip}>
          <Card padding="md" style={s.stripCard}>
            <Ionicons name="pulse-outline" size={18} color={totalMissed > 0 ? colors.warning : colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={[s.stripNum, { color: totalMissed > 0 ? colors.warning : colors.success }]}>{totalMissed}</Text>
            <Text style={s.stripLabel}>{BACKLOG_BADGE_PENDING}</Text>
          </Card>
          <Card padding="md" style={s.stripCard}>
            <Ionicons name="contrast-outline" size={18} color={totalPartial > 0 ? colors.info : colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={[s.stripNum, { color: totalPartial > 0 ? colors.info : colors.success }]}>{totalPartial}</Text>
            <Text style={s.stripLabel}>{BACKLOG_BADGE_PARTIAL}</Text>
          </Card>
          <Card padding="md" style={s.stripCard}>
            <Ionicons name="time-outline" size={18} color={totalOverdue > 0 ? colors.error : colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={[s.stripNum, { color: totalOverdue > 0 ? colors.error : colors.success }]}>{totalOverdue}</Text>
            <Text style={s.stripLabel}>Gecikmiş İş</Text>
          </Card>
        </View>

        {allClear && (
          <Card padding="lg" style={{ marginBottom: space.lg }}>
            <EmptyState
              icon="checkmark-done-circle-outline"
              title="Her şey yolunda!"
              hint="Telafi edilecek bir şey yok. Serini koru — yarın da burada görüşürüz."
              color={colors.success}
              compact
            />
          </Card>
        )}

        {!allClear && <ChapterDivider source={DECOR.dividerSundial} label="KINTSUGI ONARIM ATÖLYESİ" />}
        {/* Telafi Planın — aktif planlar */}
        {totalPlans > 0 && (
          <View style={s.section}>
            <SectionHeader title="Telafi Planın" icon="calendar-outline" iconColor={colors.primaryBright} count={totalPlans} variant="serif" />
            {plans.map((p) => {
              const h = habitById(p.habit_id);
              const m = STRATEGY_META[p.strategy];
              const overdue = p.target_date < today;
              return (
                <Card key={p.id} padding="md" style={{ marginBottom: space.sm, overflow: 'hidden', position: 'relative' }} selected={overdue} accent={colors.error}>
                  <EmbeddedFiligree source={DECOR.cornerKintsugiSeam} size={108} opacity={0.18} />
                  <GoldMendShimmer triggerKey={totalPlans} />
                  <View style={s.habitRow}>
                    <IconCircle icon={toIoniconName(h?.icon)} color={h?.color ?? colors.primary} size={40} radiusKey="sm" />
                    <View style={{ flex: 1 }}>
                      <Text style={s.habitName} numberOfLines={1}>{h?.name ?? 'Alışkanlık'}</Text>
                      <View style={s.habitMeta}>
                        <Badge label={targetLabel(p.target_date)} icon="calendar-outline" color={overdue ? colors.error : colors.primaryBright} />
                        <Chip label={m.label} icon={m.icon} color={m.color} size="sm" />
                        {p.reminder_time && <Badge label={p.reminder_time} icon="notifications" color={colors.accent} />}
                        {overdue && <Badge label="gecikti" icon="alert-circle" color={colors.error} />}
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => { haptic.warning(); deletePlan(p.id); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`${h?.name ?? 'Alışkanlık'} telafi planını sil`}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.textGhost} />
                    </TouchableOpacity>
                  </View>
                  {!!p.note && <Text style={s.planNote}>{p.note}</Text>}
                  <View style={s.habitActions}>
                    <Button label="Telafi Et" icon="checkmark-done" variant="primary" size="sm" onPress={() => handleCompletePlan(p)} style={{ flex: 1 }} />
                    <Button label="Atla" icon="play-skip-forward-outline" variant="ghost" size="sm" color={colors.textDim} onPress={() => { haptic.light(); skipPlan(p.id); }} style={{ flex: 1 }} />
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        {/* Sakin dönüş hatırlatması (DOM-23: utandırmayan ton, alert rolü yok) */}
        {neverMissTwice.length > 0 && (
          <View style={s.warnBanner}>
            <Ionicons name="leaf-outline" size={18} color={colors.textDim} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <View style={{ flex: 1 }}>
              <Text style={s.warnTitle}>{RETURN_NUDGE_TITLE}</Text>
              <Text style={s.warnText}>
                {neverMissTwice.length === 1
                  ? returnNudgeOne(neverMissTwice[0].name, consecutiveMissedDue(neverMissTwice[0]))
                  : returnNudgeMany(neverMissTwice.length)}
              </Text>
            </View>
          </View>
        )}

        {/* Telafi Bekleyen — geçmiş günlerde bekleyen/kısmi (frekansa göre due, 7'şer satır) */}
        {backlogEntries.length > 0 && (
          <View style={s.section}>
            <SectionHeader title="Telafi Bekleyen" icon="calendar-outline" iconColor={colors.textDim} count={shownBacklog.length} variant="serif" />
            {shownBacklog.map((e) => {
              const h = e.habit;
              const key = `${h.id}|${e.date}`;
              const isLogging = loggingId === key;
              const streak = streaks[h.id] ?? 0;
              return (
                <Card key={key} padding="md" style={{ marginBottom: space.sm, overflow: 'hidden', position: 'relative' }}>
                  <EmbeddedFiligree source={DECOR.cornerKintsugiSeam} size={104} opacity={0.16} />
                  <View style={s.habitRow}>
                    <IconCircle icon={toIoniconName(h.icon)} color={h.color ?? colors.primary} size={40} radiusKey="sm" />
                    <View style={{ flex: 1 }}>
                      <Text style={s.habitName} numberOfLines={1}>{h.name}</Text>
                      <View style={s.habitMeta}>
                        <Badge label={pastLabel(e.date)} icon="calendar-outline" color={colors.textDim} />
                        {e.kind === 'partial'
                          ? <Badge label={BACKLOG_BADGE_PARTIAL} icon="contrast-outline" color={colors.info} />
                          : <Badge label={BACKLOG_BADGE_PENDING} icon="calendar-outline" color={colors.textDim} />}
                        {streak > 0 && <Badge label={streak >= 60 ? '60+g seri' : `${streak}g seri`} icon="flame" color={colors.warning} />}
                      </View>
                    </View>
                  </View>
                  <View style={s.habitActions}>
                    <Button label="Yaptım" icon="checkmark" variant="tonal" color={colors.success} size="sm"
                      loading={isLogging} onPress={() => handleLogNow(h.id, e.date)} style={{ flex: 1 }} />
                    <Button label="Telafi Planla" icon="calendar-outline" variant="tonal" size="sm"
                      onPress={() => openPlan(h, e.date)} style={{ flex: 1 }} />
                  </View>
                </Card>
              );
            })}
            {hiddenBacklog > 0 && (
              <Button
                label={backlogMoreLabel(hiddenBacklog)}
                variant="ghost"
                size="md"
                color={colors.textDim}
                onPress={() => setBacklogVisible((v) => v + BACKLOG_PAGE_SIZE)}
                accessibilityLabel={`Daha fazla bekleyen günü göster, kalan ${hiddenBacklog}`}
              />
            )}
          </View>
        )}

        {/* Gecikmiş görevler */}
        {totalOverdue > 0 && (
          <View style={s.section}>
            <SectionHeader title="Gecikmiş İşler" icon="time-outline" iconColor={colors.error} count={totalOverdue} variant="serif" />
            {overdueTasks.map((t) => (
              <Card key={t.id} padding="md" style={{ marginBottom: space.sm }}>
                <View style={s.taskInfo}>
                  <Text style={s.taskTitle} numberOfLines={1}>{t.title}</Text>
                  <Text style={s.taskDate}>{t.due_date}</Text>
                </View>
                <View style={s.taskActions}>
                  <Button label="Tamamla" icon="checkmark" variant="tonal" size="sm" color={colors.success}
                    onPress={() => { haptic.success(); toggleDone(t.id); }} />
                  <Button label="Bu Hafta" icon="arrow-forward" variant="tonal" size="sm"
                    onPress={() => { haptic.light(); moveToList(t.id, 'this_week'); }} />
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Telafi planlama sheet'i */}
      <Modal visible={!!planTarget} transparent animationType="slide" onRequestClose={() => setPlanTarget(null)}>
        <KeyboardAvoidingView style={s.sheetOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTitle}>Telafi Planla</Text>
                <Text style={s.sheetHabit} numberOfLines={1}>
                  {planTarget?.name}{planSource ? ` · ${pastLabel(planSource)} bekliyor` : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setPlanTarget(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Telafi planlamayı kapat"
              >
                <Ionicons name="close" size={22} color={colors.textDim} />
              </TouchableOpacity>
            </View>

            {/* W3 (Plan §9) — gerçek hesaplanmış açık + recoveryOptionsFor'un
                önerdiği 4 seçenek. Salt bilgi amaçlı; seçim hâlâ aşağıdaki
                NASIL ızgarasından (STRATEGY_META) yapılır. v1 sezgisel
                gösterge; hassas bir ölçüm iddiası değildir. */}
            {planDeficit && (
              <View style={s.deficitBox}>
                <Text style={s.deficitLabel}>
                  TELAFİ —{' '}
                  {planDeficit.type === 'numeric'
                    ? planDeficit.value > 0
                      ? `${planDeficit.value.toLocaleString('tr-TR')}${planTarget?.unit ? ` ${planTarget.unit}` : ''} kaldı`
                      : 'hedef tamamlandı'
                    : planDeficit.value > 0 ? 'bu gün kaldı' : 'bekleyen yok'}
                </Text>
                {planOptions.length > 0 && (
                  <Text style={s.deficitHint}>
                    Öneri: {planOptions.map((o) => o.label).join(' · ')}
                  </Text>
                )}
              </View>
            )}

            <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
              {/* NE ZAMAN */}
              <Text style={s.fieldLabel}>NE ZAMAN</Text>
              <View style={s.chipRow}>
                {WHEN_OPTIONS.map((w) => {
                  const off = w.offset();
                  return (
                    <Chip key={w.key} label={w.label} color={colors.primaryBright}
                      selected={whenOffset === off} onPress={() => { haptic.select(); setWhenOffset(off); }} />
                  );
                })}
              </View>
              <View style={s.stepper}>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() => { haptic.select(); setWhenOffset((o) => Math.max(0, o - 1)); }}
                  accessibilityRole="button"
                  accessibilityLabel="Telafi gününü bir gün geri al"
                >
                  <Ionicons name="remove" size={18} color={colors.text} />
                </TouchableOpacity>
                <View style={s.stepInfo}>
                  <Text style={s.stepDate}>{format(addDays(new Date(), whenOffset), 'd MMMM EEEE', { locale: tr })}</Text>
                  <Text style={s.stepSub}>{whenOffset === 0 ? 'bugün' : whenOffset === 1 ? 'yarın' : `${whenOffset} gün sonra`}</Text>
                </View>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() => { haptic.select(); setWhenOffset((o) => Math.min(30, o + 1)); }}
                  accessibilityRole="button"
                  accessibilityLabel="Telafi gününü bir gün ileri al"
                >
                  <Ionicons name="add" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              {/* R03.05 — O GÜNÜN YÜKÜ */}
              {loadPreview && (
                <View
                  style={[s.loadPreview, (loadPreview.bandAfter === 'yuksek' || loadPreview.bandAfter === 'asiri') && s.loadPreviewWarn]}
                  accessible
                  accessibilityRole="summary"
                  accessibilityLabel={`O günün yükü ${loadPreview.before}'dan ${loadPreview.after}'a çıkar, ${bandLabel(loadPreview.bandAfter)}.`}
                >
                  <Text style={s.loadPreviewLabel}>O GÜNÜN YÜKÜ</Text>
                  <Text style={s.loadPreviewValue}>
                    {loadPreview.before} → {loadPreview.after} / 100 · {bandLabel(loadPreview.bandAfter)}
                  </Text>
                  {loadPreview.bandAfter === 'asiri' && (
                    <Text style={s.loadPreviewHint}>
                      Bu gün zaten çok dolu. Telafiyi ikiye bölmeyi ya da başka bir güne almayı düşünebilirsin.
                    </Text>
                  )}
                  {loadPreview.bandAfter === 'yuksek' && (
                    <Text style={s.loadPreviewHint}>Bu gün yoğunlaşıyor.</Text>
                  )}
                </View>
              )}

              {/* NASIL */}
              <Text style={[s.fieldLabel, { marginTop: space.lg }]}>NASIL</Text>
              <View style={s.stratGrid}>
                {(Object.keys(STRATEGY_META) as RecoveryStrategy[]).map((k) => {
                  const m = STRATEGY_META[k];
                  const sel = strategy === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      style={[s.stratCard, sel && { borderColor: m.color, backgroundColor: hexA(m.color, 0.1) }]}
                      onPress={() => { haptic.select(); setStrategy(k); }}
                      accessibilityRole="radio"
                      accessibilityLabel={`${m.label} — ${m.desc}`}
                      accessibilityState={{ checked: sel, selected: sel }}
                    >
                      <Image source={STRATEGY_ART[k]} style={s.stratArt} contentFit="cover" cachePolicy="memory-disk" />
                      <Ionicons name={m.icon} size={18} color={m.color} />
                      <Text style={[s.stratLabel, sel && { color: m.color }]}>{m.label}</Text>
                      <Text style={s.stratDesc}>{m.desc}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* NOT */}
              <Text style={[s.fieldLabel, { marginTop: space.lg }]}>NOT (opsiyonel)</Text>
              <TextInput
                style={s.noteInput}
                placeholder="Örn. kahvaltıdan hemen sonra, salonda 15 dk"
                placeholderTextColor={colors.textFaint}
                value={note}
                onChangeText={setNote}
                multiline
                accessibilityLabel="Telafi notu"
              />

              {/* HATIRLATICI */}
              <TouchableOpacity
                style={s.remToggle}
                activeOpacity={0.7}
                onPress={() => { haptic.select(); setReminderOn((v) => !v); }}
                accessibilityRole="switch"
                accessibilityLabel="Hatırlatıcı"
                accessibilityState={{ checked: reminderOn }}
              >
                <Ionicons name={reminderOn ? 'notifications' : 'notifications-off-outline'} size={18} color={reminderOn ? colors.accent : colors.textFaint} />
                <Text style={[s.remLabel, reminderOn && { color: colors.text }]}>Hatırlatıcı</Text>
                <View style={[s.switchTrack, reminderOn && { backgroundColor: colors.accent }]}>
                  <View style={[s.switchKnob, reminderOn && { transform: [{ translateX: 16 }] }]} />
                </View>
              </TouchableOpacity>
              {reminderOn && (
                <View style={s.timeRow}>
                  <Ionicons name="time-outline" size={16} color={colors.textFaint} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                  <TextInput
                    style={s.timeInput}
                    value={reminderTime}
                    onChangeText={setReminderTime}
                    placeholder="20:00"
                    placeholderTextColor={colors.textFaint}
                    maxLength={5}
                    accessibilityLabel="Hatırlatıcı saati"
                  />
                  <Text style={s.timeHint}>SS:DD</Text>
                </View>
              )}
            </ScrollView>

            <FormError message={planError} />
            <Button
              label={`${format(addDays(new Date(), whenOffset), 'd MMM', { locale: tr })} için planla`}
              icon="checkmark"
              size="lg"
              loading={saving}
              onPress={submitPlan}
              style={{ marginTop: space.md }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* KD-12 — ölçülebilir telafide miktar sorulur; değer uydurulmaz. */}
      <MeasurableInputModal
        visible={makeupTarget !== null}
        habit={makeupTarget?.habit ?? null}
        currentValue={makeupTarget?.prior ?? 0}
        dayLabel={makeupTarget ? `${makeupDayText(makeupTarget.date)} gününe` : undefined}
        onClose={() => setMakeupTarget(null)}
        onConfirm={handleMakeupConfirm}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.xl, paddingBottom: space.hh },

  hero: { alignItems: 'center', gap: 8, marginBottom: space.lg },
  capsuleWrap: { marginBottom: space.lg },
  heroTitle: { ...font.title, color: colors.text },
  heroSub: { ...font.bodySm, color: colors.textFaint, textAlign: 'center', maxWidth: 280, lineHeight: 19 },

  summaryStrip: { flexDirection: 'row', gap: space.md, marginBottom: space.xxl },
  stripCard: { flex: 1, alignItems: 'center', gap: 4 },
  stripNum: { ...font.metric, fontSize: 24 },
  stripLabel: { fontSize: 11, color: colors.textFaint, textAlign: 'center' },

  section: { marginBottom: space.xxl },

  warnBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: space.lg,
  },
  warnTitle: { ...font.h3, fontSize: 14, color: colors.text, marginBottom: 2 },
  warnText: { ...font.bodySm, color: colors.textDim, lineHeight: 18 },

  progRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  progText: { fontSize: 11, color: colors.textFaint, minWidth: 64, textAlign: 'right' },

  habitRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  habitName: { ...font.body, color: colors.text, fontWeight: '600', marginBottom: 4 },
  habitMeta: { flexDirection: 'row', gap: 5, alignItems: 'center', flexWrap: 'wrap' },
  habitActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  planNote: { ...font.bodySm, color: colors.textDim, marginTop: space.sm, fontStyle: 'italic' },

  taskInfo: { marginBottom: space.md },
  taskTitle: { ...font.body, color: colors.text, fontWeight: '500' },
  taskDate: { fontSize: 12, color: colors.error, marginTop: 2 },
  taskActions: { flexDirection: 'row', gap: space.sm },

  // Planlama sheet'i
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: space.xl, paddingBottom: Platform.OS === 'ios' ? 36 : space.xxl,
    borderWidth: 1, borderColor: colors.border,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.lg },
  sheetTitle: { ...font.h2, color: colors.text },
  sheetHabit: { ...font.bodySm, color: colors.textFaint, marginTop: 2 },
  deficitBox: {
    backgroundColor: hexA(colors.warning, 0.1), borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: hexA(colors.warning, 0.3), marginBottom: space.lg,
  },
  deficitLabel: { ...font.body, color: colors.warning, fontWeight: '700' },
  deficitHint: { ...font.bodySm, color: colors.textDim, marginTop: 4, lineHeight: 17 },
  fieldLabel: { ...font.overline, color: colors.textFaint, marginBottom: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.bgElevated, borderRadius: radius.md, padding: space.sm, borderWidth: 1, borderColor: colors.border },
  stepBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  stepInfo: { flex: 1, alignItems: 'center' },
  stepDate: { ...font.body, color: colors.text, fontWeight: '600' },
  stepSub: { fontSize: 11, color: colors.textFaint, marginTop: 1 },

  stratGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // R03.05
  loadPreview: { marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border, gap: 2 },
  loadPreviewWarn: { borderColor: hexA(colors.warning, 0.5) },
  loadPreviewLabel: { fontSize: 10, letterSpacing: 1, color: colors.textFaint, fontWeight: '700' },
  loadPreviewValue: { fontSize: 14, color: colors.text, fontWeight: '700' },
  loadPreviewHint: { fontSize: 12, color: colors.warning, marginTop: 4, lineHeight: 17 },
  stratArt: { width: '100%', height: 54, borderRadius: radius.sm, marginBottom: 4, opacity: 0.92 },
  stratCard: { overflow: 'hidden', position: 'relative',
    width: '48%', backgroundColor: colors.bgElevated, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.border, gap: 4,
  },
  stratLabel: { ...font.bodySm, color: colors.text, fontWeight: '700', marginTop: 2 },
  stratDesc: { fontSize: 11, color: colors.textFaint, lineHeight: 15 },

  noteInput: {
    backgroundColor: colors.bgElevated, borderRadius: radius.md, padding: space.md, minHeight: 56,
    color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border, textAlignVertical: 'top',
  },
  remToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  remLabel: { flex: 1, ...font.body, color: colors.textDim },
  switchTrack: { width: 38, height: 22, borderRadius: 11, backgroundColor: colors.surfaceAlt, padding: 3, justifyContent: 'center' },
  switchKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.white },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, backgroundColor: colors.bgElevated, borderRadius: radius.md, paddingHorizontal: space.md, height: 44, borderWidth: 1, borderColor: colors.border },
  timeInput: { flex: 1, color: colors.text, fontSize: 15 },
  timeHint: { fontSize: 11, color: colors.textFaint },

  // U05 & P04 — Günü toparla kartı
  replanCardWrap: { marginBottom: space.lg },
  replanHeadRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  replanEyebrow: { ...font.overline, color: colors.warning, marginBottom: space.xs },
  replanTitle: { ...font.body, color: colors.text, fontWeight: '700' },
  replanSub: { ...font.bodySm, color: colors.textDim, marginTop: space.xs, lineHeight: 18 },
  replanClosedActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.md },
  replanFeedbackText: { ...font.bodySm, color: colors.textDim, width: '100%', marginTop: space.xs },
  replanStepBox: { marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border, gap: space.md },
  replanStepLabel: { ...font.overline, color: colors.textFaint },
  replanStepHint: { ...font.bodySm, color: colors.textDim, lineHeight: 18 },
  replanLockedHint: { ...font.caption, color: colors.info, lineHeight: 17 },
  replanOptionList: { gap: space.sm },
  replanRadioRow: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.bgElevated,
  },
  replanRadioTitle: { ...font.bodySm, color: colors.text, fontWeight: '600' },
  replanRadioMeta: { ...font.caption, color: colors.textFaint, marginTop: space.xs },
  replanFooterRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  replanSummaryBox: {
    padding: space.md, borderRadius: radius.md, backgroundColor: colors.bgElevated,
    borderWidth: 1, borderColor: colors.border, gap: space.xs,
  },
  replanLoadValue: { ...font.body, color: colors.text, fontWeight: '700' },
  replanLoadMeta: { ...font.bodySm, color: colors.textDim },
  replanLoadNote: { ...font.caption, color: colors.textFaint, lineHeight: 16 },
  replanGroupBox: { gap: space.sm },
  replanGroupTitle: { ...font.overline, color: colors.textFaint },
  replanLockedItemRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.bgElevated,
    borderWidth: 1, borderColor: colors.border,
  },
  replanChangeCard: {
    padding: space.md, borderRadius: radius.md, backgroundColor: colors.bgElevated,
    borderWidth: 1, borderColor: colors.border, gap: space.xs,
  },
  replanItemTitle: { ...font.bodySm, color: colors.text, fontWeight: '600' },
  replanItemReason: { ...font.caption, color: colors.textDim, lineHeight: 17 },
  replanP04Note: { ...font.caption, color: colors.info, lineHeight: 16 },
  replanActionPills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  replanStaleBox: {
    padding: space.md, borderRadius: radius.md, backgroundColor: hexA(colors.warning, 0.1),
    borderWidth: 1, borderColor: hexA(colors.warning, 0.4), gap: space.sm,
  },
  replanStaleText: { ...font.bodySm, color: colors.warning, lineHeight: 18 },
});
