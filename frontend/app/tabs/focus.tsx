import { useEffect, useRef, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, AppState, type AppStateStatus,
  TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusStore } from '../../store/focusStore';
import { ProgressRing } from '../../components/ui';
import { haptic } from '../../lib/haptics';
import { colors, fontFamily } from '../../lib/tokens';
import FocusReportModal from '../../components/focus/FocusReportModal';
import FocusThemeModal from '../../components/focus/FocusThemeModal';
import FocusSettingsModal from '../../components/focus/FocusSettingsModal';
import FocusSpotifyCard from '../../components/focus/FocusSpotifyCard';
import FocusSessionCompleteModal from '../../components/focus/FocusSessionCompleteModal';
import { FOCUS_PRESETS } from '../../lib/focusThemes';

const PHASE_LABELS: Record<string, string> = {
  work: 'Çalışma Seansı',
  shortBreak: 'Kısa Mola',
  longBreak: 'Uzun Mola',
};

const PHASE_COLORS: Record<string, string> = {
  work: colors.primary,
  shortBreak: colors.success,
  longBreak: colors.info,
};

function pad(n: number) { return String(n).padStart(2, '0'); }

export default function FocusScreen() {
  const {
    phase, status, secondsLeft, sessionsCompleted, selectedTaskId,
    focusTasks, settings, justCompleted,
    start, pause, reset, setPhase,
    fetchFocusTasks, addFocusTask, removeFocusTask, completeFocusTask, selectTask,
    updateSettings, loadSettings, clearJustCompleted,
  } = useFocusStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showTheme, setShowTheme] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPomodoros, setNewTaskPomodoros] = useState(1);
  const [startHint, setStartHint] = useState('');

  const activePreset = FOCUS_PRESETS.find((p) => p.id === settings.presetId) ?? FOCUS_PRESETS[0];
  const phaseColor = activePreset.id === 'default' ? PHASE_COLORS[phase] : activePreset.accent;

  const customDurations = {
    work: settings.workMinutes * 60,
    shortBreak: settings.shortBreakMinutes * 60,
    longBreak: settings.longBreakMinutes * 60,
  };
  const totalSeconds = customDurations[phase as keyof typeof customDurations];
  const progressPct = ((totalSeconds - secondsLeft) / totalSeconds) * 100;
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  useEffect(() => { fetchFocusTasks(); loadSettings(); }, [fetchFocusTasks, loadSettings]);

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
      if (appStateRef.current === 'active' && next !== 'active') {
        if (useFocusStore.getState().status === 'running') pause();
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [pause]);

  const selectedTask = focusTasks.find((t) => t.id === selectedTaskId);

  async function handleAddTask() {
    if (!newTaskTitle.trim()) return;
    await addFocusTask(newTaskTitle.trim(), newTaskPomodoros);
    setNewTaskTitle('');
    setNewTaskPomodoros(1);
    setShowAddTask(false);
  }

  // Seçim yapılınca uyarıyı temizle
  useEffect(() => { if (selectedTaskId) setStartHint(''); }, [selectedTaskId]);

  function handleStartPause() {
    if (status === 'running') { haptic.light(); pause(); return; }
    // Çalışma fazında: önce ne üzerine odaklanılacağı eklenip seçilmeli
    if (phase === 'work' && !selectedTaskId) {
      haptic.light();
      if (focusTasks.length === 0) {
        setStartHint('Önce ne üzerine odaklanacağını ekle, sonra başlat.');
        setShowAddTask(true);
      } else {
        setStartHint('Listeden bir odak konusu seç, sonra başlat.');
      }
      return;
    }
    setStartHint('');
    haptic.medium();
    start();
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: activePreset.bg }]} edges={['bottom']}>
      {settings.overlayOpacity > 0 && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: settings.overlayOpacity }]} />
      )}
      <ScrollView contentContainerStyle={s.content}>

        {/* Üst araç çubuğu */}
        <View style={s.topRow}>
          <View style={s.phaseRow}>
            {(['work', 'shortBreak', 'longBreak'] as const).map((p) => {
              const active = phase === p;
              const col = active ? phaseColor : colors.textFaint;
              return (
                <TouchableOpacity
                  key={p}
                  style={[s.phaseBtn, active && { backgroundColor: phaseColor + '22', borderColor: phaseColor }]}
                  onPress={() => { haptic.select(); setPhase(p); }}
                >
                  <Text style={[s.phaseBtnText, { color: col }]}>
                    {p === 'work' ? 'Çalışma' : p === 'shortBreak' ? 'Kısa' : 'Uzun'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={s.settingsBtn} onPress={() => setShowTheme(true)}>
            <Ionicons name="color-palette-outline" size={18} color={colors.textFaint} />
          </TouchableOpacity>
          <TouchableOpacity style={s.settingsBtn} onPress={() => setShowReport(true)}>
            <Ionicons name="stats-chart-outline" size={18} color={colors.textFaint} />
          </TouchableOpacity>
          <TouchableOpacity style={s.settingsBtn} onPress={() => setShowSettings(true)}>
            <Ionicons name="settings-outline" size={18} color={colors.textFaint} />
          </TouchableOpacity>
        </View>

        {/* Timer kartı */}
        <View style={[s.timerCard, { backgroundColor: activePreset.cardBg, borderColor: phaseColor + '40' }]}>
          {/* Ring progress — gerçek SVG yay */}
          <View style={s.ringWrap}>
            <ProgressRing progress={progressPct / 100} size={200} stroke={12} color={phaseColor}>
              <View style={s.timerInner}>
                <Text style={[s.timerText, { color: phaseColor }]}>{pad(mins)}:{pad(secs)}</Text>
                <Text style={s.phaseLabel}>{PHASE_LABELS[phase]}</Text>
              </View>
            </ProgressRing>
          </View>

          {/* Seçili görev */}
          {selectedTask ? (
            <View style={[s.selectedTask, { borderColor: phaseColor + '40' }]}>
              <View style={[s.selectedTaskDot, { backgroundColor: phaseColor }]} />
              <Text style={s.selectedTaskTitle} numberOfLines={1}>{selectedTask.title}</Text>
              <Text style={s.pomodoroCount}>
                {selectedTask.completed_pomodoros}/{selectedTask.estimated_pomodoros}
              </Text>
            </View>
          ) : (
            <Text style={s.noTaskHint}>Başlamak için bir odak konusu ekle/seç ↓</Text>
          )}

          {sessionsCompleted > 0 && (
            <Text style={s.sessionCount}>{sessionsCompleted} seans tamamlandı</Text>
          )}
        </View>

        {/* Kontroller */}
        {(() => {
          const gated = status !== 'running' && phase === 'work' && !selectedTaskId;
          return (
            <>
              <View style={s.controls}>
                <TouchableOpacity style={[s.resetBtn, { backgroundColor: activePreset.cardBg }]} onPress={() => { haptic.light(); reset(); }}>
                  <Ionicons name="refresh-outline" size={22} color={colors.textDim} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.startBtn, { backgroundColor: phaseColor }, gated && s.startBtnGated]}
                  onPress={handleStartPause}
                >
                  <Ionicons name={status === 'running' ? 'pause' : gated ? 'lock-closed' : 'play'} size={gated ? 22 : 28} color="#fff" />
                  <Text style={s.startBtnText}>
                    {status === 'running' ? 'Duraklat' : status === 'paused' ? 'Devam Et' : gated ? 'Konu Seç' : 'Başla'}
                  </Text>
                </TouchableOpacity>
              </View>
              {startHint ? <Text style={s.startHint}>{startHint}</Text> : null}
            </>
          );
        })()}

        {/* Spotify mini oynatıcı */}
        <FocusSpotifyCard />

        {/* Görev listesi */}
        <View style={s.taskSection}>
          <View style={s.taskSectionHeader}>
            <Text style={s.sectionTitle}>ODAK KONUSU</Text>
            <TouchableOpacity style={s.addTaskBtn} onPress={() => setShowAddTask(true)}>
              <Ionicons name="add" size={16} color={phaseColor} />
              <Text style={[s.addTaskText, { color: phaseColor }]}>Ekle</Text>
            </TouchableOpacity>
          </View>

          {focusTasks.length === 0 ? (
            <View style={s.emptyTasks}>
              <Text style={s.emptyTasksText}>Bir konu ekle (alışkanlık ya da görev), sonra başla</Text>
            </View>
          ) : (
            focusTasks.map((task) => {
              const isSelected = selectedTaskId === task.id;
              return (
                <View key={task.id} style={[s.taskRow, { backgroundColor: activePreset.cardBg }, isSelected && { borderColor: phaseColor + '60' }]}>
                  <TouchableOpacity style={s.taskCheck} onPress={() => { haptic.success(); completeFocusTask(task.id); }}>
                    <View style={[s.checkBox, { borderColor: phaseColor }]} />
                  </TouchableOpacity>

                  <TouchableOpacity style={s.taskBody} onPress={() => selectTask(isSelected ? null : task.id)}>
                    <Text style={[s.taskTitle, isSelected && { color: '#fff', fontWeight: '600' }]} numberOfLines={1}>
                      {task.title}
                    </Text>
                    <View style={s.taskMeta}>
                      {Array.from({ length: task.estimated_pomodoros }).map((_, i) => (
                        <View key={i} style={[s.pomDot, i < task.completed_pomodoros && { backgroundColor: phaseColor }]} />
                      ))}
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => removeFocusTask(task.id)} style={s.taskDelete}>
                    <Ionicons name="close" size={16} color={colors.textGhost} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Görev ekle modal */}
      <Modal visible={showAddTask} transparent animationType="slide" onRequestClose={() => setShowAddTask(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Ne Üzerine Odaklanacaksın?</Text>
            <TextInput
              style={s.input}
              placeholder="Alışkanlık ya da görev…"
              placeholderTextColor={colors.textFaint}
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
              autoFocus
            />
            <Text style={s.fieldLabel}>Tahmini Pomodoro</Text>
            <View style={s.pomRow}>
              {[1,2,3,4,5].map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[s.pomBtn, newTaskPomodoros === n && { backgroundColor: phaseColor + '30', borderColor: phaseColor }]}
                  onPress={() => setNewTaskPomodoros(n)}
                >
                  <Text style={[s.pomBtnText, newTaskPomodoros === n && { color: phaseColor }]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.sheetActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowAddTask(false)}>
                <Text style={s.cancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmBtn, { backgroundColor: phaseColor }, !newTaskTitle.trim() && s.confirmBtnDisabled]}
                onPress={handleAddTask}
                disabled={!newTaskTitle.trim()}
              >
                <Text style={s.confirmText}>Ekle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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

const s = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  phaseRow: { flex: 1, flexDirection: 'row', gap: 6 },
  phaseBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  phaseBtnText: { fontSize: 12, fontWeight: '600' },
  settingsBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },

  presetsRow: { marginBottom: 16, maxHeight: 38 },
  presetsContent: { gap: 8 },
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  presetDot: { width: 8, height: 8, borderRadius: 4 },
  presetLabel: { fontSize: 12, color: colors.textFaint, fontWeight: '500' },

  timerCard: {
    borderRadius: 24, borderWidth: 1,
    alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20, marginBottom: 20,
  },
  ringWrap: { marginBottom: 16 },
  ring: {
    width: 180, height: 180, borderRadius: 90, borderWidth: 6,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  ringProgress: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    borderWidth: 6, borderTopColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: 'transparent',
  },
  timerInner: { alignItems: 'center', gap: 4 },
  timerText: { fontFamily: fontFamily.mono, fontSize: 48, fontWeight: '500', letterSpacing: -2, fontVariant: ['tabular-nums'] as any },
  phaseLabel: { fontSize: 13, color: colors.textFaint },

  selectedTask: {
    flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%',
    backgroundColor: colors.bgElevated, borderRadius: 12, padding: 10, borderWidth: 1, marginBottom: 8,
  },
  selectedTaskDot: { width: 8, height: 8, borderRadius: 4 },
  selectedTaskTitle: { flex: 1, fontSize: 14, color: '#e5e7eb', fontWeight: '500' },
  pomodoroCount: { fontSize: 12, color: colors.textFaint },
  noTaskHint: { fontSize: 13, color: colors.textGhost, marginBottom: 8 },
  sessionCount: { fontSize: 12, color: colors.textFaint },

  controls: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  resetBtn: { width: 52, height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  startBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 52, borderRadius: 14 },
  startBtnGated: { opacity: 0.55 },
  startBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  startHint: { marginTop: -14, marginBottom: 18, textAlign: 'center', fontSize: 12.5, fontWeight: '600', color: '#E0A458' },

  taskSection: {},
  taskSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textFaint, letterSpacing: 1 },
  addTaskBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addTaskText: { fontSize: 13, fontWeight: '600' },
  emptyTasks: { alignItems: 'center', paddingVertical: 20 },
  emptyTasksText: { fontSize: 13, color: colors.textGhost },

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

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderWidth: 1, borderColor: colors.border },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 16 },
  settingsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  settingsField: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  input: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 14, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  fieldLabel: { fontSize: 12, color: colors.textFaint, fontWeight: '600', marginBottom: 8, letterSpacing: 0.5, flex: 1 },
  pomRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  pomBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  pomBtnText: { fontSize: 14, fontWeight: '600', color: colors.textFaint },
  sheetActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, color: colors.textDim, fontWeight: '600' },
  confirmBtn: { flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: '#D97757', alignItems: 'center' },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
