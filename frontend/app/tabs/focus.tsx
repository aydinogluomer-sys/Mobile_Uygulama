import { useEffect, useRef, useCallback, useState } from 'react';
import {
  Animated, Easing, View, Text, StyleSheet, TouchableOpacity,
  ScrollView, AppState, type AppStateStatus,
  TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useFocusStore } from '../../store/focusStore';
import { FormError, IconButton, ProgressRing } from '../../components/ui';
import { EmbeddedFiligree } from '../../components/spatial';
import { haptic } from '../../lib/haptics';
import { fontFamily, alphaHex, hexA, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { DECOR, getFocusBackdrop } from '../../lib/visualAssets';
import { useReducedMotion } from '../../components/seasonalMotion/useReducedMotion';
import { spokenDuration, useTimerAnnouncements } from '../../hooks/useTimerAnnouncements';


import DeepWorkScreen from '../screens/deep-work';
import FocusReportModal from '../../components/focus/FocusReportModal';
import FocusThemeModal from '../../components/focus/FocusThemeModal';
import FocusSettingsModal from '../../components/focus/FocusSettingsModal';
import FocusSpotifyCard from '../../components/focus/FocusSpotifyCard';
import FocusSessionCompleteModal from '../../components/focus/FocusSessionCompleteModal';
import FocusIntentSheet from '../../components/focus/FocusIntentSheet';
import InterruptionPrompt from '../../components/focus/InterruptionPrompt';
import { FOCUS_PRESETS } from '../../lib/focusThemes';
import { FLOW_COPY, isBackFromFocusBreak } from '../../lib/flowCopy';
import { progressFraction } from '../../lib/focusTimer';
import { t } from '../../lib/i18n';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

const PHASE_COLOR_KEYS: Record<'work' | 'shortBreak' | 'longBreak', keyof Palette> = {
  work: 'primary',
  shortBreak: 'success',
  longBreak: 'info',
};

function pad(n: number) { return String(n).padStart(2, '0'); }

export default function FocusScreen() {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const {
    phase, status, secondsLeft, sessionsCompleted, selectedTaskId,
    focusTasks, settings, justCompleted, clock, smallStep,
    start, pause, reset, setPhase,
    fetchFocusTasks, addFocusTask, removeFocusTask, completeFocusTask, selectTask,
    updateSettings, loadSettings, restoreSession, clearJustCompleted,
  } = useFocusStore(
    useShallow((st) => ({
      phase: st.phase,
      status: st.status,
      secondsLeft: st.secondsLeft,
      sessionsCompleted: st.sessionsCompleted,
      selectedTaskId: st.selectedTaskId,
      focusTasks: st.focusTasks,
      settings: st.settings,
      justCompleted: st.justCompleted,
      clock: st.clock,
      smallStep: st.smallStep,
      start: st.start,
      pause: st.pause,
      reset: st.reset,
      setPhase: st.setPhase,
      fetchFocusTasks: st.fetchFocusTasks,
      addFocusTask: st.addFocusTask,
      removeFocusTask: st.removeFocusTask,
      completeFocusTask: st.completeFocusTask,
      selectTask: st.selectTask,
      updateSettings: st.updateSettings,
      loadSettings: st.loadSettings,
      restoreSession: st.restoreSession,
      clearJustCompleted: st.clearJustCompleted,
    })),
  );
  const lastPartial = useFocusStore((st) => st.lastPartial);
  const pendingAway = useFocusStore((st) => st.interruptions.pendingAwayMs);

  const reduceMotion = useReducedMotion();
  const [haloAnim] = useState(() => new Animated.Value(0));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (IS_TEST || reduceMotion || status !== 'running') {
      haloAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(haloAnim, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(haloAnim, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [haloAnim, reduceMotion, status]);
  const appStateRef = useRef(AppState.currentState);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showTheme, setShowTheme] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPomodoros, setNewTaskPomodoros] = useState(1);
  const [addTaskError, setAddTaskError] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [startHint, setStartHint] = useState('');
  const [focusMode, setFocusMode] = useState<'timer' | 'deep_work'>('timer');
  const [showIntent, setShowIntent] = useState(false);
  const [lastIntent, setLastIntent] = useState<string | null>(null);

  const activePreset = FOCUS_PRESETS.find((p) => p.id === settings.presetId) ?? FOCUS_PRESETS[0];
  const phaseColorKey = PHASE_COLOR_KEYS[phase as keyof typeof PHASE_COLOR_KEYS] ?? 'primary';
  const phaseColor = activePreset.id === 'default' ? colors[phaseColorKey] : activePreset.accent;

  const customDurations = {
    work: settings.workMinutes * 60,
    shortBreak: settings.shortBreakMinutes * 60,
    longBreak: settings.longBreakMinutes * 60,
  };
  // The open session's own plan (a small step, or settings edited mid-session),
  // else the configured length.
  const totalSeconds = clock?.plannedSeconds ?? customDurations[phase as keyof typeof customDurations];
  const progressPct = progressFraction(totalSeconds, secondsLeft) * 100;
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  const PHASE_LABELS: Record<string, string> = {
    work: t('focus.phase.work'),
    shortBreak: t('focus.phase.shortBreak'),
    longBreak: t('focus.phase.longBreak'),
  };

  const PHASE_SPOKEN: Record<string, string> = {
    work: t('focus.phase.spoken.work'),
    shortBreak: t('focus.phase.spoken.shortBreak'),
    longBreak: t('focus.phase.spoken.longBreak'),
  };

  useTimerAnnouncements({
    running: status === 'running',
    secondsLeft,
    phaseKey: phase,
    phaseLabel: PHASE_SPOKEN[phase] ?? t('focus.phase.spoken.work'),
  });

  // R05.03 — a session the app was killed in comes back paused.
  useEffect(() => { fetchFocusTasks(); loadSettings(); restoreSession(); }, [fetchFocusTasks, loadSettings, restoreSession]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  useEffect(() => {
    if (status === 'running') {
      intervalRef.current = setInterval(() => { useFocusStore.getState().tick(); }, 1000);
    } else { stopInterval(); }
    return stopInterval;
  }, [status, stopInterval]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev === 'active' && next !== 'active') { useFocusStore.getState().onBackground(); return; }
      if (prev !== 'active' && next === 'active') { useFocusStore.getState().onForeground(); }
    });
    return () => sub.remove();
  }, []);

  useFocusEffect(
    useCallback(() => () => {
      useFocusStore.getState().classifyAway(null);
    }, []),
  );

  const selectedTask = focusTasks.find((t) => t.id === selectedTaskId);

  async function handleAddTask() {
    if (!newTaskTitle.trim()) return;
    const r = await addFocusTask(newTaskTitle.trim(), newTaskPomodoros);
    if (!r.ok) {
      setAddTaskError(r.error);
      return;
    }
    setAddTaskError(null);
    setStartHint('');
    setNewTaskTitle('');
    setNewTaskPomodoros(1);
    setShowAddTask(false);
  }

  function beginSession(text: string | null) {
    setShowIntent(false);
    void useFocusStore.getState().setIntent(text);
    setStartHint('');
    haptic.medium();
    start();
  }

  function handleStartPause() {
    if (status === 'running') { haptic.light(); pause(); return; }
    // Çalışma fazında: önce ne üzerine odaklanılacağı eklenip seçilmeli.
    // R03.03 — a small step already names what it is about.
    if (phase === 'work' && !selectedTaskId && !smallStep) {
      haptic.light();
      if (focusTasks.length === 0) {
        setStartHint(t('focus.hint.addFirst'));
        setAddTaskError(null);
        setShowAddTask(true);
      } else {
        setStartHint(t('focus.hint.selectFirst'));
      }
      return;
    }
    if (phase === 'work' && status === 'idle' && !smallStep && settings.intentPrompt) {
      haptic.light();
      setLastIntent(null);
      setShowIntent(true);
      void useFocusStore
        .getState()
        .loadLastIntent()
        .then((t) => {
          setLastIntent(t);
        })
        .catch(() => {});
      return;
    }
    setStartHint('');
    haptic.medium();
    start();
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: activePreset.bg }]} edges={['bottom']}>
      {focusMode === 'timer' && (
        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          {...(Platform.OS === 'web'
            ? { 'aria-hidden': true }
            : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
        >
          <Image
            source={getFocusBackdrop(activePreset.id)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={260}
            cachePolicy="memory-disk"
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.34 + settings.overlayOpacity) }]} />
        </View>
      )}

      {/* Görünüm Geçişi: Pomodoro Zamanlayıcı vs Derin Çalışma */}
      <View style={s.topBar}>
        <View style={s.viewSwitch}>
          <TouchableOpacity
            style={[s.viewBtn, focusMode === 'timer' && s.viewBtnActive]}
            onPress={() => { haptic.select(); setFocusMode('timer'); }}
            accessibilityRole="button"
            accessibilityLabel={t('focus.mode.timer.a11y')}
          >
            <Ionicons name="timer-outline" size={14} color={focusMode === 'timer' ? colors.primary : colors.textDim} />
            <Text style={[s.viewText, focusMode === 'timer' && s.viewTextActive]}>{t('focus.mode.timer')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.viewBtn, focusMode === 'deep_work' && s.viewBtnActive]}
            onPress={() => { haptic.select(); setFocusMode('deep_work'); }}
            accessibilityRole="button"
            accessibilityLabel={t('focus.mode.deepWork.a11y')}
          >
            <Ionicons name="flash-outline" size={14} color={focusMode === 'deep_work' ? colors.primary : colors.textDim} />
            <Text style={[s.viewText, focusMode === 'deep_work' && s.viewTextActive]}>{t('focus.mode.deepWork')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {focusMode === 'deep_work' ? (
        <View style={{ flex: 1 }}>
          <DeepWorkScreen />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>

        {/* Üst araç çubuğu */}
        <View style={s.topRow}>
          <View style={s.phaseRow} accessibilityRole="tablist">
            {(['work', 'shortBreak', 'longBreak'] as const).map((p) => {
              const active = phase === p;
              const col = active ? phaseColor : colors.textFaint;
              return (
                <TouchableOpacity
                  key={p}
                  style={[s.phaseBtn, active && { backgroundColor: alphaHex(phaseColor, '22'), borderColor: phaseColor }]}
                  onPress={() => { haptic.select(); setPhase(p); }}
                  accessibilityRole="tab"
                  accessibilityLabel={PHASE_LABELS[p]}
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[s.phaseBtnText, { color: col }]}>
                    {p === 'work'
                      ? t('focus.phase.short.work')
                      : p === 'shortBreak'
                        ? t('focus.phase.short.shortBreak')
                        : t('focus.phase.short.longBreak')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <IconButton
            compact
            icon="color-palette-outline"
            size={18}
            color={colors.textFaint}
            label={t('focus.toolbar.theme.a11y')}
            style={s.settingsBtn}
            onPress={() => setShowTheme(true)}
          />
          <IconButton
            compact
            icon="stats-chart-outline"
            size={18}
            color={colors.textFaint}
            label={t('focus.toolbar.reports.a11y')}
            style={s.settingsBtn}
            onPress={() => setShowReport(true)}
          />
          <IconButton
            compact
            icon="settings-outline"
            size={18}
            color={colors.textFaint}
            label={t('focus.toolbar.settings.a11y')}
            style={s.settingsBtn}
            onPress={() => setShowSettings(true)}
          />
        </View>

        {/* Timer kartı */}
        <View style={[s.timerCard, { backgroundColor: activePreset.cardBg, borderColor: alphaHex(phaseColor, '40') }]}>
          {/* Ring progress — gerçek SVG yay */}
          <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={142} opacity={0.14} />
          <View style={s.ringWrap}>
            {status === 'running' && !IS_TEST && !reduceMotion && (
              <Animated.View
                pointerEvents="none"
                style={[
                  s.breathHalo,
                  {
                    borderColor: hexA(phaseColor, 0.42),
                    backgroundColor: hexA(phaseColor, 0.08),
                    opacity: haloAnim.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0.78] }),
                    transform: [{ scale: haloAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.12] }) }],
                  },
                ]}
              />
            )}
            <ProgressRing progress={progressPct / 100} size={200} stroke={12} color={phaseColor}>
              <View
                style={s.timerInner}
                accessible
                accessibilityRole="timer"
                accessibilityLabel={t('focus.timer.remaining.a11y', {
                  phase: PHASE_SPOKEN[phase] ?? t('focus.phase.spoken.work'),
                  duration: spokenDuration(secondsLeft),
                })}
              >
                <Text
                  style={[s.timerText, { color: phaseColor }]}
                  importantForAccessibility="no"
                  maxFontSizeMultiplier={1.25}
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  minimumFontScale={0.7}
                >
                  {pad(mins)}:{pad(secs)}
                </Text>
                <Text style={s.phaseLabel} maxFontSizeMultiplier={1.4}>{PHASE_LABELS[phase]}</Text>
              </View>
            </ProgressRing>
          </View>

          {/* R03.03 — a small step shows itself and its task, kept apart */}
          {smallStep ? (
            <View style={[s.selectedTask, { borderColor: alphaHex(phaseColor, '40'), flexDirection: 'column', alignItems: 'flex-start', gap: 2 }]}>
              <Text style={s.stepEyebrow}>{t('focus.smallStep.eyebrow', { minutes: smallStep.minutes })}</Text>
              <Text style={s.selectedTaskTitle} numberOfLines={2}>{smallStep.title}</Text>
              <Text style={s.stepParent} numberOfLines={1}>{t('focus.smallStep.parent', { title: smallStep.parent.title })}</Text>
            </View>
          ) : selectedTask ? (
            <View style={[s.selectedTask, { borderColor: alphaHex(phaseColor, '40') }]}>
              <View style={[s.selectedTaskDot, { backgroundColor: phaseColor }]} />
              <Text style={s.selectedTaskTitle} numberOfLines={1}>{selectedTask.title}</Text>
              <Text style={s.pomodoroCount}>
                {selectedTask.completed_pomodoros}/{selectedTask.estimated_pomodoros}
              </Text>
            </View>
          ) : (
            <Text style={s.noTaskHint}>{t('focus.noTaskHint')}</Text>
          )}

          {sessionsCompleted > 0 && (
            <Text style={s.sessionCount}>{t('focus.sessionsCompleted', { count: sessionsCompleted })}</Text>
          )}
          {lastPartial ? (
            <Text style={s.sessionCount} accessibilityLiveRegion="polite">
              {t('focus.partialSaved', { minutes: Math.max(1, Math.floor(lastPartial.seconds / 60)) })}
            </Text>
          ) : null}
          {/* R03.07 — "mola sonrası dön" */}
          {isBackFromFocusBreak({ phase, status, sessionsCompleted }) && (
            <Text style={s.sessionCount} accessibilityLiveRegion="polite">{FLOW_COPY.afterFocusBreak}</Text>
          )}
        </View>

        <InterruptionPrompt
          visible={pendingAway !== null && phase === 'work'}
          accent={phaseColor}
          onChoose={(cause) => useFocusStore.getState().classifyAway(cause)}
        />

        {/* Kontroller */}
        {(() => {
          const gated = status !== 'running' && phase === 'work' && !selectedTaskId;
          const startLabel =
            status === 'running'
              ? t('focus.controls.pause')
              : status === 'paused'
                ? t('focus.controls.resume.a11y')
                : gated
                  ? t('focus.controls.selectTopic.a11y')
                  : t('focus.controls.start');
          return (
            <>
              <View style={s.controls}>
                <IconButton
                  icon="refresh-outline"
                  size={22}
                  color={colors.textDim}
                  label={t('focus.controls.reset.a11y')}
                  style={[s.resetBtn, { backgroundColor: activePreset.cardBg }]}
                  onPress={() => { haptic.light(); reset(); }}
                />

                <TouchableOpacity
                  style={[s.startBtn, { backgroundColor: phaseColor }, gated && s.startBtnGated]}
                  onPress={handleStartPause}
                  accessibilityRole="button"
                  accessibilityLabel={startLabel}
                  accessibilityHint={gated ? t('focus.controls.gatedHint.a11y') : undefined}
                >
                  <Ionicons name={status === 'running' ? 'pause' : gated ? 'lock-closed' : 'play'} size={gated ? 22 : 28} color={colors.white} />
                  <Text style={s.startBtnText}>
                    {status === 'running'
                      ? t('focus.controls.pause')
                      : status === 'paused'
                        ? t('focus.controls.resume')
                        : gated
                          ? t('focus.controls.selectTopic')
                          : t('focus.controls.start')}
                  </Text>
                </TouchableOpacity>
              </View>
              {startHint && !selectedTaskId ? <Text style={s.startHint}>{startHint}</Text> : null}
            </>
          );
        })()}

        {/* Spotify mini oynatıcı */}
        <FocusSpotifyCard />

        {/* Görev listesi */}
        <View style={s.taskSection}>
          <View style={s.taskSectionHeader}>
            <Text style={s.sectionTitle}>{t('focus.topic.overline')}</Text>
            <TouchableOpacity
              style={s.addTaskBtn}
              onPress={() => { setAddTaskError(null); setShowAddTask(true); }}
              accessibilityRole="button"
              accessibilityLabel={t('focus.topic.add.a11y')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="add" size={16} color={phaseColor} />
              <Text style={[s.addTaskText, { color: phaseColor }]}>{t('focus.topic.add')}</Text>
            </TouchableOpacity>
          </View>
          <FormError message={taskActionError} />

          {focusTasks.length === 0 ? (
            <View style={s.emptyTasks}>
              <Text style={s.emptyTasksText}>{t('focus.topic.empty')}</Text>
            </View>
          ) : (
            focusTasks.map((task) => {
              const isSelected = selectedTaskId === task.id;
              return (
                <View key={task.id} style={[s.taskRow, { backgroundColor: activePreset.cardBg }, isSelected && { borderColor: alphaHex(phaseColor, '60') }]}>
                  <TouchableOpacity
                    style={s.taskCheck}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="checkbox"
                    accessibilityLabel={t('focus.topic.complete.a11y', { title: task.title })}
                    accessibilityState={{ checked: Boolean(task.completed) }}
                    onPress={async () => {
                      const r = await completeFocusTask(task.id);
                      if (r.ok) {
                        haptic.success();
                        setTaskActionError(null);
                      } else {
                        setTaskActionError(r.error);
                      }
                    }}
                  >
                    <View style={[s.checkBox, { borderColor: phaseColor }]} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={s.taskBody}
                    onPress={() => {
                      selectTask(isSelected ? null : task.id);
                      if (!isSelected) setStartHint('');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('focus.topic.item.a11y', {
                      title: task.title,
                      completed: task.completed_pomodoros,
                      estimated: task.estimated_pomodoros,
                    })}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text style={[s.taskTitle, isSelected && { color: colors.text, fontWeight: '600' }]} numberOfLines={1}>
                      {task.title}
                    </Text>
                    <View style={s.taskMeta}>
                      {Array.from({ length: task.estimated_pomodoros }).map((_, i) => (
                        <View key={i} style={[s.pomDot, i < task.completed_pomodoros && { backgroundColor: phaseColor }]} />
                      ))}
                    </View>
                  </TouchableOpacity>

                  <IconButton
                    compact
                    icon="close"
                    size={16}
                    color={colors.textGhost}
                    label={t('focus.topic.delete.a11y', { title: task.title })}
                    style={s.taskDelete}
                    onPress={() => {
                      void removeFocusTask(task.id).then((r) => {
                        setTaskActionError(r.ok ? null : r.error);
                      });
                    }}
                  />
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
      )}

      {/* Görev ekle modal */}
      <Modal visible={showAddTask} transparent animationType="slide" onRequestClose={() => setShowAddTask(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>{t('focus.sheet.title')}</Text>
            <TextInput
              style={s.input}
              placeholder={t('focus.sheet.placeholder')}
              placeholderTextColor={colors.textFaint}
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
              autoFocus
            />
            <Text style={s.fieldLabel}>{t('focus.sheet.estimatedPomodoros')}</Text>
            <View style={s.pomRow} accessibilityRole="radiogroup">
              {[1,2,3,4,5].map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[s.pomBtn, newTaskPomodoros === n && { backgroundColor: alphaHex(phaseColor, '30'), borderColor: phaseColor }]}
                  onPress={() => setNewTaskPomodoros(n)}
                  accessibilityRole="radio"
                  accessibilityLabel={t('focus.pomodoroCount', { count: n })}
                  accessibilityState={{ selected: newTaskPomodoros === n, checked: newTaskPomodoros === n }}
                >
                  <Text style={[s.pomBtnText, newTaskPomodoros === n && { color: phaseColor }]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <FormError message={addTaskError} />
            <View style={s.sheetActions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setShowAddTask(false)}
                accessibilityRole="button"
                accessibilityLabel={t('focus.sheet.cancel')}
              >
                <Text style={s.cancelText}>{t('focus.sheet.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmBtn, { backgroundColor: phaseColor }, !newTaskTitle.trim() && s.confirmBtnDisabled]}
                onPress={handleAddTask}
                disabled={!newTaskTitle.trim()}
                accessibilityRole="button"
                accessibilityLabel={t('focus.sheet.save.a11y')}
                accessibilityState={{ disabled: !newTaskTitle.trim() }}
              >
                <Text style={s.confirmText}>{t('focus.topic.add')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <FocusIntentSheet
        visible={showIntent}
        initialText={lastIntent}
        accent={phaseColor}
        onSubmit={beginSession}
        onSkip={() => beginSession(null)}
        onDisable={() => {
          updateSettings({ intentPrompt: false });
          beginSession(null);
        }}
      />

      {/* Ayarlar */}
      <FocusSettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        accent={phaseColor}
        onSave={(patch) => updateSettings(patch)}
        onOpenTheme={() => { setShowSettings(false); setShowTheme(true); }}
      />

      {/* Raporlar */}
      <FocusReportModal visible={showReport} onClose={() => setShowReport(false)} accent={phaseColor} />

      {/* Seans tamamlandı → rapor görünümü */}
      <FocusSessionCompleteModal
        visible={!!justCompleted}
        session={justCompleted}
        accent={phaseColor}
        onClose={clearJustCompleted}
        onOpenReport={() => { clearJustCompleted(); setShowReport(true); }}
      />

      {/* Tema */}
      <FocusThemeModal
        visible={showTheme}
        onClose={() => setShowTheme(false)}
        presetId={settings.presetId}
        overlay={settings.overlayOpacity}
        onSelectPreset={(id) => updateSettings({ presetId: id })}
        onSelectOverlay={(v) => updateSettings({ overlayOpacity: v })}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1 },

  topBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  viewSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  viewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 9,
    gap: 6,
  },
  viewBtnActive: {
    backgroundColor: alphaHex(colors.primary, '20'),
    borderColor: colors.primary,
    borderWidth: 1,
  },
  viewText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textDim,
  },
  viewTextActive: {
    color: colors.primary,
  },

  content: { padding: 20, paddingBottom: 40 },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  phaseRow: { flex: 1, flexDirection: 'row', gap: 6 },
  phaseBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  phaseBtnText: { fontSize: 12, fontWeight: '600' },
  settingsBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },

  presetsRow: { marginBottom: 16, maxHeight: 38 },
  presetsContent: { gap: 8 },
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  presetDot: { width: 8, height: 8, borderRadius: 4 },
  presetLabel: { fontSize: 12, color: colors.textFaint, fontWeight: '500' },

  timerCard: {
    overflow: 'hidden', position: 'relative',
    borderRadius: 24, borderWidth: 1,
    alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20, marginBottom: 20,
  },
  ringWrap: { marginBottom: 16, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  breathHalo: { position: 'absolute', width: 224, height: 224, borderRadius: 112, borderWidth: 1.5 },
  ring: {
    width: 180, height: 180, borderRadius: 90, borderWidth: 6,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  ringProgress: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    borderWidth: 6, borderTopColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: 'transparent',
  },
  timerInner: { alignItems: 'center', gap: 4 },
  timerText: { fontFamily: fontFamily.mono, fontSize: 48, fontWeight: '500', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  phaseLabel: { fontSize: 13, color: colors.textFaint },

  selectedTask: {
    flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%',
    backgroundColor: colors.bgElevated, borderRadius: 12, padding: 10, borderWidth: 1, marginBottom: 8,
  },
  selectedTaskDot: { width: 8, height: 8, borderRadius: 4 },
  // R03.03
  stepEyebrow: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint },
  stepParent: { fontSize: 12, color: colors.textFaint },
  selectedTaskTitle: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '500' },
  pomodoroCount: { fontSize: 12, color: colors.textFaint },
  noTaskHint: { fontSize: 13, color: colors.textFaint, marginBottom: 8 },
  sessionCount: { fontSize: 12, color: colors.textFaint },

  controls: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  resetBtn: { width: 52, height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  startBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 52, borderRadius: 14 },
  startBtnGated: { opacity: 0.55 },
  startBtnText: { fontSize: 17, fontWeight: '700', color: colors.white },
  startHint: { marginTop: -14, marginBottom: 18, textAlign: 'center', fontSize: 12.5, fontWeight: '600', color: colors.amberSoft },

  taskSection: {},
  taskSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textFaint, letterSpacing: 1 },
  addTaskBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addTaskText: { fontSize: 13, fontWeight: '600' },
  emptyTasks: { alignItems: 'center', paddingVertical: 20 },
  emptyTasksText: { fontSize: 13, color: colors.textFaint },

  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  taskCheck: { padding: 2 },
  checkBox: { width: 18, height: 18, borderRadius: 5, borderWidth: 2 },
  taskBody: { flex: 1 },
  taskTitle: { fontSize: 14, color: colors.textDim, marginBottom: 4 },
  taskMeta: { flexDirection: 'row', gap: 3 },
  pomDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  taskDelete: { padding: 4 },

  overlay: { flex: 1, backgroundColor: hexA(colors.black, 0.8), justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderWidth: 1, borderColor: colors.border },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 16 },
  settingsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  settingsField: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  input: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 14, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  fieldLabel: { fontSize: 12, color: colors.textFaint, fontWeight: '600', marginBottom: 8, letterSpacing: 0.5, flex: 1 },
  pomRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  pomBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  pomBtnText: { fontSize: 14, fontWeight: '600', color: colors.textFaint },
  sheetActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, color: colors.textDim, fontWeight: '600' },
  confirmBtn: { flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center' },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: { fontSize: 15, color: colors.white, fontWeight: '700' },
});
