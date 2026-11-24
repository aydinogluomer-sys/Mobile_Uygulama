import { useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity, View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCommandStore } from '../../store/commandStore';
import { useTaskStore } from '../../store/taskStore';
import { useDrawerStore } from '../../store/drawerStore';
import { useThemeStore } from '../../store/themeStore';
import Drawer from '../../components/Drawer';
import OutboxStatusModal from '../../components/OutboxStatusModal';
import { LIGHT_THEME_ENABLED } from '../../lib/featureGates';
import { navigateTo } from '../../lib/destinations';
import { tabBarHeight, tabBarPaddingBottom } from '../../lib/layoutMetrics';
import { type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useAccent } from '../../lib/useAccent';

export const unstable_settings = { initialRouteName: 'today' };

function HamburgerButton() {
  const open = useDrawerStore((s) => s.open);
  const c = useThemeColors();
  return (
    <TouchableOpacity onPress={open} style={{ marginLeft: 16 }} accessibilityRole="button" accessibilityLabel="Menüyü aç">
      <Ionicons name="menu-outline" size={24} color={c.textDim} />
    </TouchableOpacity>
  );
}

const makeHeaderStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 12 },
    iconBtn: {
      width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    },
    searchPill: {
      flexDirection: 'row', alignItems: 'center', gap: 5, height: 32,
      paddingHorizontal: 10, borderRadius: 8,
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
      maxWidth: 150,
    },
    searchText: { fontSize: 12, color: c.textFaint, flexShrink: 1 },
    shortcut: { fontSize: 10, color: c.textFaint, marginLeft: 4 },
  });

/** Topbar sağ küme (HTML topbar paritesi): Odak modu · "Komut veya ara" · Tema toggle */
function HeaderActions({ onOpenSync }: { onOpenSync: () => void }) {
  const openCmd = useCommandStore((s) => s.open);
  const router = useRouter();
  const isDark = useThemeStore((s) => s.isDark);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const c = useThemeColors();
  const h = useThemedStyles(makeHeaderStyles);
  const accent = useAccent();
  const { width } = useWindowDimensions();
  const showSearch = width >= 720;
  return (
    <View style={h.row}>
      {/* Çevrimdışı Senkronizasyon & Outbox */}
      <TouchableOpacity style={h.iconBtn} onPress={onOpenSync} accessibilityRole="button" accessibilityLabel="Senkronizasyon durumunu aç">
        <Ionicons name="cloud-done-outline" size={17} color={c.textDim} />
      </TouchableOpacity>
      {/* Tema toggle — yalnız açık tema kapısı açıldığında görünür */}
      {LIGHT_THEME_ENABLED ? (
        <TouchableOpacity style={h.iconBtn} onPress={toggleTheme} accessibilityRole="button" accessibilityLabel="Tema değiştir">
          <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={18} color={accent.bright} />
        </TouchableOpacity>
      ) : null}
      {/* Odak modu */}
      <TouchableOpacity style={h.iconBtn} onPress={() => navigateTo(router, 'focus')} accessibilityRole="button" accessibilityLabel="Odak modunu aç">
        <Ionicons name="timer-outline" size={18} color={c.textDim} />
      </TouchableOpacity>
      {/* Komut veya ara (Hem mobil hem masaüstünde erişilebilir) */}
      {showSearch ? (
        <TouchableOpacity style={h.searchPill} onPress={openCmd} accessibilityRole="button" accessibilityLabel="Komut paletini aç veya ara">
          <Ionicons name="search-outline" size={15} color={c.textFaint} />
          <Text style={h.searchText} numberOfLines={1}>Komut veya ara</Text>
          <Text style={h.shortcut}>⌘ K</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={h.iconBtn} onPress={openCmd} accessibilityRole="button" accessibilityLabel="Komut paletini aç veya ara">
          <Ionicons name="search-outline" size={18} color={c.textDim} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function TabLayout() {
  const inboxCount = useTaskStore((s) => s.tasks.filter((t) => t.list_type === 'inbox' && !t.completed).length);
  const c = useThemeColors();
  const accent = useAccent();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [showOutboxModal, setShowOutboxModal] = useState(false);

  return (
    <>
      <Drawer />
      <OutboxStatusModal visible={showOutboxModal} onClose={() => setShowOutboxModal(false)} />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: accent.bright,
          tabBarInactiveTintColor: c.textFaint,
          tabBarLabel: ({ children, color }) => (
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{ color, fontSize: 11, lineHeight: 14, fontWeight: '600', paddingBottom: 2 }}
            >
              {children}
            </Text>
          ),
          tabBarStyle: {
            backgroundColor: c.bgElevated,
            borderTopColor: c.borderSubtle,
            borderTopWidth: 1,
            height: tabBarHeight(insets.bottom, fontScale),
            paddingBottom: tabBarPaddingBottom(insets.bottom),
            paddingTop: 6,
          },
          headerStyle: {
            backgroundColor: c.bgElevated,
            borderBottomColor: c.borderSubtle,
            borderBottomWidth: 1,
          },
          headerTintColor: c.text,
          headerTitleAlign: 'center',
          headerLeft: () => <HamburgerButton />,
          headerRight: () => <HeaderActions onOpenSync={() => setShowOutboxModal(true)} />,
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
          name="plan"
          options={{
            title: 'Plan',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="calendar-outline" size={size} color={color} />
            ),
            tabBarBadge: inboxCount > 0 ? inboxCount : undefined,
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
          name="insights"
          options={{
            title: 'İçgörüler',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="analytics-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-circle-outline" size={size} color={color} />
            ),
          }}
        />

        {/* Hidden legacy routes preserved for deep-link redirects */}
        <Tabs.Screen name="tasks" options={{ href: null, title: 'Görevler' }} />
        <Tabs.Screen name="focus" options={{ href: null, title: 'Odak' }} />
        <Tabs.Screen name="stats" options={{ href: null, title: 'İstatistikler' }} />
        <Tabs.Screen name="habits" options={{ href: null, title: 'Alışkanlıklar' }} />
        <Tabs.Screen name="hub" options={{ href: null, title: 'Keşfet' }} />
        <Tabs.Screen name="settings" options={{ href: null, title: 'Ayarlar' }} />
      </Tabs>
    </>
  );
}
