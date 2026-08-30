import { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  Modal, Pressable, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDrawerStore } from '../store/drawerStore';
import { fontFamily, colors } from '../lib/tokens';

const DRAWER_WIDTH = 280;

type DrawerItem = {
  label: string;
  icon: string;
  color: string;
  route: string;
};

const GROUPS: { title: string; items: DrawerItem[] }[] = [
  {
    title: 'PLANLAMA',
    items: [
      { label: 'Takvim', icon: 'calendar-outline', color: '#8b5cf6', route: '/screens/calendar' },
      { label: 'Haftalık Rapor', icon: 'bar-chart-outline', color: '#14b8a6', route: '/screens/weekly-review' },
      { label: 'Aylık Rapor', icon: 'calendar-number-outline', color: colors.accent, route: '/screens/monthly-review' },
      { label: 'Telafi', icon: 'refresh-circle-outline', color: colors.warning, route: '/screens/recovery' },
      { label: 'Eisenhower', icon: 'grid-outline', color: colors.error, route: '/screens/eisenhower' },
      { label: 'Derin Çalışma', icon: 'flash-outline', color: colors.teal, route: '/screens/deep-work' },
    ],
  },
  {
    title: 'TOPLULUK',
    items: [
      { label: 'Sıralama', icon: 'podium-outline', color: colors.warning, route: '/screens/leaderboard' },
      { label: 'Profilim', icon: 'person-circle-outline', color: colors.success, route: '/screens/profile' },
    ],
  },
  {
    title: 'KİŞİSEL',
    items: [
      { label: 'Projeler', icon: 'folder-outline', color: colors.success, route: '/screens/projects' },
      { label: 'Notlar', icon: 'document-text-outline', color: colors.textDim, route: '/screens/notes' },
      { label: 'Journal', icon: 'journal-outline', color: '#ec4899', route: '/screens/journal' },
      { label: 'Okuma Listesi', icon: 'book-outline', color: '#8b5cf6', route: '/screens/reading-list' },
      { label: 'Hedefler', icon: 'trophy-outline', color: colors.warning, route: '/screens/goals' },
      { label: 'OKR', icon: 'flag-outline', color: colors.error, route: '/screens/okr' },
      { label: 'Yaşam Alanları', icon: 'radio-button-on-outline', color: colors.success, route: '/screens/life-areas' },
      { label: 'AI Coach', icon: 'sparkles-outline', color: '#8b5cf6', route: '/screens/ai-coach' },
    ],
  },
  {
    title: 'ALIŞKANLIKLAR',
    items: [
      { label: 'Alışkanlık Yönetimi', icon: 'list-circle-outline', color: colors.accent, route: '/tabs/habits' },
      { label: 'AI Rutin Oluştur', icon: 'sparkles-outline', color: '#8b5cf6', route: '/tabs/habits?ai=true' },
      { label: 'İçgörüler', icon: 'analytics-outline', color: '#14b8a6', route: '/screens/insights' },
    ],
  },
  {
    title: 'SİSTEM',
    items: [
      { label: 'Üyelik & Krediler', icon: 'diamond-outline', color: colors.warning, route: '/screens/paywall' },
      { label: 'Entegrasyonlar', icon: 'git-network-outline', color: colors.teal, route: '/screens/integrations' },
      { label: 'Ayarlar', icon: 'settings-outline', color: colors.textFaint, route: '/tabs/settings' },
      { label: 'İstatistikler', icon: 'stats-chart-outline', color: colors.accent, route: '/tabs/stats' },
    ],
  },
];

export default function Drawer() {
  const router = useRouter();
  const { isOpen, close } = useDrawerStore();
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: isOpen ? 0 : -DRAWER_WIDTH,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
      }),
      Animated.timing(backdropOpacity, {
        toValue: isOpen ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isOpen, translateX, backdropOpacity]);

  function navigate(route: string) {
    const base = route.split('?')[0];
    close();
    setTimeout(() => router.push(base as any), 100);
  }

  if (!isOpen && Platform.OS !== 'web') return null;

  return (
    <Modal visible={isOpen} transparent animationType="none" onRequestClose={close}>
      {/* Backdrop */}
      <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      {/* Panel */}
      <Animated.View style={[s.panel, { transform: [{ translateX }] }]}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <View style={s.avatar}>
                <Ionicons name="person" size={20} color="#D97757" />
              </View>
              <View>
                <Text style={s.appName}>Atlas</Text>
                <Text style={s.userEmail} numberOfLines={1}>Kişisel Sistem</Text>
              </View>
            </View>
            <TouchableOpacity onPress={close} style={s.closeBtn}>
              <Ionicons name="close" size={20} color="#827E72" />
            </TouchableOpacity>
          </View>

          <View style={s.divider} />

          {/* Nav items */}
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            {GROUPS.map((group) => (
              <View key={group.title} style={s.group}>
                <Text style={s.groupTitle}>{group.title}</Text>
                {group.items.map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    style={s.item}
                    onPress={() => navigate(item.route)}
                  >
                    <View style={[s.itemIcon, { backgroundColor: item.color + '20' }]}>
                      <Ionicons name={item.icon as any} size={18} color={item.color} />
                    </View>
                    <Text style={s.itemLabel}>{item.label}</Text>
                    <Ionicons name="chevron-forward" size={14} color="#56544B" />
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    shadowColor: colors.black,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 4, height: 0 },
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: '#D9775720',
    alignItems: 'center', justifyContent: 'center',
  },
  appName: { fontFamily: fontFamily.serif, fontSize: 19, fontWeight: '400', letterSpacing: -0.3, color: colors.text },
  userEmail: { fontSize: 11, color: colors.textFaint, maxWidth: 160 },
  closeBtn: { padding: 4 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 0 },
  scroll: { padding: 12, paddingBottom: 40 },
  group: { marginBottom: 20 },
  groupTitle: { fontSize: 10, fontWeight: '700', color: colors.textGhost, letterSpacing: 1.2, marginBottom: 6, paddingLeft: 8 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10,
  },
  itemIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  itemLabel: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '500' },
});
