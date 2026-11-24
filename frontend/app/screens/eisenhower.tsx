import { alphaHex, hexA, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useState, useEffect, useMemo, type ComponentProps } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, FlatList, type ImageSourcePropType,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { navigateTo } from '../../lib/destinations';
import { useTaskStore, Task, QuadrantType } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import type { Habit } from '../../lib/supabase';
import { computeTriage, TRIAGE_META, type Triage } from '../../lib/triage';
import { EditorialBanner } from '../../components/ui';
import { AtmosphericScreenCanvas, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Quadrant = {
  key: QuadrantType;
  label: string;
  action: string;
  color: string;
  icon: IoniconName;
  relief: ImageSourcePropType;
};

const getQuadrants = (colors: Palette): Quadrant[] => [
  { key: 'UI', label: 'YAP', action: 'Acil + Önemli', color: colors.error, icon: 'flame-outline', relief: DECOR.quadrantFlame },
  { key: 'NI', label: 'PLANLA', action: 'Önemli, Acil Değil', color: colors.accent, icon: 'calendar-outline', relief: DECOR.quadrantCompass },
  { key: 'UN', label: 'DELEGE ET', action: 'Acil, Önemsiz', color: colors.warning, icon: 'people-outline', relief: DECOR.quadrantHourglass },
  { key: 'NN', label: 'SİL', action: 'Ne Acil Ne Önemli', color: colors.textFaint, icon: 'trash-outline', relief: DECOR.quadrantFeather },
];

// Alışkanlık matrisi — görev kadranlarıyla aynı 2×2 konumlar, triaj eşlemesi
const TRIAGE_CELLS: { key: Triage; action: string; relief: ImageSourcePropType }[] = [
  { key: 'do_now', action: 'Acil + Önemli', relief: DECOR.quadrantFlame },
  { key: 'plan', action: 'Önemli, Acil Değil', relief: DECOR.quadrantCompass },
  { key: 'wait_watch', action: 'Acil, Önemsiz', relief: DECOR.quadrantHourglass },
  { key: 'eliminate', action: 'Ne Acil Ne Önemli', relief: DECOR.quadrantFeather },
];

const getPriorityColor = (colors: Palette): Record<string, string> => ({
  high: colors.error,
  medium: colors.warning,
  low: colors.success,
  none: colors.textGhost,
});

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktif', waiting: 'Bekleme', idea: 'Fikir', paused: 'Askıda', completed: 'Tamam',
};

function QuadrantBox({
  q, tasks, onAssign,
}: {
  q: Quadrant;
  tasks: Task[];
  onAssign: (task: Task) => void;
}) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const priorityColor = getPriorityColor(colors);
  return (
    <View style={[s.quadrant, { borderColor: alphaHex(q.color, '40') }]}>
      <EmbeddedFiligree source={q.relief} anchor="bottom-right" size={118} opacity={0.22} />
      <View style={s.qHeader}>
        <Ionicons name={q.icon} size={14} color={q.color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        <Text style={[s.qLabel, { color: q.color }]}>{q.label}</Text>
      </View>
      <Text style={s.qAction}>{q.action}</Text>
      {tasks.length === 0 ? (
        <Text style={s.qEmpty}>— boş —</Text>
      ) : (
        tasks.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={s.taskChip}
            onPress={() => onAssign(t)}
            accessibilityRole="button"
            accessibilityLabel={`${t.title} — ${q.label} kadranında`}
            accessibilityHint="Kadranı değiştirmek için aç"
          >
            <View style={[s.dot, { backgroundColor: priorityColor[t.priority] }]} />
            <Text style={s.taskTitle} numberOfLines={2}>{t.title}</Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

function HabitQuadrantBox({
  triage, habits, onTap,
}: {
  triage: Triage;
  habits: Habit[];
  onTap: () => void;
}) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const m = TRIAGE_META[triage];
  const cell = TRIAGE_CELLS.find((c) => c.key === triage);
  return (
    <View style={[s.quadrant, { borderColor: alphaHex(m.color, '40') }]}>
      {cell ? <EmbeddedFiligree source={cell.relief} anchor="bottom-right" size={118} opacity={0.22} /> : null}
      <View style={s.qHeader}>
        <Text style={{ fontSize: 13 }}>{m.emoji}</Text>
        <Text style={[s.qLabel, { color: m.color }]}>{m.label}</Text>
      </View>
      <Text style={s.qAction}>{cell?.action}</Text>
      {habits.length === 0 ? (
        <Text style={s.qEmpty}>— boş —</Text>
      ) : (
        habits.map((h) => (
          <TouchableOpacity
            key={h.id}
            style={s.taskChip}
            onPress={onTap}
            accessibilityRole="button"
            accessibilityLabel={`${h.name}, ${STATUS_LABEL[h.status] ?? h.status} — ${m.label}`}
            accessibilityHint="Alışkanlıklar sekmesini açar"
          >
            <View style={[s.dot, { backgroundColor: h.color ?? colors.accent, borderRadius: 2 }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.taskTitle} numberOfLines={1}>{h.name}</Text>
              <Text style={s.habitRoom}>{STATUS_LABEL[h.status] ?? h.status}</Text>
            </View>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

export default function EisenhowerScreen() {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const quadrants = useMemo(() => getQuadrants(colors), [colors]);
  const priorityColor = useMemo(() => getPriorityColor(colors), [colors]);
  const router = useRouter();
  const { tasks, fetchTasks, updateQuadrant } = useTaskStore(
    useShallow((st) => ({
      tasks: st.tasks,
      fetchTasks: st.fetchTasks,
      updateQuadrant: st.updateQuadrant,
    })),
  );
  const { habits, fetchHabits } = useHabitStore(
    useShallow((st) => ({ habits: st.habits, fetchHabits: st.fetchHabits })),
  );
  const [mode, setMode] = useState<'tasks' | 'habits'>('tasks');
  const [assignModal, setAssignModal] = useState<Task | null>(null);
  const [pickModal, setPickModal] = useState(false);

  useEffect(() => { fetchTasks(); fetchHabits(); }, [fetchTasks, fetchHabits]);

  const activeTasks = tasks.filter((t) => !t.completed && t.status !== 'cancelled');
  const unassigned = activeTasks.filter((t) => !t.quadrant);

  function byQuadrant(key: QuadrantType) {
    return activeTasks.filter((t) => t.quadrant === key);
  }

  const liveHabits = habits.filter((h) => ['active', 'waiting', 'idea', 'paused'].includes(h.status));
  function byTriage(key: Triage) {
    return liveHabits.filter((h) => computeTriage(h.impact_level, h.urgency) === key);
  }

  async function assign(task: Task, quad: QuadrantType) {
    await updateQuadrant(task.id, quad);
    setAssignModal(null);
    setPickModal(false);
  }

  const isTasks = mode === 'tasks';

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.planDrafting}
        textureSource={TEXTURES.sacredGrid}
        scrim={0.64}
        tintColor={colors.accent}
      />
      <ScrollView contentContainerStyle={s.scroll}>

        <EditorialBanner
          source={SCREEN_BANNERS.eisenhowerCompass}
          textureSource={TEXTURES.sacredGrid}
          eyebrow="ÖNCELİK PUSULASI"
          title="Eisenhower Matrisi"
          subtitle="Acil ile önemliyi ayır; enerjini doğru kadrana yönlendir."
          accentColor={colors.accent}
          minHeight={90}
          style={{ marginBottom: 12 }}
        />

        {/* Mod seçici */}
        <View style={s.toggle}>
          {(['tasks', 'habits'] as const).map((mk) => {
            const sel = mode === mk;
            return (
              <TouchableOpacity
                key={mk}
                style={[s.toggleBtn, sel && s.toggleBtnSel]}
                onPress={() => setMode(mk)}
                accessibilityRole="tab"
                accessibilityLabel={mk === 'tasks' ? 'Görev matrisi' : 'Alışkanlık matrisi'}
                accessibilityState={{ selected: sel }}
              >
                <Ionicons name={mk === 'tasks' ? 'checkbox-outline' : 'repeat-outline'} size={15} color={sel ? colors.white : colors.textDim} />
                <Text style={[s.toggleText, sel && s.toggleTextSel]}>{mk === 'tasks' ? 'Görevler' : 'Alışkanlıklar'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={s.modeHint}>
          {isTasks
            ? 'Görevleri elle 4 kadrana yerleştir'
            : 'Alışkanlıklar etki × aciliyetten otomatik gelir (salt-okunur)'}
        </Text>

        {/* Sınıflandırılmamış görev banner — yalnız görev modu */}
        {isTasks && unassigned.length > 0 && (
          <TouchableOpacity
            style={s.unassignedBanner}
            onPress={() => setPickModal(true)}
            accessibilityRole="button"
            accessibilityLabel={`${unassigned.length} görev sınıflandırılmadı, yerleştir`}
          >
            <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
            <Text style={s.unassignedText}>{unassigned.length} görev sınıflandırılmadı</Text>
            <Text style={s.unassignedLink}>Yerleştir →</Text>
          </TouchableOpacity>
        )}

        {/* 2x2 Gravürlü Pirinç Pusula Matrisi */}
        <View style={s.matrix}>
          <View style={s.row}>
            {isTasks ? (
              <>
                <QuadrantBox q={quadrants[0]} tasks={byQuadrant('UI')} onAssign={setAssignModal} />
                <QuadrantBox q={quadrants[1]} tasks={byQuadrant('NI')} onAssign={setAssignModal} />
              </>
            ) : (
              <>
                <HabitQuadrantBox triage="do_now" habits={byTriage('do_now')} onTap={() => navigateTo(router, 'habits')} />
                <HabitQuadrantBox triage="plan" habits={byTriage('plan')} onTap={() => navigateTo(router, 'habits')} />
              </>
            )}
          </View>
          <View style={s.row}>
            {isTasks ? (
              <>
                <QuadrantBox q={quadrants[2]} tasks={byQuadrant('UN')} onAssign={setAssignModal} />
                <QuadrantBox q={quadrants[3]} tasks={byQuadrant('NN')} onAssign={setAssignModal} />
              </>
            ) : (
              <>
                <HabitQuadrantBox triage="wait_watch" habits={byTriage('wait_watch')} onTap={() => navigateTo(router, 'habits')} />
                <HabitQuadrantBox triage="eliminate" habits={byTriage('eliminate')} onTap={() => navigateTo(router, 'habits')} />
              </>
            )}
          </View>

          {/* 4 kadranın kesişim noktasındaki pirinç pusula rozeti */}
          <View style={s.crosshairWrap} pointerEvents="none">
            <View style={s.crosshairBadge}>
              <Ionicons name="compass-outline" size={16} color={colors.warning} />
            </View>
          </View>
        </View>

        {/* Axis labels */}
        <View style={s.axisRow}>
          <Text style={s.axisLabel}>← Önemsiz</Text>
          <Text style={s.axisLabelCenter}>ÖNEM</Text>
          <Text style={s.axisLabel}>Önemli →</Text>
        </View>

        {!isTasks && (
          <Text style={s.mirrorNote}>
            Bu görünüm &quot;Yeni Alışkanlık → Öncelik & Strateji&quot; adımının aynasıdır. Değiştirmek için alışkanlığı düzenle.
          </Text>
        )}
      </ScrollView>

      {/* Assign quadrant modal — yalnız görev modu */}
      <Modal visible={!!assignModal} transparent animationType="fade" onRequestClose={() => setAssignModal(null)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle} numberOfLines={2}>{assignModal?.title}</Text>
            <Text style={s.modalSub}>Kadranı değiştir:</Text>
            {quadrants.map((q) => (
              <TouchableOpacity
                key={q.key}
                style={[s.modalOption, assignModal?.quadrant === q.key && s.modalOptionActive]}
                onPress={() => assignModal && assign(assignModal, q.key)}
                accessibilityRole="radio"
                accessibilityLabel={`${q.label} — ${q.action}`}
                accessibilityState={{
                  selected: assignModal?.quadrant === q.key,
                  checked: assignModal?.quadrant === q.key,
                }}
              >
                <Ionicons name={q.icon} size={16} color={q.color} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.modalOptionLabel, { color: q.color }]}>{q.label}</Text>
                  <Text style={s.modalOptionSub}>{q.action}</Text>
                </View>
                {assignModal?.quadrant === q.key && (
                  <Ionicons name="checkmark" size={16} color={q.color} />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={s.modalCancel}
              onPress={() => assignModal && assign(assignModal, null)}
              accessibilityRole="button"
              accessibilityLabel="Sınıflandırmayı kaldır"
            >
              <Text style={s.modalCancelText}>Sınıflandırmayı Kaldır</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Pick from unassigned tasks */}
      <Modal visible={pickModal} transparent animationType="slide" onRequestClose={() => setPickModal(false)}>
        <View style={s.modalBg}>
          <View style={[s.modalCard, { maxHeight: '80%' }]}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Sınıflandırılmamış Görevler</Text>
              <TouchableOpacity
                onPress={() => setPickModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
              >
                <Ionicons name="close" size={20} color={colors.textFaint} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={unassigned}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.pickRow}
                  onPress={() => { setPickModal(false); setAssignModal(item); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title} görevini kadrana yerleştir`}
                >
                  <View style={[s.dot, { backgroundColor: priorityColor[item.priority] }]} />
                  <Text style={s.pickTitle} numberOfLines={1}>{item.title}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textGhost} />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { padding: 16, paddingBottom: 40 },

    toggle: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    toggleBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: hexA(colors.surface, 0.92), borderRadius: 12, paddingVertical: 10,
      borderWidth: 1, borderColor: colors.border,
    },
    toggleBtnSel: { backgroundColor: colors.accent, borderColor: colors.accent },
    toggleText: { fontSize: 14, color: colors.textDim, fontWeight: '600' },
    toggleTextSel: { color: colors.white },
    modeHint: { fontSize: 12, color: colors.textFaint, marginBottom: 16, paddingHorizontal: 2 },

    unassignedBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: alphaHex(colors.warning, '15'), borderRadius: 12, padding: 12,
      borderWidth: 1, borderColor: alphaHex(colors.warning, '30'), marginBottom: 16,
    },
    unassignedText: { flex: 1, fontSize: 13, color: colors.warning },
    unassignedLink: { fontSize: 13, color: colors.warning, fontWeight: '700' },

    matrix: { gap: 10, position: 'relative' },
    row: { flexDirection: 'row', gap: 10 },
    crosshairWrap: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    crosshairBadge: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.bgSunk,
      borderWidth: 1,
      borderColor: hexA(colors.warning, 0.55),
      alignItems: 'center',
      justifyContent: 'center',
    },

    quadrant: {
      flex: 1, minHeight: 168, backgroundColor: hexA(colors.surface, 0.92),
      borderRadius: 14, padding: 12, borderWidth: 1,
      overflow: 'hidden', position: 'relative',
    },
    qHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    qLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    qAction: { fontSize: 10, color: colors.textFaint, marginBottom: 10 },
    qEmpty: { fontSize: 11, color: colors.textFaint, textAlign: 'center', marginTop: 12 },

    taskChip: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 6,
      backgroundColor: hexA(colors.bg, 0.9), borderRadius: 8, padding: 8, marginBottom: 6,
    },
    dot: { width: 7, height: 7, borderRadius: 4, marginTop: 3, flexShrink: 0 },
    taskTitle: { flex: 1, fontSize: 12, color: colors.textDim, lineHeight: 16 },
    habitRoom: { fontSize: 9, color: colors.textFaint, marginTop: 1 },

    axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 4 },
    axisLabel: { fontSize: 10, color: colors.textFaint },
    axisLabelCenter: { fontSize: 10, color: colors.textFaint, fontWeight: '700' },
    mirrorNote: { fontSize: 11, color: colors.textFaint, marginTop: 14, lineHeight: 16, fontStyle: 'italic' },

    modalBg: { flex: 1, backgroundColor: hexA(colors.black, 0.7), justifyContent: 'center', padding: 20 },
    modalCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border },
    modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1, marginBottom: 4 },
    modalSub: { fontSize: 12, color: colors.textFaint, marginBottom: 12 },
    modalOption: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      padding: 12, borderRadius: 10, marginBottom: 8,
      backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    },
    modalOptionActive: { borderColor: colors.accent },
    modalOptionLabel: { fontSize: 13, fontWeight: '700' },
    modalOptionSub: { fontSize: 11, color: colors.textFaint, marginTop: 1 },
    modalCancel: { alignItems: 'center', marginTop: 8, padding: 10 },
    modalCancelText: { fontSize: 13, color: colors.error },

    pickRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    pickTitle: { flex: 1, fontSize: 14, color: colors.text },
  });
