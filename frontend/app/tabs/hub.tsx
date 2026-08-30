import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { colors, space, radius, font } from '../../lib/tokens';
import { IconCircle } from '../../components/ui';
import { todayLocal } from '../../lib/date';

type HubItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  route: string;
};

const GROUPS: { title: string; items: HubItem[] }[] = [
  {
    title: 'Akış',
    items: [
      { label: 'Takvim', icon: 'calendar-outline', color: '#8b5cf6', route: '/screens/calendar' },
      { label: 'Telafi', icon: 'refresh-circle-outline', color: '#f59e0b', route: '/screens/recovery' },
    ],
  },
  {
    title: 'Listeler',
    items: [
      { label: 'Gelen', icon: 'mail-outline', color: '#06b6d4', route: '/tabs/tasks?tab=inbox' },
      { label: 'Bu Hafta', icon: 'today-outline', color: '#6366f1', route: '/tabs/tasks?tab=this_week' },
      { label: 'Bir Gün', icon: 'time-outline', color: '#9ca3af', route: '/tabs/tasks?tab=someday' },
      { label: 'Arşiv', icon: 'archive-outline', color: '#4b5563', route: '/tabs/tasks?tab=done' },
    ],
  },
  {
    title: 'Projeler & Planlama',
    items: [
      { label: 'Projeler', icon: 'folder-outline', color: '#10b981', route: '/screens/projects' },
      { label: 'Haftalık Rapor', icon: 'bar-chart-outline', color: '#14b8a6', route: '/screens/weekly-review' },
    ],
  },
  {
    title: 'Kişisel',
    items: [
      { label: 'Notlar', icon: 'document-text-outline', color: '#9ca3af', route: '/screens/notes' },
      { label: 'Journal', icon: 'journal-outline', color: '#ec4899', route: '/screens/journal' },
    ],
  },
  {
    title: 'Sistem',
    items: [
      { label: 'İstatistikler', icon: 'stats-chart-outline', color: '#6366f1', route: '/tabs/stats' },
      { label: 'Ayarlar', icon: 'settings-outline', color: '#6b7280', route: '/tabs/settings' },
    ],
  },
];

export default function HubScreen() {
  const router = useRouter();
  const { tasks } = useTaskStore();
  useHabitStore();

  const inboxCount = tasks.filter((t) => t.list_type === 'inbox' && !t.completed).length;
  const recoveryCount = tasks.filter(
    (t) => t.due_date && t.due_date < todayLocal() && !t.completed
  ).length;

  function getBadge(route: string) {
    if (route.includes('inbox')) return inboxCount;
    if (route.includes('recovery')) return recoveryCount;
    return 0;
  }

  function navigate(route: string) {
    const base = route.split('?')[0];
    router.push(base as any);
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.pageTitle}>Keşfet</Text>

        {GROUPS.map((group) => (
          <View key={group.title} style={s.group}>
            <Text style={s.groupTitle}>{group.title.toUpperCase()}</Text>
            <View style={s.grid}>
              {group.items.map((item) => {
                const badge = getBadge(item.route);
                return (
                  <TouchableOpacity
                    key={item.label}
                    style={s.card}
                    activeOpacity={0.75}
                    onPress={() => navigate(item.route)}
                  >
                    <View>
                      <IconCircle icon={item.icon} color={item.color} size={48} radiusKey="md" />
                      {badge > 0 && (
                        <View style={[s.badge, { backgroundColor: item.color }]}>
                          <Text style={s.badgeText}>{badge}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.cardLabel} numberOfLines={1}>{item.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.xl, paddingBottom: space.hh },
  pageTitle: { ...font.display, color: colors.text, marginBottom: space.xxl },

  group: { marginBottom: space.xxl },
  groupTitle: { ...font.overline, color: colors.textFaint, marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },

  card: {
    width: '22%', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: space.lg, paddingHorizontal: space.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  badge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
    borderWidth: 2, borderColor: colors.surface,
  },
  badgeText: { fontSize: 10, color: colors.white, fontWeight: '800' },
  cardLabel: { fontSize: 11, color: colors.textDim, textAlign: 'center', fontWeight: '600' },
});
