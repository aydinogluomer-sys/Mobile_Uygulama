import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList, Dimensions, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useJournalStore, JournalEntry } from '../../store/journalStore';
import { moodMeta } from '../../lib/journalMoods';
import { EmptyState } from '../../components/ui';

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

  useEffect(() => { if (entries.length === 0) fetchEntries(); }, []);

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
        <View style={s.empty}>
          {/* Defter tonuna uyan editöryel boş durum */}
          <EmptyState
            variant="editorial"
            icon="book-outline"
            title="Okunacak günlük sayfası yok"
            hint="Günlük sekmesinde bir şeyler yazdığında sayfaların burada okunabilir olacak."
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
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
          <Ionicons name="chevron-back" size={18} color={idx <= 0 ? '#56544B' : '#D4A84A'} />
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
          <Ionicons name="chevron-forward" size={18} color={idx >= entries.length - 1 ? '#56544B' : '#D4A84A'} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Page({ entry }: { entry: JournalEntry }) {
  const dt = parseDate(entry.date);
  const m = moodMeta(entry.mood);
  return (
    <View style={[s.pageWrap, { width: W }]}>
      <View style={s.paper}>
        {/* sol kenar marjı (defter çizgisi) */}
        <View style={s.margin} />
        <ScrollView contentContainerStyle={s.paperContent} showsVerticalScrollIndicator={false}>
          <Text style={s.dow}>{DAYS[dt.getDay()]}</Text>
          <View style={s.dateRow}>
            <Text style={s.dateBig} accessibilityRole="header">{dt.getDate()} {MONTHS[dt.getMonth()]} {dt.getFullYear()}</Text>
            {m && <Text style={s.moodBig}>{m.emoji}</Text>}
          </View>
          <View style={s.hairline} />

          {entry.ai_summary && (
            <View style={s.aiChip}>
              <Ionicons name="sparkles" size={11} color="#ec4899" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              <Text style={s.aiChipText}>AI&apos;dan özetlenmiştir</Text>
            </View>
          )}

          <Text style={s.body}>{entry.content || '(boş sayfa)'}</Text>
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#15140F' },

  pageWrap: { paddingHorizontal: 16, paddingVertical: 14 },
  paper: {
    flex: 1, backgroundColor: '#211C18', borderRadius: 16,
    borderWidth: 1, borderColor: '#3A3026', overflow: 'hidden',
  },
  margin: {
    position: 'absolute', top: 0, bottom: 0, left: 30, width: 1,
    backgroundColor: '#C76A6A40',
  },
  paperContent: { padding: 22, paddingLeft: 44, paddingBottom: 40 },
  dow: { fontSize: 13, color: '#A88E6A', fontWeight: '600' },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  dateBig: { fontSize: 22, fontWeight: '800', color: '#EDEAE0' },
  moodBig: { fontSize: 26 },
  hairline: { height: 1, backgroundColor: '#3A3026', marginVertical: 14 },

  aiChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: '#ec489918', borderColor: '#ec489940', borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, marginBottom: 14,
  },
  aiChipText: { fontSize: 11, color: '#ec4899', fontWeight: '700' },
  body: { fontSize: 15, color: '#E3DDD0', lineHeight: 25 },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#28261F',
  },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 4, minWidth: 64 },
  navBtnOff: { opacity: 0.5 },
  navText: { fontSize: 14, fontWeight: '700', color: '#D4A84A' },
  navTextOff: { color: '#56544B' },
  pageIndicator: { fontSize: 12, color: '#827E72', fontWeight: '600' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 30 },
  emptyText: { fontSize: 13, color: '#827E72', textAlign: 'center' },
});
