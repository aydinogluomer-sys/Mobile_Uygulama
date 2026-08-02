import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, TouchableOpacity, View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { useCommandStore } from '../../store/commandStore';
import { useTaskStore } from '../../store/taskStore';
import { useDrawerStore } from '../../store/drawerStore';
import { useThemeStore } from '../../store/themeStore';
import Drawer from '../../components/Drawer';
import { colors } from '../../lib/tokens';
import { useAccent } from '../../lib/useAccent';

function HamburgerButton() {
  const open = useDrawerStore((s) => s.open);
  return (
    <TouchableOpacity onPress={open} style={{ marginLeft: 16 }} accessibilityRole="button" accessibilityLabel="Menüyü aç">
      <Ionicons name="menu-outline" size={24} color={colors.textDim} />
    </TouchableOpacity>
  );
}

/** Topbar sağ küme (HTML topbar paritesi): Odak modu · "Komut veya ara" · Tema toggle */
function HeaderActions() {
  const openCmd = useCommandStore((s) => s.open);
  const router = useRouter();
  const isDark = useThemeStore((s) => s.isDark);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const accent = useAccent();
  const { width } = useWindowDimensions();
  const showSearch = width >= 720;
  return (
    <View style={h.row}>
      {/* Tema toggle (son) */}
      <TouchableOpacity style={h.iconBtn} onPress={toggleTheme} accessibilityRole="button" accessibilityLabel="Tema değiştir">
        <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={18} color={accent.bright} />
      </TouchableOpacity>
      {/* Odak modu */}
      <TouchableOpacity style={h.iconBtn} onPress={() => router.push('/tabs/focus' as any)} accessibilityRole="button" accessibilityLabel="Odak modunu aç">
        <Ionicons name="timer-outline" size={18} color={colors.textDim} />
      </TouchableOpacity>
      {/* Komut veya ara */}
      {showSearch && (
        <TouchableOpacity style={h.searchPill} onPress={openCmd} accessibilityRole="button" accessibilityLabel="Komut paletini aç veya ara">
          <Ionicons name="search-outline" size={15} color={colors.textFaint} />
          <Text style={h.searchText} numberOfLines={1}>Komut veya ara</Text>
          <Text style={h.shortcut}>⌘ K</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const h = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 12 },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  searchPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 32,
    paddingHorizontal: 10, borderRadius: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    maxWidth: 150,
  },
  searchText: { fontSize: 12, color: colors.textFaint, flexShrink: 1 },
  shortcut: { fontSize: 10, color: colors.textGhost, marginLeft: 4 },
});

export default function TabLayout() {
  const inboxCount = useTaskStore((s) => s.tasks.filter((t) => t.list_type === 'inbox' && !t.completed).length);
  const accent = useAccent();

  return (
    <>
      <Drawer />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: accent.bright,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarStyle: {
            backgroundColor: colors.bgElevated,
            borderTopColor: colors.borderSubtle,
            borderTopWidth: 1,
            height: Platform.OS === 'ios' ? 88 : 62,
            paddingBottom: Platform.OS === 'ios' ? 24 : 8,
            paddingTop: 6,
          },
          headerStyle: {
            backgroundColor: colors.bgElevated,
            borderBottomColor: colors.borderSubtle,
            borderBottomWidth: 1,
          },
          headerTintColor: colors.text,
          headerTitleAlign: 'center',
          headerLeft: () => <HamburgerButton />,
          headerRight: () => <HeaderActions />,
        }}
      >
        <Tabs.Screen
          name="today"
          options={{
            title: 'Bugün',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="sunny-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="tasks"
          options={{
            title: 'Görevler',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="list-outline" size={size} color={color} />
            ),
            tabBarBadge: inboxCount > 0 ? inboxCount : undefined,
          }}
        />
        <Tabs.Screen
          name="focus"
          options={{
            title: 'Odak',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="timer-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="timeline"
          options={{
            title: 'Alışkanlıklar',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="checkmark-circle-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="stats"
          options={{
            title: 'İstatistikler',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="stats-chart-outline" size={size} color={color} />
            ),
          }}
        />

        {/* Gizlenen sekmeler */}
        <Tabs.Screen name="habits" options={{ href: null }} />
        <Tabs.Screen name="hub" options={{ href: null }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
      </Tabs>
    </>
  );
}
