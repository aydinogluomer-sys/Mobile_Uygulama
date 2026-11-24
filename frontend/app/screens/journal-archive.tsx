import { colors, alphaHex, font, space } from '../../lib/tokens';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SectionList,
  TouchableOpacity,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
// R07.01 — filter by #tag.
import { tagCounts, withTag } from '../../lib/journalText';
// R07.05 — mood next to habits, described, not explained.
import MoodHabitCard from '../../components/MoodHabitCard';
import ArchiveRow from '../../components/journal/ArchiveRow';
import { MONTHS, toArchiveRowModel, type ArchiveRowModel } from '../../lib/archiveRow';
import { useJournalStore } from '../../store/journalStore';
import { moodMeta } from '../../lib/journalMoods';
import { computeJournalStats } from '../../lib/journalStats';
import { EmptyState, EditorialBanner, TexturedSurface } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
// R07.03 — search and a month calendar over the same entries.
import { searchEntries, monthGrid, shiftMonth } from '../../lib/journalBrowse';
import { todayLocal } from '../../lib/date';

type Section = { key: string; label: string; data: ArchiveRowModel[] };

export default function JournalArchiveScreen() {
  const router = useRouter();
  const { entries: all, fetchEntries, truncated } = useJournalStore();
  const params = useLocalSearchParams<{ tag?: string }>();
  const [tag, setTag] = useState<string | null>(typeof params.tag === 'string' ? params.tag : null);
  const tags = useMemo(() => tagCounts(all).slice(0, 12), [all]);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const entries = useMemo(() => searchEntries(tag ? withTag(all, tag) : all, query), [all, tag, query]);
  const weeks = useMemo(() => monthGrid(all, Number(month.slice(0, 4)), Number(month.slice(5, 7))), [all, month]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const stats = useMemo(() => computeJournalStats(all), [all]);

  // Aya göre grupla (entries zaten tarih azalan sırada; tam içerik satıra geçmez)
  const sections = useMemo<Section[]>(() => {
    const map = new Map<string, ArchiveRowModel[]>();
    for (const e of entries) {
      const key = e.date.slice(0, 7); // YYYY-MM
      let bucket = map.get(key);
      if (!bucket) {
        bucket = [];
        map.set(key, bucket);
      }
      bucket.push(toArchiveRowModel(e));
    }
    return Array.from(map.entries()).map(([key, data]) => {
      const [y, m] = key.split('-').map(Number);
      return { key, label: `${MONTHS[m - 1]} ${y}`, data };
    });
  }, [entries]);

  const openEntry = useCallback(
    (date: string) => {
      router.push(`/screens/journal-reader?date=${date}` as any);
    },
    [router],
  );

  const renderSectionHeader = useCallback(
    ({ section: sec }: { section: Section }) => (
      <View style={s.sectionHeader}>
        <ChapterDivider source={DECOR.dividerSundial} />
        <Text style={s.sectionLabel}>{sec.label.toLocaleUpperCase('tr-TR')}</Text>
      </View>
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: ArchiveRowModel }) => <ArchiveRow row={item} onOpen={openEntry} />,
    [openEntry],
  );

  const avgMood = stats.moodAvg != null ? moodMeta(Math.round(stats.moodAvg)) : undefined;

  const header = (
    <View>
      {/* Rapor kartı */}
      <EditorialBanner
        source={SCREEN_BANNERS.journalArchive}
        textureSource={TEXTURES.archivalPaper}
        eyebrow="ARŞİV KÜTÜPHANESİ"
        title="Geçmiş Sayfalar"
        subtitle="Yazdığın tüm günlerin kronolojik defteri."
        accentColor={colors.warning}
        minHeight={94}
        style={{ marginBottom: 14 }}
      />
      {truncated ? (
        <Text style={s.truncatedNote}>Son 365 kayıt gösteriliyor.</Text>
      ) : null}
      <View style={s.report}>
        <TexturedSurface source={TEXTURES.archivalPaper} textureOpacity={0.08} overlayOnly />
        <EmbeddedFiligree source={DECOR.cornerBotanical} size={112} opacity={0.16} />
        <Text style={s.reportTitle}>DEFTERİN</Text>
        <View style={s.statRow}>
          <Stat value={`${stats.total}`} label="kayıt" />
          <Stat value={`${stats.streak}`} label="🔥 seri" />
          <Stat value={`${stats.thisMonth}`} label="bu ay" />
          <Stat value={`${stats.aiCount}`} label="✨ AI" />
          <Stat value={avgMood?.emoji ?? '—'} label="ort. mod" />
        </View>
      </View>

      <MoodHabitCard entries={all} />

      {/* R07.03 — search + list/calendar */}
      <TextInput
        style={s.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Günlükte ara…"
        placeholderTextColor={colors.textFaint}
        accessibilityLabel="Günlükte ara"
        returnKeyType="search"
      />
      <View style={s.viewRow} accessibilityRole="radiogroup" accessibilityLabel="Görünüm">
        {(['list', 'calendar'] as const).map((v) => (
          <TouchableOpacity key={v} style={[s.tagChip, view === v && s.tagChipOn]} onPress={() => setView(v)}
            accessibilityRole="radio" accessibilityLabel={v === 'list' ? 'Liste' : 'Takvim'} accessibilityState={{ selected: view === v, checked: view === v }}>
            <Text style={s.tagChipText}>{v === 'list' ? 'Liste' : 'Takvim'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {view === 'calendar' && (
        <View style={s.calendar}>
          <View style={s.calHead}>
            <TouchableOpacity onPress={() => setMonth(shiftMonth(month, -1))} accessibilityRole="button" accessibilityLabel="Önceki ay"><Ionicons name="chevron-back" size={18} color={colors.textDim} /></TouchableOpacity>
            <Text style={s.sectionLabel}>{`${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`.toLocaleUpperCase('tr-TR')}</Text>
            <TouchableOpacity onPress={() => setMonth(shiftMonth(month, 1))} accessibilityRole="button" accessibilityLabel="Sonraki ay"><Ionicons name="chevron-forward" size={18} color={colors.textDim} /></TouchableOpacity>
          </View>
          {weeks.map((w) => (
            <View key={w[0].date} style={s.calWeek}>
              {w.map((d) => {
                const day = Number(d.date.slice(8, 10));
                const label = `${day} ${MONTHS[Number(d.date.slice(5, 7)) - 1]}${d.entryId ? ', kayıt var' : ', kayıt yok'}`;
                return d.entryId ? (
                  <TouchableOpacity key={d.date} style={[s.calDay, s.calDayOn, !d.inMonth && s.calDayOut]}
                    onPress={() => router.push(`/screens/journal-reader?date=${d.date}` as any)}
                    accessibilityRole="button" accessibilityLabel={label}>
                    <Text style={s.calDayText}>{day}</Text>
                  </TouchableOpacity>
                ) : (
                  <View key={d.date} style={[s.calDay, !d.inMonth && s.calDayOut]} accessibilityLabel={label}>
                    <Text style={[s.calDayText, { color: colors.textFaint }]}>{day}</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {tags.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tagRow}>
          {tag && (
            <TouchableOpacity style={[s.tagChip, s.tagChipOn]} onPress={() => setTag(null)} accessibilityRole="button" accessibilityLabel="Etiket süzgecini kaldır">
              <Text style={s.tagChipText}>#{tag} ✕</Text>
            </TouchableOpacity>
          )}
          {tags.filter((t) => t.tag !== tag).map((t) => (
            <TouchableOpacity key={t.tag} style={s.tagChip} onPress={() => setTag(t.tag)} accessibilityRole="button" accessibilityLabel={`#${t.tag} etiketli ${t.count} kayıt`}>
              <Text style={s.tagChipText}>#{t.tag} · {t.count}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );

  const emptyState = query.trim() ? (
    <EmptyState variant="editorial" icon="search-outline" title="Bu aramayla kayıt yok" hint="Başka bir kelime dene ya da etiketi kaldır." />
  ) : (
    // Defterin sakin tonuna uyan editöryel boş durum (ikon kabı yok, serif italik)
    <EmptyState
      variant="editorial"
      icon="book-outline"
      illustration="journal"
      title="Henüz günlük kaydın yok"
      hint="Bir şeyler yazdıkça eski sayfaların burada birikecek."
    />
  );

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.journalScriptorium} textureSource={TEXTURES.archivalPaper} scrim={0.58} tintColor={colors.warning} />
      <SectionList
        sections={view === 'calendar' ? [] : sections}
        keyExtractor={(r) => r.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListHeaderComponent={header}
        ListEmptyComponent={view === 'calendar' ? null : emptyState}
        stickySectionHeadersEnabled={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // R07.01
  tagRow: { gap: 8, paddingBottom: 12 },
  tagChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  tagChipOn: { borderColor: colors.accent },
  tagChipText: { fontSize: 12, color: colors.textDim },
  safe: { flex: 1, backgroundColor: colors.bg },
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, marginBottom: 10 },
  viewRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  calendar: { marginBottom: 16, gap: 4 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  calWeek: { flexDirection: 'row', gap: 4 },
  calDay: { flex: 1, aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minHeight: 36 },
  calDayOn: { backgroundColor: alphaHex(colors.accent, '33') },
  calDayOut: { opacity: 0.4 },
  calDayText: { fontSize: 13, color: colors.text },
  content: { padding: 16, paddingBottom: 40 },
  truncatedNote: { ...font.caption, color: colors.textFaint, marginBottom: space.sm },

  report: {
    backgroundColor: colors.paperSurface, borderRadius: 16, borderWidth: 1, borderColor: colors.paperBorder,
    padding: 16, marginBottom: 18, overflow: 'hidden', position: 'relative',
  },
  reportTitle: { fontSize: 11, fontWeight: '800', color: colors.paperLabel, letterSpacing: 1.5, marginBottom: 12 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textFaint, marginTop: 2 },

  sectionHeader: { marginTop: space.sm },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.textFaint, letterSpacing: 1.2, marginBottom: 10, paddingLeft: 2 },
});
