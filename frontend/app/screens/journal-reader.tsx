import { colors, alphaHex } from '../../lib/tokens';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList, Dimensions, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
// R07.01 — formatting, tags and habit links in the reader.
import JournalBody from '../../components/JournalBody';
import { useHabitStore } from '../../store/habitStore';
import { useJournalStore, JournalEntry } from '../../store/journalStore';
import { moodMeta } from '../../lib/journalMoods';
import { Image } from 'expo-image';
import { AtmosphericScreenCanvas, EmptyState, EmbeddedFiligree, TexturedSurface } from '../../components/ui';
import { CANVASES, DECOR, getMoodSeal, TEXTURES } from '../../lib/visualAssets';

const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function parseDate(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

const W = Dimensions.get('window').width;

export default function JournalReaderScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const { entries, fetchEntries } = useJournalStore();
  const listRef = useRef<FlatList<JournalEntry>>(null);
  const positioned = useRef(false);

  useEffect(() => { if (entries.length === 0) fetchEntries(); }, [entries.length, fetchEntries]);

  const startIndex = useMemo(
    () => Math.max(0, entries.findIndex((e) => e.date === date)),
    [entries, date],
  );
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(startIndex); }, [startIndex]);

  // Store sonradan dolarsa hedefe konumlan (bir kez)
  useEffect(() => {
    if (entries.length > 0 && !positioned.current && startIndex > 0) {
      positioned.current = true;
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: startIndex, animated: false });
      });
    }
  }, [entries.length, startIndex]);

  function go(delta: number) {
    const ni = Math.max(0, Math.min(entries.length - 1, idx + delta));
    if (ni === idx) return;
    listRef.current?.scrollToIndex({ index: ni, animated: true });
    setIdx(ni);
  }

  if (entries.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.journalScriptorium} textureSource={TEXTURES.archivalPaper} scrim={0.6} tintColor={colors.warning} />
        <View style={s.empty}>
          {/* Defter tonuna uyan editöryel boş durum */}
          <EmptyState
            variant="editorial"
            icon="book-outline"
            illustration="journal"
            title="Okunacak günlük sayfası yok"
            hint="Günlük sekmesinde bir şeyler yazdığında sayfaların burada okunabilir olacak."
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.journalScriptorium} textureSource={TEXTURES.archivalPaper} scrim={0.6} tintColor={colors.warning} />
      <FlatList
        ref={listRef}
        data={entries}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(e) => e.id}
        initialScrollIndex={startIndex}
        getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false }), 80);
        }}
        onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
        renderItem={({ item }) => <Page entry={item} />}
      />

      {/* Sayfa çevirme barı */}
      <View style={s.navBar}>
        {/* "Yeni"/"Eski" tek başına yön belirtmiyor — ekran okuyucuya açık etiket veriyoruz */}
        <TouchableOpacity
          style={[s.navBtn, idx <= 0 && s.navBtnOff]}
          onPress={() => go(-1)}
          disabled={idx <= 0}
          accessibilityRole="button"
          accessibilityLabel="Daha yeni sayfa"
          accessibilityState={{ disabled: idx <= 0 }}
        >
          <Ionicons name="chevron-back" size={18} color={idx <= 0 ? colors.textGhost : colors.warning} />
          <Text style={[s.navText, idx <= 0 && s.navTextOff]}>Yeni</Text>
        </TouchableOpacity>

        <Text style={s.pageIndicator}>sayfa {idx + 1} / {entries.length}</Text>

        <TouchableOpacity
          style={[s.navBtn, idx >= entries.length - 1 && s.navBtnOff]}
          onPress={() => go(1)}
          disabled={idx >= entries.length - 1}
          accessibilityRole="button"
          accessibilityLabel="Daha eski sayfa"
          accessibilityState={{ disabled: idx >= entries.length - 1 }}
        >
          <Text style={[s.navText, idx >= entries.length - 1 && s.navTextOff]}>Eski</Text>
          <Ionicons name="chevron-forward" size={18} color={idx >= entries.length - 1 ? colors.textGhost : colors.warning} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Page({ entry }: { entry: JournalEntry }) {
  const router = useRouter();
  const habits = useHabitStore((st) => st.habits);
  const dt = parseDate(entry.date);
  const m = moodMeta(entry.mood);
  return (
    <View style={[s.pageWrap, { width: W }]}>
      <View style={s.paper}>
        <TexturedSurface source={TEXTURES.archivalPaper} textureOpacity={0.09} overlayOnly />
        <EmbeddedFiligree source={DECOR.cornerBotanical} size={132} opacity={0.16} />
        {/* sol kenar marjı (defter çizgisi) */}
        <View style={s.margin} />
        <ScrollView contentContainerStyle={s.paperContent} showsVerticalScrollIndicator={false}>
          <Text style={s.dow}>{DAYS[dt.getDay()]}</Text>
          <View style={s.dateRow}>
            <Text style={s.dateBig} accessibilityRole="header">{dt.getDate()} {MONTHS[dt.getMonth()]} {dt.getFullYear()}</Text>
            {entry.mood ? <Image source={getMoodSeal(entry.mood)} style={s.moodSealBig} contentFit="contain" cachePolicy="memory-disk" /> : m ? <Text style={s.moodBig}>{m.emoji}</Text> : null}
          </View>
          <View style={s.hairline} />

          {entry.ai_summary && (
            <View style={s.aiChip}>
              <Ionicons name="sparkles" size={11} color="#ec4899" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              <Text style={s.aiChipText}>AI&apos;dan özetlenmiştir</Text>
            </View>
          )}

          {entry.content ? (
            <JournalBody
              content={entry.content}
              habits={habits}
              bodyStyle={s.body}
              onOpenHabit={(id) => router.push(`/screens/habit-detail?id=${id}` as never)}
              onTag={(t) => router.push(`/screens/journal-archive?tag=${encodeURIComponent(t)}` as never)}
            />
          ) : (
            <Text style={s.body}>(boş sayfa)</Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  pageWrap: { paddingHorizontal: 16, paddingVertical: 14 },
  paper: {
    flex: 1, backgroundColor: colors.paperSurface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.paperBorder, overflow: 'hidden', position: 'relative',
  },
  margin: {
    position: 'absolute', top: 0, bottom: 0, left: 30, width: 1,
    backgroundColor: alphaHex(colors.error, '40'),
  },
  paperContent: { padding: 22, paddingLeft: 44, paddingBottom: 40 },
  dow: { fontSize: 13, color: colors.paperLabel, fontWeight: '600' },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  dateBig: { fontSize: 22, fontWeight: '800', color: colors.text },
  moodSealBig: { width: 38, height: 38 },
  moodBig: { fontSize: 26 },
  hairline: { height: 1, backgroundColor: colors.paperBorder, marginVertical: 14 },

  aiChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: '#ec489918', borderColor: '#ec489940', borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, marginBottom: 14,
  },
  aiChipText: { fontSize: 11, color: '#ec4899', fontWeight: '700' },
  body: { fontSize: 15, color: colors.paperText, lineHeight: 25 },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
  },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 4, minWidth: 64 },
  navBtnOff: { opacity: 0.5 },
  navText: { fontSize: 14, fontWeight: '700', color: colors.warning },
  navTextOff: { color: colors.textGhost },
  pageIndicator: { fontSize: 12, color: colors.textFaint, fontWeight: '600' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 30 },
  emptyText: { fontSize: 13, color: colors.textFaint, textAlign: 'center' },
});
