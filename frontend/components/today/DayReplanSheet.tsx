/**
 * Faz F4 — U05 («Bugün planım dağıldı»: 3 Adımlı Koru · Gör · Uygula Modalı).
 *
 * Sözleşmeler:
 * - Adım 1 (Koru) ve Adım 2 (Gör) tamamen önizleme aşamasıdır; kapatma veya geri dönme
 *   sıfır yazma yapar (`REC-02`).
 * - Sabit zaman blokları (`lockedItems`) «Sabit blok · onaysız taşınmaz» etiketiyle
 *   ayrılır (`REC-01`).
 * - Uygulama öncesinde `evaluatePreviewFreshness` çalıştırılır; bayat önizleme yazmadan
 *   yenileme ister (`REC-04`).
 * - `commitDayPlan` sonuçlarında `committed` ile `pending` (çevrimdışı kuyruk) asla
 *   karıştırılmaz; `partial` durumda yalnız başarısız olanlar yeniden denenebilir (`REC-03`);
 *   `receipt` geri alınabilir öğe içerdiğinde `undoDayPlanCommit` sunulur (`REC-04`).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Chip, IconButton } from '../ui';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { parseLocalDate, type Ymd } from '../../lib/date';
import { dueDayOf } from '../../lib/dayClose';
import {
  SHRINK_STEP_MINUTES,
  applyPreviewItemOverride,
  buildDayPlanPreview,
  evaluatePreviewFreshness,
  previewItemKey,
  type DayPlanAction,
  type DayPlanPreview,
  type DayPlanPreviewInput,
  type FixedPlanBlock,
  type PreviewStaleReason,
  type ProtectedRef,
} from '../../lib/dayPlanPreview';
import { isPausedOn } from '../../lib/habitPauses';
import { isCountBasedSchedule, isEligibleOn, periodStatus } from '../../lib/habitSchedule';
import { newOperationId } from '../../lib/outbox';
import type { SmallStepParent } from '../../lib/smallStart';
import type { Habit, HabitLog, RecoveryPlan } from '../../lib/supabase';
import type { Task } from '../../lib/taskTypes';
import { font, hexA, radius, space, type Palette } from '../../lib/tokens';
import {
  commitDayPlan,
  retryFailedDayPlanItems,
  undoDayPlanCommit,
  type DayPlanCommitDeps,
  type DayPlanCommitResult,
  type DayPlanUndoResult,
  type PlanMutationItem,
} from '../../services/dayPlanCommitService';

export type ReplanStep = 'protect' | 'preview' | 'apply';

export interface DayReplanSheetProps {
  visible: boolean;
  userId: string;
  localDayKey: Ymd;
  nowLocalMinutes: number;
  tasks: readonly Task[];
  habits: readonly Habit[];
  todayLogs: readonly HabitLog[];
  recoveryPlans?: readonly RecoveryPlan[];
  fixedBlocks?: readonly FixedPlanBlock[];
  remainingCapacityMinutes?: number | null;
  externalCalendarConnected?: boolean;
  nowFn?: () => Date;
  commitDeps?: DayPlanCommitDeps;
  onClose: () => void;
  onApplied?: (result: DayPlanCommitResult) => void;
  onUndone?: (result: DayPlanUndoResult) => void;
  onStartSmallStep?: (parent: SmallStepParent, minutes?: number) => void;
}

type StagedReplanSnapshot = {
  readonly userId: string;
  readonly localDayKey: Ymd;
  readonly nowLocalMinutes: number;
  readonly generatedAtIso: string;
  readonly tasks: readonly Task[];
  readonly habits: readonly Habit[];
  readonly todayLogs: readonly HabitLog[];
  readonly recoveryPlans: readonly RecoveryPlan[];
  readonly fixedBlocks: readonly FixedPlanBlock[];
  readonly remainingCapacityMinutes?: number | null;
  readonly externalCalendarConnected?: boolean;
};

type StalePreviewAlert = {
  readonly reason: PreviewStaleReason;
  readonly staleItemIds: readonly string[];
};

const ACTION_LABELS: Readonly<Record<DayPlanAction, string>> = {
  keep: 'Bugün tut',
  shrink: '5 dk küçült',
  postpone_tomorrow: 'Yarına taşı',
  release_someday: "Bir Gün'e bırak",
  skip_today: 'Bugün kenara koy',
  do_not_recover: 'Telafi etme',
};

const defaultNow = (): Date => new Date();

function fallbackIsoForDay(localDayKey: Ymd, nowLocalMinutes: number): string {
  const safeMin = Math.max(0, Math.min(1439, Math.floor(nowLocalMinutes)));
  const hh = String(Math.floor(safeMin / 60)).padStart(2, '0');
  const mm = String(safeMin % 60).padStart(2, '0');
  return `${localDayKey}T${hh}:${mm}:00.000Z`;
}

function selectRepresentativeLog(
  logs: readonly HabitLog[],
  habitId: string,
  localDayKey: Ymd,
): HabitLog | undefined {
  const rank = (s: HabitLog['state']): number => {
    if (s === 'done') return 3;
    if (s === 'partial') return 2;
    if (s === 'skip') return 1;
    return 0;
  };
  let picked: HabitLog | undefined;
  for (const log of logs) {
    if (log.habit_id !== habitId || typeof log.completed_at !== 'string') continue;
    if (log.completed_at.slice(0, 10) !== localDayKey) continue;
    if (!picked || rank(log.state) >= rank(picked.state)) {
      picked = log;
    }
  }
  return picked;
}

function isProtectCandidateHabit(
  habit: Habit,
  dayDate: Date,
  localDayKey: Ymd,
  allLogs: readonly HabitLog[],
): boolean {
  if (habit.status !== 'active') return false;
  if (isPausedOn(habit, dayDate)) return false;
  if (!isEligibleOn(habit, dayDate)) return false;
  const rep = selectRepresentativeLog(allLogs, habit.id, localDayKey);
  if (rep?.state === 'done' || rep?.is_completed === true || rep?.state === 'skip') {
    return false;
  }
  if (isCountBasedSchedule(habit)) {
    const pStatus = periodStatus(habit, allLogs, dayDate, { asOf: dayDate });
    if (pStatus.status === 'satisfied' || pStatus.status === 'paused') return false;
  }
  if (
    (habit.behavior_type === 'negative' || habit.target_direction === 'at_most') &&
    rep === undefined
  ) {
    return false;
  }
  return true;
}

function mapPreviewToMutations(
  preview: DayPlanPreview,
  snapshot: StagedReplanSnapshot,
): PlanMutationItem[] {
  const items: PlanMutationItem[] = [];
  for (const ch of preview.changes) {
    if (ch.action === 'keep' || ch.action === 'shrink') {
      continue;
    }

    if (ch.sourceRef.entity === 'task') {
      if (ch.action !== 'postpone_tomorrow' && ch.action !== 'release_someday') continue;
      const origTask = snapshot.tasks.find((t) => t.id === ch.sourceRef.id);
      items.push({
        itemId: ch.changeId,
        entity: 'task',
        targetId: ch.sourceRef.id,
        title: ch.sourceRef.title,
        expectedVersion: ch.expectedVersion,
        action: ch.action,
        taskPatch:
          ch.action === 'postpone_tomorrow'
            ? {
                due_date: preview.tomorrowDayKey,
                time_block_start: null,
                time_block_end: null,
              }
            : {
                list_type: 'someday',
                due_date: null,
                time_block_start: null,
                time_block_end: null,
              },
        priorTaskSnapshot: {
          due_date: origTask?.due_date ?? ch.before.dueDate,
          list_type: origTask?.list_type ?? ch.before.listType ?? 'inbox',
          time_block_start: origTask?.time_block_start ?? ch.before.timeBlock?.start ?? null,
          time_block_end: origTask?.time_block_end ?? ch.before.timeBlock?.end ?? null,
        },
      });
      continue;
    }

    if (ch.sourceRef.entity === 'habit') {
      if (ch.action !== 'skip_today' && ch.action !== 'do_not_recover') continue;
      const repLog = selectRepresentativeLog(
        snapshot.todayLogs,
        ch.sourceRef.id,
        preview.localDayKey,
      );
      const logVer = repLog ? repLog.created_at || repLog.state : null;
      items.push({
        itemId: ch.changeId,
        entity: 'habit',
        targetId: ch.sourceRef.id,
        title: ch.sourceRef.title,
        expectedVersion: logVer,
        action: ch.action,
        priorHabitLogState: repLog?.state ?? null,
      });
      continue;
    }

    if (ch.sourceRef.entity === 'recovery_plan') {
      if (ch.action !== 'do_not_recover' && ch.action !== 'postpone_tomorrow') continue;
      const origPlan = snapshot.recoveryPlans.find((p) => p.id === ch.sourceRef.id);
      items.push({
        itemId: ch.changeId,
        entity: 'recovery_plan',
        targetId: ch.sourceRef.id,
        title: ch.sourceRef.title,
        expectedVersion: origPlan ? origPlan.status : ch.expectedVersion,
        action: ch.action,
      });
    }
  }
  return items;
}

function describeStaleReason(reason: PreviewStaleReason): string {
  switch (reason) {
    case 'day_changed':
      return 'Gün değiştiği için önizleme yenilenmeli.';
    case 'expired':
      return 'Önizleme süresi doldu; uygulamadan önce güncel durumu kontrol edelim.';
    case 'version_conflict':
    default:
      return 'Bazı görev veya alışkanlıklar önizleme açıkken başka bir yerde değişti.';
  }
}

export default function DayReplanSheet({
  visible,
  userId,
  localDayKey,
  nowLocalMinutes,
  tasks,
  habits,
  todayLogs,
  recoveryPlans = [],
  fixedBlocks = [],
  remainingCapacityMinutes,
  externalCalendarConnected,
  nowFn,
  commitDeps,
  onClose,
  onApplied,
  onUndone,
  onStartSmallStep,
}: DayReplanSheetProps) {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const { height: windowHeight } = useWindowDimensions();

  const [prevVisible, setPrevVisible] = useState(visible);
  const [step, setStep] = useState<ReplanStep>('protect');
  const [protectedRef, setProtectedRef] = useState<ProtectedRef | null>(null);
  const [itemOverrides, setItemOverrides] = useState<Readonly<Record<string, DayPlanAction>>>({});
  const [stagedSnapshot, setStagedSnapshot] = useState<StagedReplanSnapshot | null>(null);
  const [staleAlert, setStaleAlert] = useState<StalePreviewAlert | null>(null);
  const [commitResult, setCommitResult] = useState<DayPlanCommitResult | null>(null);
  const [lastMutations, setLastMutations] = useState<readonly PlanMutationItem[]>([]);
  const [undoResult, setUndoResult] = useState<DayPlanUndoResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inFlightRef = useRef(false);

  if (prevVisible !== visible) {
    setPrevVisible(visible);
    if (visible) {
      setStep('protect');
      setProtectedRef(null);
      setItemOverrides({});
      setStagedSnapshot(null);
      setStaleAlert(null);
      setCommitResult(null);
      setLastMutations([]);
      setUndoResult(null);
      setSubmitting(false);
    }
  }

  const lockedBlockIds = useMemo(
    () => new Set(fixedBlocks.filter((b) => b.locked).map((b) => b.id)),
    [fixedBlocks],
  );

  const liveMovableTasks = useMemo(
    () => tasks.filter((t) => !lockedBlockIds.has(t.id)),
    [tasks, lockedBlockIds],
  );

  const protectCandidates = useMemo(() => {
    const safeDay = parseLocalDate(localDayKey) ?? new Date(1970, 0, 1);
    const taskCandidates = liveMovableTasks
      .filter((t) => {
        if (t.completed || t.status === 'completed' || t.status === 'cancelled') return false;
        const due = dueDayOf(t.due_date);
        return due !== '' && due <= localDayKey;
      })
      .map((t) => ({
        entity: 'task' as const,
        id: t.id,
        title: t.title,
        badge: dueDayOf(t.due_date) < localDayKey ? 'Gecikmiş görev' : 'Bugünkü görev',
      }));

    const habitCandidates = habits
      .filter((h) => isProtectCandidateHabit(h, safeDay, localDayKey, todayLogs))
      .map((h) => ({
        entity: 'habit' as const,
        id: h.id,
        title: h.name,
        badge: 'Ritüel',
      }));

    return [...taskCandidates, ...habitCandidates];
  }, [liveMovableTasks, habits, localDayKey, todayLogs]);

  const effectiveSnapshot = useMemo<StagedReplanSnapshot>(() => {
    if (stagedSnapshot) return stagedSnapshot;
    return {
      userId: userId || 'anon',
      localDayKey,
      nowLocalMinutes,
      generatedAtIso: fallbackIsoForDay(localDayKey, nowLocalMinutes),
      tasks: liveMovableTasks,
      habits,
      todayLogs,
      recoveryPlans,
      fixedBlocks,
      remainingCapacityMinutes,
      externalCalendarConnected,
    };
  }, [
    stagedSnapshot,
    userId,
    localDayKey,
    nowLocalMinutes,
    liveMovableTasks,
    habits,
    todayLogs,
    recoveryPlans,
    fixedBlocks,
    remainingCapacityMinutes,
    externalCalendarConnected,
  ]);

  const basePreviewInput = useMemo<DayPlanPreviewInput>(
    () => ({
      userId: effectiveSnapshot.userId,
      localDayKey: effectiveSnapshot.localDayKey,
      nowLocalMinutes: effectiveSnapshot.nowLocalMinutes,
      generatedAtIso: effectiveSnapshot.generatedAtIso,
      protectedRef,
      fixedBlocks: effectiveSnapshot.fixedBlocks,
      tasks: effectiveSnapshot.tasks,
      habits: effectiveSnapshot.habits,
      todayLogs: effectiveSnapshot.todayLogs,
      recoveryPlans: effectiveSnapshot.recoveryPlans,
      remainingCapacityMinutes: effectiveSnapshot.remainingCapacityMinutes,
      externalCalendarConnected: effectiveSnapshot.externalCalendarConnected,
      itemOverrides,
    }),
    [effectiveSnapshot, protectedRef, itemOverrides],
  );

  const preview = useMemo<DayPlanPreview>(
    () => buildDayPlanPreview(basePreviewInput),
    [basePreviewInput],
  );

  const captureFreshSnapshot = useCallback((): StagedReplanSnapshot => {
    const nowInstant = (nowFn ?? defaultNow)();
    const snapshot: StagedReplanSnapshot = {
      userId: userId || 'anon',
      localDayKey,
      nowLocalMinutes,
      generatedAtIso: nowInstant.toISOString(),
      tasks: liveMovableTasks,
      habits,
      todayLogs,
      recoveryPlans,
      fixedBlocks,
      remainingCapacityMinutes,
      externalCalendarConnected,
    };
    setStagedSnapshot(snapshot);
    return snapshot;
  }, [
    nowFn,
    userId,
    localDayKey,
    nowLocalMinutes,
    liveMovableTasks,
    habits,
    todayLogs,
    recoveryPlans,
    fixedBlocks,
    remainingCapacityMinutes,
    externalCalendarConnected,
  ]);

  const handleGoToPreview = useCallback(() => {
    captureFreshSnapshot();
    setItemOverrides({});
    setStaleAlert(null);
    setCommitResult(null);
    setUndoResult(null);
    setStep('preview');
  }, [captureFreshSnapshot]);

  const handleSelectOverride = useCallback(
    (entity: 'task' | 'habit' | 'recovery_plan', id: string, action: DayPlanAction) => {
      const key = previewItemKey(entity, id);
      const updatedPreview = applyPreviewItemOverride(basePreviewInput, key, action);
      void updatedPreview;
      setItemOverrides((prev) => ({
        ...prev,
        [key]: action,
      }));
    },
    [basePreviewInput],
  );

  const handleRefreshPreview = useCallback(() => {
    captureFreshSnapshot();
    setItemOverrides({});
    setStaleAlert(null);
    setCommitResult(null);
    setUndoResult(null);
    setStep('preview');
  }, [captureFreshSnapshot]);

  const handleCommit = useCallback(async () => {
    if (inFlightRef.current) return;
    setStep('apply');

    const checkNow = (nowFn ?? defaultNow)();
    const freshness = evaluatePreviewFreshness(preview, {
      nowIso: checkNow.toISOString(),
      currentLocalDayKey: localDayKey,
      tasks: liveMovableTasks,
      habits,
      todayLogs,
      recoveryPlans,
    });

    if (!freshness.fresh) {
      setStaleAlert({
        reason: freshness.reason,
        staleItemIds: freshness.staleItemIds,
      });
      setCommitResult(null);
      setUndoResult(null);
      return;
    }

    setStaleAlert(null);
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const mutations = mapPreviewToMutations(preview, effectiveSnapshot);
      setLastMutations(mutations);
      const operationId = `replan_${preview.previewId}_${newOperationId()}`;
      const res = await commitDayPlan(
        {
          operationId,
          localDayKey: preview.localDayKey,
          items: mutations,
        },
        commitDeps,
      );
      setCommitResult(res);
      setUndoResult(null);
      onApplied?.(res);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [
    nowFn,
    preview,
    localDayKey,
    liveMovableTasks,
    habits,
    todayLogs,
    recoveryPlans,
    effectiveSnapshot,
    commitDeps,
    onApplied,
  ]);

  const handleRetryFailed = useCallback(async () => {
    if (!commitResult || inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const retried = await retryFailedDayPlanItems(commitResult, lastMutations, commitDeps);
      setCommitResult(retried);
      setUndoResult(null);
      onApplied?.(retried);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [commitResult, lastMutations, commitDeps, onApplied]);

  const handleUndo = useCallback(async () => {
    const receipt = commitResult?.receipt;
    if (!receipt || inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const res = await undoDayPlanCommit(receipt, commitDeps);
      setUndoResult(res);
      onUndone?.(res);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [commitResult, commitDeps, onUndone]);

  const smallStepCandidate = useMemo<SmallStepParent | null>(() => {
    const shrunkChange = preview.changes.find(
      (ch) => ch.sourceRef.entity === 'task' && ch.action === 'shrink',
    );
    if (shrunkChange) {
      return {
        kind: 'task',
        id: shrunkChange.sourceRef.id,
        title: shrunkChange.sourceRef.title,
      };
    }
    const protectedTask = preview.protectedItems.find((p) => p.sourceRef.entity === 'task');
    if (protectedTask) {
      return {
        kind: 'task',
        id: protectedTask.sourceRef.id,
        title: protectedTask.sourceRef.title,
      };
    }
    return null;
  }, [preview]);

  if (!visible) return null;

  const stepLabel =
    step === 'protect' ? '1/3 · Koru' : step === 'preview' ? '2/3 · Gör' : '3/3 · Uygula';

  const titleByItemId = new Map<string, string>();
  for (const m of lastMutations) {
    titleByItemId.set(m.itemId, m.title);
    titleByItemId.set(m.targetId, m.title);
  }
  for (const t of tasks) titleByItemId.set(t.id, t.title);
  for (const h of habits) titleByItemId.set(h.id, h.name);

  const canUndo =
    Boolean(commitResult?.receipt && commitResult.receipt.items.some((it) => it.undoable)) &&
    undoResult === null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay} testID="day-replan-sheet">
        <View style={s.sheet}>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={s.stepEyebrow} testID="replan-step-indicator">
                {stepLabel}
              </Text>
              <Text style={s.title} accessibilityRole="header">
                {step === 'protect'
                  ? 'Bugün neyi koruyalım?'
                  : step === 'preview'
                    ? 'Yeni gün planını gör'
                    : 'Günün yeni ritmi'}
              </Text>
            </View>
            <IconButton
              testID="replan-close-btn"
              icon="close"
              size={20}
              color={c.textFaint}
              label="Kapat"
              onPress={onClose}
            />
          </View>

          <ScrollView
            style={{ maxHeight: Math.round(0.68 * windowHeight) }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {step === 'protect' && (
              <View style={s.sectionGap} testID="replan-step-protect">
                <Text style={s.subtitle}>
                  Bugün ne kadarı sığar birlikte bakalım; yalnız bir işi koruyabilir veya hepsini hafifletebilirsin.
                </Text>

                <View accessibilityRole="radiogroup" accessibilityLabel="Bugün korunacak iş seçimi" style={s.radioList}>
                  <Card
                    testID="replan-protect-none"
                    padding="md"
                    selected={protectedRef === null}
                    accent={c.accent}
                    onPress={() => setProtectedRef(null)}
                    accessibilityRole="radio"
                    accessibilityLabel="Hiçbiri (hepsini hafiflet)"
                    style={s.radioRow}
                  >
                    <Ionicons
                      name={protectedRef === null ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={protectedRef === null ? c.accent : c.textFaint}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.radioTitle}>Hiçbiri (hepsini hafiflet)</Text>
                      <Text style={s.radioSub}>Kalan işleri kapasiteye göre küçült veya yarına aktar</Text>
                    </View>
                  </Card>

                  {protectCandidates.map((cand) => {
                    const selected =
                      protectedRef !== null &&
                      protectedRef.entity === cand.entity &&
                      protectedRef.id === cand.id;
                    return (
                      <Card
                        key={`${cand.entity}:${cand.id}`}
                        testID={`replan-protect-${cand.entity}-${cand.id}`}
                        padding="md"
                        selected={selected}
                        accent={c.accent}
                        onPress={() => setProtectedRef({ entity: cand.entity, id: cand.id })}
                        accessibilityRole="radio"
                        accessibilityLabel={`${cand.title} (${cand.badge})`}
                        style={s.radioRow}
                      >
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={20}
                          color={selected ? c.accent : c.textFaint}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={s.radioTitle} numberOfLines={1}>
                            {cand.title}
                          </Text>
                          <Text style={s.radioSub}>{cand.badge}</Text>
                        </View>
                      </Card>
                    );
                  })}
                </View>
              </View>
            )}

            {step === 'preview' && (
              <View style={s.sectionGap} testID="replan-step-preview">
                <View style={s.loadCard} testID="replan-load-summary">
                  <View style={s.loadHeaderRow}>
                    <Text style={s.loadLabel}>Tahmini yoğunluk</Text>
                    <View style={s.loadNumbersRow}>
                      <Text style={s.loadValue} testID="replan-load-before">
                        {String(preview.loadBefore)}
                      </Text>
                      <Text style={s.loadArrow}>→</Text>
                      <Text style={[s.loadValue, { color: c.success }]} testID="replan-load-after">
                        {String(preview.loadAfter)}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.loadHint}>
                    {`Tahmini yük: ${preview.loadBefore} -> ${preview.loadAfter} · sağlık puanı değil, bugünkü yoğunluk tahmini`}
                  </Text>
                </View>

                {preview.lockedItems.length > 0 && (
                  <View style={s.groupBox} testID="replan-locked-section">
                    <Text style={s.groupOverline}>SABİT VE TAMAMLANANLAR</Text>
                    {preview.lockedItems.map((item) => (
                      <View
                        key={`${item.kind}:${item.id}`}
                        style={s.itemCard}
                        testID={`replan-locked-${item.id}`}
                      >
                        <View style={s.itemTopRow}>
                          <Ionicons name="lock-closed-outline" size={16} color={c.accent} />
                          <Text style={s.itemTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          {item.timeBlock && (
                            <View style={s.timePill} testID={`replan-locked-time-${item.id}`}>
                              <Text style={s.timePillText}>
                                {item.timeBlock.end
                                  ? `${item.timeBlock.start}–${item.timeBlock.end}`
                                  : item.timeBlock.start}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.lockedBadge}>
                          {item.kind === 'fixed_block'
                            ? 'Sabit blok · onaysız taşınmaz'
                            : item.displayReason}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {preview.protectedItems.length > 0 && (
                  <View style={s.groupBox} testID="replan-protected-section">
                    <Text style={s.groupOverline}>BUGÜN KORUNAN ODAK</Text>
                    {preview.protectedItems.map((pItem) => (
                      <View
                        key={`${pItem.sourceRef.entity}:${pItem.sourceRef.id}`}
                        style={s.itemCard}
                        testID={`replan-protected-${pItem.sourceRef.id}`}
                      >
                        <View style={s.itemTopRow}>
                          <Ionicons name="shield-checkmark-outline" size={16} color={c.success} />
                          <Text style={s.itemTitle} numberOfLines={1}>
                            {pItem.sourceRef.title}
                          </Text>
                        </View>
                        <Text style={s.itemReason}>{pItem.displayReason}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={s.groupBox} testID="replan-changes-section">
                  <Text style={s.groupOverline}>ÖNERİLEN DÜZENLEMELER</Text>
                  {preview.changes.length === 0 ? (
                    <Text style={s.emptyText} testID="replan-no-changes">
                      Değiştirilecek açık iş kalmadı; bugünün akışı zaten sade.
                    </Text>
                  ) : (
                    preview.changes.map((ch) => (
                      <View
                        key={`${ch.sourceRef.entity}:${ch.sourceRef.id}`}
                        style={s.itemCard}
                        testID={`replan-change-${ch.sourceRef.entity}-${ch.sourceRef.id}`}
                      >
                        <Text style={s.itemTitle} numberOfLines={1}>
                          {ch.sourceRef.title}
                        </Text>
                        <Text style={s.itemReason}>{ch.displayReason}</Text>
                        <View
                          style={s.pillsRow}
                          accessibilityRole="radiogroup"
                          accessibilityLabel={`${ch.sourceRef.title} için karar`}
                        >
                          {ch.availableActions.map((act) => {
                            const active = ch.action === act;
                            return (
                              <Chip
                                key={act}
                                testID={`replan-action-${ch.sourceRef.entity}-${ch.sourceRef.id}-${act}`}
                                label={ACTION_LABELS[act]}
                                color={c.accent}
                                selected={active}
                                onPress={() =>
                                  handleSelectOverride(ch.sourceRef.entity, ch.sourceRef.id, act)
                                }
                                accessibilityRole="radio"
                                accessibilityLabel={`${ch.sourceRef.title}: ${ACTION_LABELS[act]}`}
                              />
                            );
                          })}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </View>
            )}

            {step === 'apply' && (
              <View style={s.sectionGap} testID="replan-step-apply">
                {staleAlert && (
                  <View
                    style={s.alertCard}
                    testID="replan-stale-alert"
                    accessibilityRole="alert"
                  >
                    <Text style={s.alertTitle}>Önizleme güncelliğini yitirdi</Text>
                    <Text style={s.itemReason}>{describeStaleReason(staleAlert.reason)}</Text>
                    {staleAlert.staleItemIds.length > 0 && (
                      <Text style={s.staleIdsText} testID="replan-stale-ids">
                        {staleAlert.staleItemIds
                          .map((id) => titleByItemId.get(id) ?? id)
                          .join(', ')}
                      </Text>
                    )}
                    <Button
                      testID="replan-refresh-btn"
                      label="Önizlemeyi yenile"
                      size="md"
                      onPress={handleRefreshPreview}
                      accessibilityLabel="Önizlemeyi yenile"
                    />
                  </View>
                )}

                {commitResult && (
                  <View
                    style={s.outcomeCard}
                    testID={`replan-outcome-${commitResult.overall}`}
                  >
                    {commitResult.overall === 'committed' && (
                      <Text style={s.outcomeTitleOk} testID="replan-status-committed">
                        Değişiklikler kaydedildi
                      </Text>
                    )}

                    {commitResult.overall === 'pending' && (
                      <Text style={s.outcomeTitleWarn} testID="replan-status-pending">
                        Çevrimdışı kuyrukta bekliyor — bağlantı gelince uygulanacak
                      </Text>
                    )}

                    {commitResult.overall === 'partial' && (
                      <View style={s.sectionGap} testID="replan-status-partial">
                        <Text style={s.outcomeTitleWarn}>
                          Bazı değişiklikler kaydedildi, kalanlar yeniden denenebilir
                        </Text>
                        {commitResult.results.map((r) => {
                          const ok = r.status === 'committed' || r.status === 'pending';
                          const label = titleByItemId.get(r.itemId) ?? titleByItemId.get(r.targetId) ?? r.targetId;
                          return (
                            <View
                              key={r.itemId}
                              style={s.resultRow}
                              testID={`replan-result-${r.targetId}-${r.status}`}
                            >
                              <Ionicons
                                name={ok ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                                size={16}
                                color={ok ? c.success : c.warning}
                              />
                              <Text style={s.resultText} numberOfLines={2}>
                                {`${label} — ${
                                  r.status === 'committed'
                                    ? 'uygulandı'
                                    : r.status === 'pending'
                                      ? 'kuyrukta bekliyor'
                                      : r.error ?? 'uygulanamadı'
                                }`}
                              </Text>
                            </View>
                          );
                        })}
                        <Button
                          testID="replan-retry-failed-btn"
                          label="Yalnız kalanları yeniden dene"
                          size="md"
                          disabled={submitting}
                          onPress={() => {
                            void handleRetryFailed();
                          }}
                          accessibilityLabel="Yalnız kalanları yeniden dene"
                        />
                      </View>
                    )}

                    {commitResult.overall === 'conflict' && (
                      <View style={s.sectionGap} testID="replan-status-conflict">
                        <Text style={s.alertTitle}>
                          Bazı öğeler başka bir yerde güncellendiği için üzerine yazılmadı
                        </Text>
                        {commitResult.results
                          .filter((r) => r.status === 'conflict')
                          .map((r) => (
                            <Text
                              key={r.itemId}
                              style={s.itemReason}
                              testID={`replan-conflict-item-${r.targetId}`}
                            >
                              {titleByItemId.get(r.itemId) ?? titleByItemId.get(r.targetId) ?? r.targetId}
                            </Text>
                          ))}
                        <Button
                          testID="replan-refresh-btn"
                          label="Önizlemeyi yenile"
                          size="md"
                          onPress={handleRefreshPreview}
                          accessibilityLabel="Önizlemeyi yenile"
                        />
                      </View>
                    )}

                    {commitResult.overall === 'aborted' && (
                      <Text style={s.alertTitle} testID="replan-status-aborted">
                        Gün veya oturum değiştiği için işlem durduruldu
                      </Text>
                    )}

                    {canUndo && (
                      <Button
                        testID="replan-undo-btn"
                        label="Geri al"
                        variant="ghost"
                        size="md"
                        icon="arrow-undo-outline"
                        color={c.text}
                        disabled={submitting}
                        onPress={() => {
                          void handleUndo();
                        }}
                        accessibilityLabel="Değişiklikleri geri al"
                      />
                    )}

                    {undoResult && (
                      <View
                        style={s.undoReportBox}
                        testID={`replan-undo-outcome-${undoResult.overall}`}
                      >
                        <Text style={s.itemReason} testID="replan-undo-summary">
                          {undoResult.undoneItemIds.length > 0
                            ? `${undoResult.undoneItemIds.length} değişiklik geri alındı.`
                            : 'Geri alınacak değişiklik uygulanmadı.'}
                        </Text>
                        {undoResult.skippedConflictIds.length > 0 && (
                          <Text style={s.staleIdsText} testID="replan-undo-skipped-conflicts">
                            {`Sonradan değiştiği için korunup atlanan: ${undoResult.skippedConflictIds
                              .map((id) => titleByItemId.get(id) ?? id)
                              .join(', ')}`}
                          </Text>
                        )}
                      </View>
                    )}

                    {smallStepCandidate && onStartSmallStep && (
                      <Button
                        testID="replan-start-small-btn"
                        label="5 dk küçük adımla başla"
                        variant="tonal"
                        size="md"
                        icon="play-outline"
                        color={c.accent}
                        onPress={() => {
                          onStartSmallStep(smallStepCandidate, SHRINK_STEP_MINUTES);
                          onClose();
                        }}
                        accessibilityLabel={`${smallStepCandidate.title} için 5 dakika küçük adımla başla`}
                      />
                    )}
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          <View style={s.footerRow}>
            {step === 'protect' && (
              <>
                <Button
                  testID="replan-cancel-btn"
                  label="Kapat"
                  variant="ghost"
                  size="md"
                  color={c.textDim}
                  full
                  onPress={onClose}
                  accessibilityLabel="Kapat"
                />
                <Button
                  testID="replan-next-preview-btn"
                  label="Devam et: Planı gör"
                  size="md"
                  full
                  onPress={handleGoToPreview}
                  accessibilityLabel="Devam et: Planı gör"
                />
              </>
            )}

            {step === 'preview' && (
              <>
                <Button
                  testID="replan-back-btn"
                  label="Geri"
                  variant="ghost"
                  size="md"
                  color={c.textDim}
                  full
                  onPress={() => setStep('protect')}
                  accessibilityLabel="Geri"
                />
                <Button
                  testID="replan-apply-btn"
                  label={submitting ? 'Uygulanıyor…' : 'Uygula'}
                  size="md"
                  full
                  disabled={submitting}
                  onPress={() => {
                    void handleCommit();
                  }}
                  accessibilityLabel="Uygula"
                />
              </>
            )}

            {step === 'apply' && (
              <Button
                testID="replan-done-btn"
                label="Tamam"
                size="md"
                full
                onPress={onClose}
                accessibilityLabel="Tamam"
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: hexA(c.black, 0.62),
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: c.bgElevated,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
    },
    stepEyebrow: {
      ...font.overline,
      color: c.accent,
      marginBottom: space.xs,
    },
    title: {
      ...font.h2,
      color: c.text,
    },
    subtitle: {
      ...font.bodySm,
      color: c.textDim,
      lineHeight: 20,
    },
    sectionGap: {
      gap: space.md,
    },
    radioList: {
      gap: space.sm,
    },
    radioRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      minHeight: 52,
    },
    radioTitle: {
      ...font.bodySm,
      fontWeight: '700',
      color: c.text,
    },
    radioSub: {
      ...font.caption,
      color: c.textDim,
      marginTop: space.xs,
    },
    loadCard: {
      padding: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      gap: space.xs,
    },
    loadHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    loadLabel: {
      ...font.bodySm,
      fontWeight: '700',
      color: c.text,
    },
    loadNumbersRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    loadValue: {
      ...font.h3,
      color: c.text,
    },
    loadArrow: {
      ...font.bodySm,
      color: c.textFaint,
    },
    loadHint: {
      ...font.caption,
      color: c.textDim,
      lineHeight: 17,
    },
    groupBox: {
      gap: space.sm,
    },
    groupOverline: {
      ...font.overline,
      color: c.textFaint,
    },
    itemCard: {
      padding: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      gap: space.xs,
    },
    itemTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },
    itemTitle: {
      ...font.bodySm,
      fontWeight: '700',
      color: c.text,
      flex: 1,
    },
    timePill: {
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.sm,
      backgroundColor: c.surfaceAlt,
    },
    timePillText: {
      ...font.caption,
      fontWeight: '700',
      color: c.accent,
    },
    lockedBadge: {
      ...font.caption,
      color: c.accent,
      fontWeight: '600',
    },
    itemReason: {
      ...font.caption,
      color: c.textDim,
      lineHeight: 17,
    },
    emptyText: {
      ...font.bodySm,
      color: c.textDim,
    },
    pillsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.xs,
      marginTop: space.xs,
    },
    alertCard: {
      padding: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.warning,
      backgroundColor: c.surface,
      gap: space.sm,
    },
    alertTitle: {
      ...font.bodySm,
      fontWeight: '700',
      color: c.warning,
    },
    staleIdsText: {
      ...font.caption,
      color: c.text,
      fontWeight: '600',
    },
    outcomeCard: {
      padding: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      gap: space.md,
    },
    outcomeTitleOk: {
      ...font.body,
      fontWeight: '700',
      color: c.success,
    },
    outcomeTitleWarn: {
      ...font.body,
      fontWeight: '700',
      color: c.warning,
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },
    resultText: {
      ...font.caption,
      color: c.text,
      flex: 1,
    },
    undoReportBox: {
      paddingTop: space.xs,
      gap: space.xs,
    },
    footerRow: {
      flexDirection: 'row',
      gap: space.sm,
      marginTop: space.xs,
    },
  });
