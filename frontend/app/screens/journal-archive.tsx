import { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useJournalStore, JournalEntry } from '../../store/journalStore';
import { moodMeta } from '../../lib/journalMoods';
import { computeJournalStats } from '../../lib/journalStats';
import { EmptyState } from '../../components/ui';

const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function parseDate(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

type Section = { key: string; label: string; items: JournalEntry[] };

function getSourceLabel(content: string): string | null {
  const match = content.trim().match(/^\[(.+?)\]/);
  return match ? match[1] : null;
}

export default function JournalArchiveScreen() {
  const router = useRouter();
  const { entries, fetchEntries } = useJournalStore();

  useEffect(() => { fetchEntries(); }, []);

  const stats = useMemo(() => computeJournalStats(entries), [entries]);

  // Aya göre grupla (entries zaten tarih azalan sırada)
  const sections = useMemo<Section[]>(() => {
    const map = new Map<string, JournalEntry[]>();
    for (const e of entries) {
      const key = e.date.slice(0, 7); // YYYY-MM
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()).map(([key, items]) => {
      const [y, m] = key.split('-').map(Number);
      return { key, label: `${MONTHS[m - 1]} ${y}`, items };
    });
  }, [entries]);

  const avgMood = stats.moodAvg != null ? moodMeta(Math.round(stats.moodAvg)) : undefined;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Rapor kartı */}
        <View style={s.report}>
          <Text style={s.reportTitle}>DEFTERİN</Text>
          <View style={s.statRow}>
            <Stat value={`${stats.total}`} label="kayıt" />
            <Stat value={`${stats.streak}`} label="🔥 seri" />
            <Stat value={`${stats.thisMonth}`} label="bu ay" />
            <Stat value={`${stats.aiCount}`} label="✨ AI" />
            <Stat value={avgMood?.emoji ?? '—'} label="ort. mod" />
          </View>
        </View>

        {entries.length === 0 ? (
          // Defterin sakin tonuna uyan editöryel boş durum (ikon kabı yok, serif italik)
          <EmptyState
            variant="editorial"
            icon="book-outline"
            title="Henüz günlük kaydın yok"
            hint="Bir şeyler yazdıkça eski sayfaların burada birikecek."
          />
        ) : (
          sections.map((sec) => (
            <View key={sec.key} style={s.section}>
              <Text style={s.sectionLabel}>{sec.label.toUpperCase()}</Text>
              {sec.items.map((e) => {
                const dt = parseDate(e.date);
                const m = moodMeta(e.mood);
                const sourceLabel = getSourceLabel(e.content);
                return (
                  <TouchableOpacity
                    key={e.id}
                    style={s.page}
                    activeOpacity={0.8}
                    onPress={() => router.push(`/screens/journal-reader?date=${e.date}` as any)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()} kaydı` +
                      (m ? `, ${m.label}` : '') +
                      (e.ai_summary ? ', AI özeti var' : '')
                    }
                    accessibilityHint="Bu günün defter sayfasını açar"
                  >
                    {/* sol tarih şeridi */}
                    <View style={s.spine}>
                      <Text style={s.spineDay}>{dt.getDate()}</Text>
                      <Text style={s.spineDow}>{DAYS[dt.getDay()]}</Text>
                    </View>
                    <View style={s.pageBody}>
                      <View style={s.chipRow}>
                        {sourceLabel && (
                          <View style={s.sourceChip}>
                            <Ionicons name="document-text" size={10} color="#D4A84A" />
                            <Text style={s.sourceChipText}>{sourceLabel}</Text>
                          </View>
                        )}
                        {e.ai_summary && (
                          <View style={s.aiChip}>
                            <Ionicons name="sparkles" size={10} color="#ec4899" />
                            <Text style={s.aiChipText}>AI&apos;dan özetlenmiştir</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.preview} numberOfLines={3}>{e.content}</Text>
                    </View>
                    {m && <Text style={s.mood}>{m.emoji}</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
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
  safe: { flex: 1, backgroundColor: '#15140F' },
  content: { padding: 16, paddingBottom: 40 },

  report: {
    backgroundColor: '#211C18', borderRadius: 16, borderWidth: 1, borderColor: '#3A3026',
    padding: 16, marginBottom: 18,
  },
  reportTitle: { fontSize: 11, fontWeight: '800', color: '#A88E6A', letterSpacing: 1.5, marginBottom: 12 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 18, fontWeight: '800', color: '#EDEAE0' },
  statLabel: { fontSize: 10, color: '#827E72', marginTop: 2 },

  section: { marginBottom: 18 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#827E72', letterSpacing: 1.2, marginBottom: 10, paddingLeft: 2 },

  page: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#211C18', borderRadius: 12, borderWidth: 1, borderColor: '#3A3026',
    padding: 14, marginBottom: 8,
  },
  spine: {
    alignItems: 'center', minWidth: 38,
    borderRightWidth: 1, borderRightColor: '#3A3026', paddingRight: 12,
  },
  spineDay: { fontSize: 20, fontWeight: '800', color: '#D4A84A' },
  spineDow: { fontSize: 10, color: '#827E72', fontWeight: '600' },
  pageBody: { flex: 1, gap: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sourceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: '#D4A84A18', borderColor: '#D4A84A40', borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  sourceChipText: { fontSize: 10, color: '#D4A84A', fontWeight: '700' },
  aiChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: '#ec489918', borderColor: '#ec489940', borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  aiChipText: { fontSize: 10, color: '#ec4899', fontWeight: '700' },
  preview: { fontSize: 13, color: '#CFC9BC', lineHeight: 19 },
  mood: { fontSize: 20 },

  empty: { alignItems: 'center', gap: 12, paddingTop: 50, paddingHorizontal: 30 },
  emptyText: { fontSize: 13, color: '#827E72', textAlign: 'center', lineHeight: 19 },
});
