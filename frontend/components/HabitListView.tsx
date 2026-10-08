import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useHabitStore } from '../store/habitStore';
import {
  computeTriage, TRIAGE_META, impactMeta, endConditionLabel, IMPACT_LEVELS,
  type ImpactLevel,
} from '../lib/triage';
import { LIFE_AREAS } from '../store/lifeAreasStore';
import type { Habit } from '../lib/supabase';
import { colors, space, radius, font, hexA, shadow, fontFamily } from '../lib/tokens';
import { useReducedMotion } from './seasonalMotion/useReducedMotion';
import { haptic } from '../lib/haptics';
import { Chip, Badge, IconCircle, EmptyState } from './ui';
import { isMeasurableTracking } from '../lib/habitEngine';

type StatusKey = 'active' | 'waiting' | 'idea' | 'completed';
type SortKey = 'impact' | 'willpower' | 'name' | 'recent';

const STATUS_META: Record<StatusKey, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  active: { label: 'Yapılıyor', color: colors.success, icon: 'rocket' },
  waiting: { label: 'Yapılacak', color: colors.warning, icon: 'hourglass-outline' },
  idea: { label: 'Fikir', color: colors.textFaint, icon: 'bulb-outline' },
  completed: { label: 'Yapıldı', color: colors.teal, icon: 'checkmark-done-circle-outline' },
};
const STATUS_ORDER: StatusKey[] = ['active', 'waiting', 'idea', 'completed'];

const SORTS: { key: SortKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'impact', label: 'Etki', icon: 'flame-outline' },
  { key: 'willpower', label: 'İrade', icon: 'flash-outline' },
  { key: 'name', label: 'İsim', icon: 'text-outline' },
  { key: 'recent', label: 'Yeni', icon: 'time-outline' },
];

const IMPACT_RANK: Record<ImpactLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Android'de LayoutAnimation'ı etkinleştir (grup aç/kapa geçişi)
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function areaMeta(key: string | null | undefined) {
  return LIFE_AREAS.find((a) => a.key === key) ?? null;
}

// Tüm alışkanlıkların yönetim/genel-bakış görünümü (İstatistikler → Liste sekmesi).
// Durum bazlı gruplama + filtre + sıralama: bir kontrol merkezi.
export default function HabitListView() {
  const router = useRouter();
  const { habits, loading, fetchHabits } = useHabitStore();
  const [statusFilter, setStatusFilter] = useState<Set<StatusKey>>(new Set());
  const [impactFilter, setImpactFilter] = useState<Set<ImpactLevel>>(new Set());
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('impact');
  const [showPanel, setShowPanel] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<StatusKey>>(new Set());

  useEffect(() => { fetchHabits(); }, [fetchHabits]);

  const reduceMotion = useReducedMotion();
  function animate() {
    if (reduceMotion) return; // R06.04
    LayoutAnimation.configureNext(
      LayoutAnimation.create(180, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
    );
  }

  function toggleStatus(st: StatusKey) {
    haptic.select();
    setStatusFilter((prev) => { const n = new Set(prev); if (n.has(st)) n.delete(st); else n.add(st); return n; });
  }
  function toggleImpact(i: ImpactLevel) {
    haptic.select();
    setImpactFilter((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  }
  function toggleCollapse(st: StatusKey) {
    haptic.select(); animate();
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(st)) n.delete(st); else n.add(st); return n; });
  }
  function clearAll() {
    haptic.light();
    setStatusFilter(new Set()); setImpactFilter(new Set()); setSearch('');
  }

  const counts = STATUS_ORDER.reduce((acc, st) => {
    acc[st] = habits.filter((h) => h.status === st).length;
    return acc;
  }, {} as Record<StatusKey, number>);

  const q = search.trim().toLowerCase();
  const hasFilter = statusFilter.size > 0 || impactFilter.size > 0 || q.length > 0;

  const filtered = habits.filter((h) => {
    if (statusFilter.size > 0 && !statusFilter.has(h.status as StatusKey)) return false;
    if (impactFilter.size > 0 && !(h.impact_level && impactFilter.has(h.impact_level))) return false;
    if (q && !h.name.toLowerCase().includes(q)) return false;
    return true;
  });

  function sortHabits(list: Habit[]): Habit[] {
    const arr = [...list];
    if (sortBy === 'impact') {
      arr.sort((a, b) => {
        const ra = IMPACT_RANK[a.impact_level ?? 'low'] ?? 3;
        const rb = IMPACT_RANK[b.impact_level ?? 'low'] ?? 3;
        if (ra !== rb) return ra - rb;
        return (b.willpower_cost ?? 0) - (a.willpower_cost ?? 0);
      });
    } else if (sortBy === 'willpower') {
      arr.sort((a, b) => (b.willpower_cost ?? 0) - (a.willpower_cost ?? 0));
    } else if (sortBy === 'name') {
      arr.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    }
    // recent: fetch sırası (created_at ↓) korunur
    return arr;
  }

  const groups = STATUS_ORDER
    .filter((st) => statusFilter.size === 0 || statusFilter.has(st))
    .map((st) => ({ status: st, items: sortHabits(filtered.filter((h) => h.status === st)) }))
    .filter((g) => g.items.length > 0);

  const totalShown = filtered.length;
  const noneAtAll = habits.length === 0;

  const renderRow = (habit: Habit) => {
    const imp = habit.impact_level ? impactMeta(habit.impact_level) : null;
    const accent = imp?.color ?? habit.color ?? colors.primary;
    const triage = computeTriage(habit.impact_level, habit.urgency);
    const tmeta = TRIAGE_META[triage];
    const area = areaMeta(habit.life_area);
    return (
      <TouchableOpacity
        key={habit.id}
        style={s.row}
        activeOpacity={0.75}
        onPress={() => { haptic.light(); router.push({ pathname: '/screens/habit-detail', params: { id: habit.id } } as any); }}
      >
        <View style={[s.accent, { backgroundColor: accent }]} />
        <IconCircle icon={(habit.icon ?? 'star-outline') as any} color={habit.color ?? accent} size={40} radiusKey="sm" />
        <View style={{ flex: 1 }}>
          <Text style={s.rowName} numberOfLines={1}>{habit.name}</Text>
          <View style={s.rowChips}>
            <Chip label={tmeta.label} icon={tmeta.icon as any} color={tmeta.color} size="sm" />
            <Badge label={habit.willpower_cost} icon="flash" color={colors.warning} />
            {isMeasurableTracking(habit.tracking_type) && !!habit.unit && <Badge label={habit.unit} color={colors.primary} />}
            {habit.estimated_minutes > 0 && <Badge label={`${habit.estimated_minutes}dk`} icon="timer-outline" color={colors.teal} />}
            {habit.reminders?.enabled && <Badge label={habit.reminders.time} icon="notifications" color={colors.accent} />}
            {area && <Chip label={area.label} dot color={area.color} size="sm" />}
          </View>
          {habit.end_condition && (
            <View style={s.rowSubRow}>
              <Ionicons name="hourglass-outline" size={11} color={colors.textFaint} />
              <Text style={s.rowSub}>{endConditionLabel(habit.end_condition)}</Text>
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textGhost} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.container}>
      {/* Toolbar: arama + filtre/sırala paneli toggle */}
      <View style={s.toolbar}>
        <View style={s.searchWrap}>
          <Ionicons name="search-outline" size={16} color={colors.textFaint} />
          <TextInput
            style={s.searchInput}
            placeholder="Alışkanlık ara..."
            placeholderTextColor={colors.textFaint}
            value={search}
            onChangeText={setSearch}
          />
          {q.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={colors.textFaint} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[s.panelBtn, (showPanel || impactFilter.size > 0) && s.panelBtnActive]}
          onPress={() => { haptic.select(); animate(); setShowPanel((v) => !v); }}
        >
          <Ionicons name="options-outline" size={18} color={showPanel || impactFilter.size > 0 ? colors.primaryBright : colors.textDim} />
          {impactFilter.size > 0 && <View style={s.panelDot} />}
        </TouchableOpacity>
      </View>

      {/* Durum pill'leri — her zaman görünür (hızlı filtre) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.statusStrip} contentContainerStyle={s.statusStripContent}>
        {STATUS_ORDER.map((st) => {
          const m = STATUS_META[st];
          const sel = statusFilter.has(st);
          return (
            <TouchableOpacity
              key={st}
              activeOpacity={0.75}
              onPress={() => toggleStatus(st)}
              style={[s.statusPill, sel && { backgroundColor: hexA(m.color, 0.16), borderColor: m.color }]}
            >
              <Ionicons name={m.icon} size={13} color={m.color} />
              <Text style={[s.statusPillLabel, sel && { color: m.color }]}>{m.label}</Text>
              <View style={[s.statusPillCount, sel && { backgroundColor: hexA(m.color, 0.22) }]}>
                <Text style={[s.statusPillCountText, sel && { color: m.color }]}>{counts[st]}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Collapsible panel: sırala + etki filtresi + temizle */}
      {showPanel && (
        <View style={s.panel}>
          <Text style={s.panelLabel}>SIRALA</Text>
          <View style={s.panelRow}>
            {SORTS.map((so) => (
              <Chip
                key={so.key}
                label={so.label}
                icon={so.icon}
                color={colors.primaryBright}
                selected={sortBy === so.key}
                onPress={() => { haptic.select(); setSortBy(so.key); }}
              />
            ))}
          </View>
          <Text style={[s.panelLabel, { marginTop: space.md }]}>ETKİ</Text>
          <View style={s.panelRow}>
            {IMPACT_LEVELS.map((lv) => (
              <Chip
                key={lv.key}
                label={lv.label}
                dot
                color={lv.color}
                selected={impactFilter.has(lv.key)}
                onPress={() => toggleImpact(lv.key)}
              />
            ))}
          </View>
          {hasFilter && (
            <TouchableOpacity style={s.clearBtn} onPress={clearAll}>
              <Ionicons name="close" size={14} color={colors.error} />
              <Text style={s.clearText}>Filtreleri temizle</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Liste */}
      {loading && habits.length === 0 ? (
        <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : noneAtAll ? (
        <EmptyState
          icon="albums-outline"
          title="Henüz alışkanlık yok"
          hint="İlk alışkanlığını ekleyerek sistemini kurmaya başla."
          ctaLabel="Alışkanlık Ekle"
          onCta={() => router.push('/tabs/habits')}
        />
      ) : totalShown === 0 ? (
        <EmptyState
          icon="funnel-outline"
          title="Eşleşen alışkanlık yok"
          hint="Aramayı değiştir ya da filtreleri temizle."
          ctaLabel="Filtreleri Temizle"
          onCta={clearAll}
          color={colors.warning}
        />
      ) : (
        <ScrollView style={s.list} contentContainerStyle={{ padding: space.md, paddingBottom: 90 }} showsVerticalScrollIndicator={false}>
          <View style={s.resultBar}>
            <Text style={s.resultText}>
              {totalShown} alışkanlık · {SORTS.find((x) => x.key === sortBy)?.label} sıralı
            </Text>
            {hasFilter && (
              <TouchableOpacity onPress={clearAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.resultClear}>Temizle</Text>
              </TouchableOpacity>
            )}
          </View>
          {groups.map((g) => {
            const m = STATUS_META[g.status];
            const isCollapsed = collapsed.has(g.status);
            return (
              <View key={g.status} style={s.group}>
                <TouchableOpacity style={s.groupHead} activeOpacity={0.7} onPress={() => toggleCollapse(g.status)}>
                  <Ionicons name={m.icon} size={16} color={m.color} />
                  <Text style={[s.groupTitle, { color: m.color }]}>{m.label}</Text>
                  <View style={s.groupCount}><Text style={s.groupCountText}>{g.items.length}</Text></View>
                  <View style={{ flex: 1 }} />
                  <Ionicons name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={16} color={colors.textFaint} />
                </TouchableOpacity>
                {!isCollapsed && g.items.map(renderRow)}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Ekle FAB → alışkanlık akışı */}
      <TouchableOpacity style={s.fab} onPress={() => router.push('/tabs/habits')} accessibilityLabel="Alışkanlık ekle">
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.md, height: 42,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },
  panelBtn: {
    width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  panelBtnActive: { borderColor: colors.primary, backgroundColor: hexA(colors.primary, 0.1) },
  panelDot: { position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primaryBright },

  statusStrip: { maxHeight: 44 },
  statusStripContent: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 4 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface, borderRadius: radius.pill, paddingLeft: 10, paddingRight: 6, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  statusPillLabel: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  statusPillCount: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  statusPillCountText: { fontSize: 11, fontWeight: '700', color: colors.textFaint },

  panel: {
    marginHorizontal: space.lg, marginTop: space.sm, marginBottom: space.xs,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: space.md,
  },
  panelLabel: { ...font.overline, color: colors.textFaint, marginBottom: space.sm },
  panelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: space.md, paddingVertical: 4 },
  clearText: { fontSize: 13, color: colors.error, fontWeight: '600' },

  list: { flex: 1 },
  resultBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: space.sm },
  resultText: { fontSize: 11, color: colors.textFaint },
  resultClear: { fontSize: 12, color: colors.primaryBright, fontWeight: '600' },
  group: { marginBottom: space.lg },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 4, paddingVertical: space.sm },
  groupTitle: { fontFamily: fontFamily.serif, fontSize: 16, fontWeight: '400', letterSpacing: -0.2 },
  groupCount: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  groupCountText: { fontSize: 11, fontWeight: '700', color: colors.textDim },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.sm,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  rowName: { ...font.body, color: colors.text, fontWeight: '600', marginBottom: 6 },
  rowChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center' },
  rowSubRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  rowSub: { fontSize: 11, color: colors.textFaint },

  fab: {
    position: 'absolute', right: space.lg, bottom: space.xxl,
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    ...shadow.glow(colors.primary),
  },
});
