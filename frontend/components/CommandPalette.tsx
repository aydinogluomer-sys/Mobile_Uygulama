import { colors } from '../lib/tokens';
import { useState, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TextInput,
  TouchableOpacity, FlatList, Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCommandStore } from '../store/commandStore';
import { useHabitStore } from '../store/habitStore';
import { useTaskStore } from '../store/taskStore';
import { useNoteStore } from '../store/noteStore';
import { useProjectStore } from '../store/projectStore';
import { searchEverything } from '../services/searchService';
import { useDrawerStore } from '../store/drawerStore';

const RECENTS_KEY = 'app_cmd_recents';

type RecentEntry = { label: string; icon: string; color: string; route: string };

type QuickAction = {
  id: string;
  label: string;
  icon: string;
  color: string;
  /** route varsa son kullanılanlara kaydedilir */
  route?: string;
  action: () => void;
};

interface Props {
  onOpenHabitForm?: () => void;
  onOpenAIModal?: () => void;
}

export default function CommandPalette({ onOpenHabitForm, onOpenAIModal }: Props) {
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const { visible, close } = useCommandStore();
  const { habits, fetchHabits } = useHabitStore();
  const { tasks, fetchTasks } = useTaskStore();
  const { notes, fetchNotes } = useNoteStore();
  const { projects, fetchProjects } = useProjectStore();
  const router = useRouter();
  const openDrawer = useDrawerStore((s) => s.open);

  // Açıldığında arama kaynaklarını ve son kullanılanları hazırla
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(RECENTS_KEY).then((raw) => {
      if (raw) { try { setRecents(JSON.parse(raw)); } catch { /* yoksay */ } }
    });
    if (habits.length === 0) fetchHabits();
    if (tasks.length === 0) fetchTasks();
    if (notes.length === 0) fetchNotes();
    if (projects.length === 0) fetchProjects();
  }, [visible, habits.length, tasks.length, notes.length, projects.length, fetchHabits, fetchTasks, fetchNotes, fetchProjects]);

  function recordRecent(entry: RecentEntry) {
    setRecents((prev) => {
      const next = [entry, ...prev.filter((r) => r.route !== entry.route)].slice(0, 6);
      AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  /** route'a git + son kullanılanlara yaz */
  function go(route: string, label: string, icon: string, color: string) {
    recordRecent({ route, label, icon, color });
    close();
    router.push(route as any);
  }

  const quickActions: QuickAction[] = [
    { id: 'today', label: 'Bugüne git', icon: 'sunny-outline', color: colors.warning, route: '/tabs/today', action: () => go('/tabs/today', 'Bugüne git', 'sunny-outline', colors.warning) },
    { id: 'focus', label: 'Odak Modu başlat', icon: 'timer-outline', color: colors.teal, route: '/tabs/focus', action: () => go('/tabs/focus', 'Odak Modu başlat', 'timer-outline', colors.teal) },
    { id: 'tasks', label: 'Görevler', icon: 'list-outline', color: colors.accent, route: '/tabs/tasks', action: () => go('/tabs/tasks', 'Görevler', 'list-outline', colors.accent) },
    { id: 'habits', label: 'Alışkanlıkları gör', icon: 'checkmark-circle-outline', color: colors.success, route: '/tabs/timeline', action: () => go('/tabs/timeline', 'Alışkanlıkları gör', 'checkmark-circle-outline', colors.success) },
    { id: 'notes', label: 'Notlar', icon: 'document-text-outline', color: colors.teal, route: '/screens/notes', action: () => go('/screens/notes', 'Notlar', 'document-text-outline', colors.teal) },
    { id: 'leaderboard', label: 'Sıralama', icon: 'podium-outline', color: colors.warning, route: '/screens/leaderboard', action: () => go('/screens/leaderboard', 'Sıralama', 'podium-outline', colors.warning) },
    { id: 'new-habit', label: 'Yeni alışkanlık ekle', icon: 'add-circle-outline', color: colors.accent, action: () => { close(); onOpenHabitForm?.(); } },
    { id: 'ai-routine', label: 'AI Rutin oluştur', icon: 'sparkles-outline', color: '#8b5cf6', action: () => { close(); onOpenAIModal?.(); } },
    { id: 'drawer', label: 'Menüyü aç', icon: 'menu-outline', color: colors.textDim, action: () => { close(); setTimeout(() => openDrawer(), 150); } },
  ];

  const q = query.trim().toLowerCase();

  const filteredActions = !q
    ? quickActions
    : quickActions.filter((a) => a.label.toLowerCase().includes(q));
  /**
   * Search runs on the SERVER, debounced. (§30)
   *
   * These four lists used to be `tasks.filter(...)` over the store's arrays,
   * which was only ever correct because each store held its entire table.
   * Now that the collections are paginated, filtering memory would search
   * whichever page happened to be loaded and silently miss the rest — the
   * worst kind of wrong answer, because an empty result looks identical to
   * "you have nothing matching".
   *
   * The loaded rows are still used as an INSTANT first answer while the
   * request is in flight, so typing stays responsive; the server result
   * replaces it. That is the "bounded recent cache + server-side search"
   * shape rather than either one alone.
   */
  const local = useMemo(() => ({
    tasks: !q ? [] : tasks.filter((t) => !t.completed && t.title.toLowerCase().includes(q)).slice(0, 5),
    notes: !q ? [] : notes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 5),
    projects: !q ? [] : projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5),
    habits: !q ? [] : habits.filter((h) => h.name.toLowerCase().includes(q)).slice(0, 5),
  }), [q, tasks, notes, projects, habits]);

  const [remote, setRemote] = useState<{
    tasks: typeof tasks; notes: typeof notes; projects: typeof projects; habits: typeof habits;
  } | null>(null);

  useEffect(() => {
    if (!q) { setRemote(null); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      // One service call. The per-source limit and the "a failed source
      // contributes nothing rather than failing the search" policy live
      // there, not next to the rendering.
      const found = await searchEverything(q, 5);
      if (!alive) return;
      setRemote({
        tasks: found.tasks as typeof tasks,
        notes: found.notes as typeof notes,
        projects: found.projects as typeof projects,
        habits: found.habits as typeof habits,
      });
    }, 220);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);

  const filteredTasks = remote ? remote.tasks.slice(0, 5) : local.tasks;
  const filteredNotes = remote ? remote.notes.slice(0, 5) : local.notes;
  const filteredProjects = remote ? remote.projects.slice(0, 5) : local.projects;
  const filteredHabits = remote ? remote.habits.slice(0, 5) : local.habits;

  function handleClose() {
    setQuery('');
    close();
  }

  // FlatList veri modeli
  const data: any[] = [];
  if (!q && recents.length > 0) {
    data.push({ type: 'section', label: 'Son kullanılanlar' });
    recents.forEach((r) => data.push({ type: 'recent', id: 'r:' + r.route, ...r }));
  }
  if (filteredActions.length > 0) {
    data.push({ type: 'section', label: 'Hızlı Eylemler' });
    filteredActions.forEach((a) => data.push({ type: 'action', ...a }));
  }
  if (filteredTasks.length > 0) {
    data.push({ type: 'section', label: 'Görevler' });
    filteredTasks.forEach((t) => data.push({ type: 'go', id: 't:' + t.id, label: t.title, icon: 'list-outline', color: colors.accent, route: '/tabs/tasks' }));
  }
  if (filteredNotes.length > 0) {
    data.push({ type: 'section', label: 'Notlar' });
    filteredNotes.forEach((n) => data.push({ type: 'go', id: 'n:' + n.id, label: n.title || 'Başlıksız not', icon: 'document-text-outline', color: colors.teal, route: '/screens/notes' }));
  }
  if (filteredProjects.length > 0) {
    data.push({ type: 'section', label: 'Projeler' });
    filteredProjects.forEach((p) => data.push({ type: 'go', id: 'p:' + p.id, label: p.name, icon: 'folder-outline', color: colors.success, route: '/screens/projects' }));
  }
  if (filteredHabits.length > 0) {
    data.push({ type: 'section', label: 'Alışkanlıklar' });
    filteredHabits.forEach((h) => data.push({ type: 'go', id: 'h:' + h.id, label: h.name, icon: h.icon ?? 'star-outline', color: h.color ?? colors.accent, route: '/tabs/timeline' }));
  }
  if (data.length === 0) {
    data.push({ type: 'empty' });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />

        <View style={styles.container}>
          {/* Input */}
          <View style={styles.inputRow}>
            <Ionicons name="search-outline" size={18} color="#827E72" />
            <TextInput
              style={styles.input}
              placeholder="Ara: görev, not, proje, alışkanlık veya eylem…"
              placeholderTextColor="#827E72"
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={18} color="#827E72" />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.divider} />

          <FlatList
            data={data}
            keyExtractor={(item, i) => item.id ?? item.label ?? i.toString()}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              if (item.type === 'section') {
                return <Text style={styles.sectionLabel}>{item.label}</Text>;
              }
              if (item.type === 'empty') {
                return <Text style={styles.emptyText}>Sonuç yok</Text>;
              }
              return (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => {
                    if (item.type === 'action') item.action();
                    else if (item.type === 'recent' || item.type === 'go') go(item.route, item.label, item.icon, item.color);
                    else handleClose();
                  }}
                >
                  <View style={[styles.rowIcon, { backgroundColor: item.color + '20' }]}>
                    <Ionicons name={item.icon as any} size={18} color={item.color} />
                  </View>
                  <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
                  <Ionicons name={item.type === 'recent' ? 'time-outline' : 'arrow-forward-outline'} size={14} color="#56544B" />
                </TouchableOpacity>
              );
            }}
          />

          <TouchableOpacity style={styles.closeRow} onPress={handleClose}>
            <Text style={styles.closeText}>Kapat</Text>
            <View style={styles.escBadge}><Text style={styles.escText}>ESC</Text></View>
          </TouchableOpacity>
        </View>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 80 : 60,
    left: 16, right: 16,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    maxHeight: 520,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  input: { flex: 1, fontSize: 16, color: colors.white },
  divider: { height: 1, backgroundColor: colors.border },
  list: { maxHeight: 380 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.textFaint,
    letterSpacing: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
  },
  emptyText: { fontSize: 14, color: colors.textFaint, textAlign: 'center', padding: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '500' },
  closeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 12, borderTopWidth: 1, borderTopColor: colors.border,
  },
  closeText: { fontSize: 13, color: colors.textFaint },
  escBadge: {
    backgroundColor: colors.border, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  escText: { fontSize: 11, color: colors.textFaint, fontWeight: '700' },
});
