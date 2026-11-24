/**
 * Mounted ONCE in `app/_layout.tsx` (`shellVisible`) so Cmd/Ctrl+K and ESC reach
 * both tab screens and `/screens/*` Stack screens.
 *
 * Quick navigation actions (including legacy `/tabs/today` and `/tabs/focus` targets)
 * are derived from `visibleDestinations('palette')` in `lib/destinations.ts`; search
 * results jump directly to the matched item (`habit-detail`, `journal-reader`,
 * `/tabs/plan?tab=tasks&focus=`, `/screens/notes?focus=`, `/tabs/plan?tab=projects&focus=`).
 */
import { alphaHex, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { EmbeddedFiligree } from './spatial';
import { DECOR } from '../lib/visualAssets';
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useShallow } from 'zustand/react/shallow';
import { useCommandStore } from '../store/commandStore';
import { useHabitStore } from '../store/habitStore';
import { useTaskStore } from '../store/taskStore';
import { useNoteStore } from '../store/noteStore';
import { useProjectStore } from '../store/projectStore';
import { searchEverything, type SearchResults } from '../services/searchService';
import { useJournalStore } from '../store/journalStore';
import { useDrawerStore } from '../store/drawerStore';
import {
  hrefFor,
  routeKeyOf,
  toRouterHref,
  visibleDestinations,
  type DestinationHref,
} from '../lib/destinations';

const RECENTS_KEY = 'app_cmd_recents';

export type RecentEntry = {
  label: string;
  icon: string;
  color: string;
  route: string;
  href?: DestinationHref;
};

type QuickAction = {
  id: string;
  label: string;
  icon: string;
  color: string;
  keywords: readonly string[];
  action: () => void;
};

type PaletteRow =
  | { type: 'section'; id: string; label: string }
  | { type: 'loading'; id: string }
  | { type: 'error'; id: string }
  | { type: 'empty'; id: string }
  | {
      type: 'action';
      id: string;
      label: string;
      a11yLabel: string;
      icon: string;
      color: string;
      action: () => void;
    }
  | {
      type: 'recent' | 'go';
      id: string;
      label: string;
      a11yLabel: string;
      icon: string;
      color: string;
      target: DestinationHref | string;
    };

export default function CommandPalette() {
  const colors = useThemeColors();
  const styles = useThemedStyles(makeStyles);
  const aiHue = colors.accent;
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const { visible, close, requestIntent } = useCommandStore(
    useShallow((st) => ({
      visible: st.visible,
      close: st.close,
      requestIntent: st.requestIntent,
    })),
  );
  const { habits, fetchHabits } = useHabitStore(
    useShallow((st) => ({ habits: st.habits, fetchHabits: st.fetchHabits })),
  );
  const { tasks, fetchTasks } = useTaskStore(
    useShallow((st) => ({ tasks: st.tasks, fetchTasks: st.fetchTasks })),
  );
  const { notes, fetchNotes } = useNoteStore(
    useShallow((st) => ({ notes: st.notes, fetchNotes: st.fetchNotes })),
  );
  const { projects, fetchProjects } = useProjectStore(
    useShallow((st) => ({ projects: st.projects, fetchProjects: st.fetchProjects })),
  );
  const fetchJournal = useJournalStore((st) => st.fetchEntries);
  const router = useRouter();
  const openDrawer = useDrawerStore((s) => s.open);

  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(RECENTS_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setRecents(
              parsed.filter(
                (r): r is RecentEntry =>
                  Boolean(r) &&
                  typeof r === 'object' &&
                  typeof (r as RecentEntry).label === 'string' &&
                  typeof (r as RecentEntry).route === 'string',
              ),
            );
          }
        } catch {
          /* yoksay */
        }
      }
    });
    if (habits.length === 0) fetchHabits();
    if (tasks.length === 0) fetchTasks();
    if (notes.length === 0) fetchNotes();
    if (projects.length === 0) fetchProjects();
    fetchJournal();
  }, [
    visible,
    habits.length,
    tasks.length,
    notes.length,
    projects.length,
    fetchHabits,
    fetchTasks,
    fetchNotes,
    fetchProjects,
    fetchJournal,
  ]);

  function recordRecent(entry: RecentEntry) {
    const entryKey = routeKeyOf(entry.href ?? entry.route);
    setRecents((prev) => {
      const next = [
        entry,
        ...prev.filter((r) => routeKeyOf(r.href ?? r.route) !== entryKey),
      ].slice(0, 6);
      AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function go(target: DestinationHref | string, label: string, icon: string, color: string) {
    const key = routeKeyOf(target);
    recordRecent(
      typeof target === 'string'
        ? { label, icon, color, route: key }
        : { label, icon, color, route: key, href: target },
    );
    setQuery('');
    close();

    const nav =
      typeof router.navigate === 'function' ? router.navigate.bind(router) : router.push.bind(router);

    if (typeof target === 'string') {
      if (target.startsWith('/tabs/')) {
        nav(target as Href);
      } else {
        router.push(target as Href);
      }
      return;
    }

    if (target.pathname.startsWith('/tabs/')) {
      nav(toRouterHref(target));
    } else {
      router.push(toRouterHref(target));
    }
  }

  const destActions: QuickAction[] = visibleDestinations('palette').map((d) => {
    const color = colors[d.tone];
    return {
      id: d.id,
      label: d.label,
      icon: d.icon,
      color,
      keywords: d.keywords,
      action: () => go(d.href, d.label, d.icon, color),
    };
  });

  const habitsHref = hrefFor('habits');
  const quickActions: QuickAction[] = [
    ...destActions,
    {
      id: 'new-habit',
      label: 'Yeni alışkanlık ekle',
      icon: 'add-circle-outline',
      color: colors.accent,
      keywords: ['yeni alışkanlık', 'ekle', 'oluştur'],
      action: () => {
        requestIntent('new-habit');
        go(habitsHref, 'Yeni alışkanlık ekle', 'add-circle-outline', colors.accent);
      },
    },
    {
      id: 'ai-routine',
      label: 'AI Rutin oluştur',
      icon: 'sparkles-outline',
      color: aiHue,
      keywords: ['ai rutin', 'yapay zeka', 'paket'],
      action: () => {
        requestIntent('ai-routine');
        go(habitsHref, 'AI Rutin oluştur', 'sparkles-outline', aiHue);
      },
    },
    {
      id: 'drawer',
      label: 'Menüyü aç',
      icon: 'menu-outline',
      color: colors.textDim,
      keywords: ['menü', 'drawer', 'çekmece'],
      action: () => {
        setQuery('');
        close();
        setTimeout(() => openDrawer(), 150);
      },
    },
  ];

  const q = query.trim().toLowerCase();

  const filteredActions = !q
    ? quickActions
    : quickActions.filter(
        (a) =>
          a.label.toLowerCase().includes(q) ||
          a.keywords.some((kw) => kw.toLowerCase().includes(q)),
      );

  const local = {
    tasks: !q
      ? []
      : tasks.filter((t) => !t.completed && t.title.toLowerCase().includes(q)).slice(0, 5),
    notes: !q ? [] : notes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 5),
    projects: !q ? [] : projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5),
    habits: !q ? [] : habits.filter((h) => h.name.toLowerCase().includes(q)).slice(0, 5),
  };

  const [remote, setRemote] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [failedSources, setFailedSources] = useState<string[]>([]);

  const [prevQ, setPrevQ] = useState(q);
  if (prevQ !== q) {
    setPrevQ(q);
    if (!q) {
      setRemote(null);
      setSearching(false);
      setFailedSources([]);
    } else {
      setSearching(true);
    }
  }

  useEffect(() => {
    if (!q) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const found = await searchEverything(q, 5);
      if (!alive) return;
      setRemote(found);
      setFailedSources(found.failed);
      setSearching(false);
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  const filteredTasks = (remote ? remote.tasks : local.tasks) as typeof tasks;
  const filteredNotes = (remote ? remote.notes : local.notes) as typeof notes;
  const filteredProjects = (remote ? remote.projects : local.projects) as typeof projects;
  const filteredHabits = (remote ? remote.habits : local.habits) as typeof habits;
  const filteredJournal = (remote?.journal ?? []) as { id: string; date: string; content: string }[];

  function handleClose() {
    setQuery('');
    close();
  }

  const data: PaletteRow[] = [];
  if (!q && recents.length > 0) {
    data.push({ type: 'section', id: 'sec:recents', label: 'Son kullanılanlar' });
    recents.forEach((r) =>
      data.push({
        type: 'recent',
        id: 'r:' + r.route,
        label: r.label,
        a11yLabel: r.label,
        icon: r.icon,
        color: r.color,
        target: r.href ?? r.route,
      }),
    );
  }
  if (filteredActions.length > 0) {
    data.push({ type: 'section', id: 'sec:actions', label: 'Hızlı Eylemler' });
    filteredActions.forEach((a) =>
      data.push({
        type: 'action',
        id: 'a:' + a.id,
        label: a.label,
        a11yLabel: a.label,
        icon: a.icon,
        color: a.color,
        action: a.action,
      }),
    );
  }
  if (filteredTasks.length > 0) {
    data.push({ type: 'section', id: 'sec:tasks', label: 'Görevler' });
    filteredTasks.forEach((t) =>
      data.push({
        type: 'go',
        id: 't:' + t.id,
        label: t.title,
        a11yLabel: `Görev: ${t.title}`,
        icon: 'list-outline',
        color: colors.accent,
        target: { pathname: '/tabs/plan', params: { tab: 'tasks', focus: t.id } },
      }),
    );
  }
  if (filteredNotes.length > 0) {
    data.push({ type: 'section', id: 'sec:notes', label: 'Notlar' });
    filteredNotes.forEach((n) => {
      const noteTitle = n.title || 'Başlıksız not';
      data.push({
        type: 'go',
        id: 'n:' + n.id,
        label: noteTitle,
        a11yLabel: `Not: ${noteTitle}`,
        icon: 'document-text-outline',
        color: colors.teal,
        target: { pathname: '/screens/notes', params: { focus: n.id } },
      });
    });
  }
  if (filteredProjects.length > 0) {
    data.push({ type: 'section', id: 'sec:projects', label: 'Projeler' });
    filteredProjects.forEach((p) =>
      data.push({
        type: 'go',
        id: 'p:' + p.id,
        label: p.name,
        a11yLabel: `Proje: ${p.name}`,
        icon: 'folder-outline',
        color: colors.success,
        target: { pathname: '/tabs/plan', params: { tab: 'projects', focus: p.id } },
      }),
    );
  }
  if (filteredHabits.length > 0) {
    data.push({ type: 'section', id: 'sec:habits', label: 'Alışkanlıklar' });
    filteredHabits.forEach((h) =>
      data.push({
        type: 'go',
        id: 'h:' + h.id,
        label: h.name,
        a11yLabel: `Alışkanlık: ${h.name}`,
        icon: h.icon ?? 'star-outline',
        color: h.color ?? colors.accent,
        target: { pathname: '/screens/habit-detail', params: { id: h.id } },
      }),
    );
  }
  if (filteredJournal.length > 0) {
    data.push({ type: 'section', id: 'sec:journal', label: 'Günlük' });
    filteredJournal.forEach((e) => {
      const excerpt = e.content.replace(/\s+/g, ' ').trim().slice(0, 60);
      const label = `${e.date} — ${excerpt}`;
      data.push({
        type: 'go',
        id: 'j:' + e.id,
        label,
        a11yLabel: `Günlük: ${label}`,
        icon: 'journal-outline',
        color: colors.primary,
        target: { pathname: '/screens/journal-reader', params: { date: e.date } },
      });
    });
  }

  const allSourcesFailed = failedSources.length >= 5;
  if (data.length === 0) {
    if (searching) data.push({ type: 'loading', id: 'state:loading' });
    else if (allSourcesFailed) data.push({ type: 'error', id: 'state:error' });
    else data.push({ type: 'empty', id: 'state:empty' });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Komut paletini kapat"
        />

        <View style={styles.container}>
          <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" opacity={0.14} size={136} />
          {/* Input */}
          <View style={styles.inputRow}>
            <Ionicons name="search-outline" size={18} color={colors.textFaint} />
            <TextInput
              style={styles.input}
              placeholder="Ara: görev, not, proje, alışkanlık veya eylem…"
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCorrect={false}
              accessibilityLabel="Komut veya içerik ara"
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Aramayı temizle"
              >
                <Ionicons name="close-circle" size={18} color={colors.textFaint} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.divider} />

          {failedSources.length > 0 && !allSourcesFailed && (
            <Text style={styles.partialText} accessibilityLabel="Arama kısmen başarısız">
              Bazı kaynaklar yanıt vermedi ({failedSources.join(', ')}); sonuçlar eksik olabilir.
            </Text>
          )}

          <FlatList
            data={data}
            keyExtractor={(item) => item.id}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              if (item.type === 'section') {
                return <Text style={styles.sectionLabel}>{item.label}</Text>;
              }
              if (item.type === 'loading') {
                return <Text style={styles.emptyText} accessibilityLabel="Aranıyor">Aranıyor…</Text>;
              }
              if (item.type === 'error') {
                return (
                  <Text style={styles.errorText} accessibilityLabel="Arama başarısız">
                    Arama şu anda yapılamadı. Bağlantını kontrol edip tekrar dene.
                  </Text>
                );
              }
              if (item.type === 'empty') {
                return <Text style={styles.emptyText}>Sonuç yok</Text>;
              }
              const iconName = item.icon as keyof typeof Ionicons.glyphMap;
              return (
                <TouchableOpacity
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityLabel={item.a11yLabel}
                  onPress={() => {
                    if (item.type === 'action') item.action();
                    else go(item.target, item.label, item.icon, item.color);
                  }}
                >
                  <View style={[styles.rowIcon, { backgroundColor: alphaHex(item.color, '20') }]}>
                    <Ionicons name={iconName} size={18} color={item.color} />
                  </View>
                  <Text style={styles.rowLabel} numberOfLines={2}>{item.label}</Text>
                  <Ionicons
                    name={item.type === 'recent' ? 'time-outline' : 'arrow-forward-outline'}
                    size={14}
                    color={colors.textGhost}
                  />
                </TouchableOpacity>
              );
            }}
          />

          <TouchableOpacity
            style={styles.closeRow}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Komut paletini kapat"
          >
            <Text style={styles.closeText}>Kapat</Text>
            <View style={styles.escBadge}><Text style={styles.escText}>ESC</Text></View>
          </TouchableOpacity>
        </View>
      </BlurView>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFill },
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
    errorText: { fontSize: 14, color: colors.error, textAlign: 'center', padding: 24, lineHeight: 20 },
    partialText: {
      fontSize: 12, color: colors.warning, paddingHorizontal: 16, paddingVertical: 8, lineHeight: 17,
    },
    row: {
      minHeight: 44,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
    },
    rowIcon: {
      width: 34, height: 34, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center',
    },
    rowLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '500' },
    closeRow: {
      minHeight: 44,
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
