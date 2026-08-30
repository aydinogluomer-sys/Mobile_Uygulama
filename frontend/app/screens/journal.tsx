import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useJournalStore } from '../../store/journalStore';
import { MOODS } from '../../lib/journalMoods';
import { todayLocal, ymd, addDaysLocal } from '../../lib/date';

const PROMPTS = [
  'Bugün ne için minnettarsın?',
  'Bugün ne öğrendin?',
  'Yarın ne yapmak istiyorsun?',
  'Bugünün en iyi anı ne oldu?',
];

// Tarih düğmeleri ekranda "Paz 24" gibi kısaltılmış görünür; ekran okuyucu için
// günün tam adı gerekir.
const DAY_NAMES_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export default function JournalScreen() {
  const router = useRouter();
  const today = todayLocal();
  const { entries, fetchEntries, saveEntry, getByDate } = useJournalStore();
  const [selectedDate, setSelectedDate] = useState(today);
  const [content, setContent] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  const todayEntry = getByDate(selectedDate);
  const randomPrompt = PROMPTS[new Date().getDay() % PROMPTS.length];

  useEffect(() => { fetchEntries(); }, []);

  useEffect(() => {
    const e = getByDate(selectedDate);
    setContent(e?.content ?? '');
    setMood(e?.mood ?? null);
    setSaved(false);
  }, [selectedDate, entries]);

  async function handleSave() {
    await saveEntry(selectedDate, content, mood);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // Son 7 gün
  const last7 = Array.from({ length: 7 }, (_, i) => ymd(addDaysLocal(new Date(), -i)));

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/screens/journal-archive' as any)}
              style={s.archiveBtn}
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel="Günlük arşivini aç"
            >
              <Ionicons name="library-outline" size={16} color="#ec4899" />
              <Text style={s.archiveBtnText}>Arşiv</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

          {/* Tarih seçici */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dateRow}>
            {last7.map((d) => {
              const dt = new Date(d);
              const hasEntry = !!getByDate(d);
              const isSelected = d === selectedDate;
              return (
                <TouchableOpacity
                  key={d}
                  style={[s.dateBtn, isSelected && s.dateBtnActive]}
                  onPress={() => setSelectedDate(d)}
                  accessibilityRole="tab"
                  accessibilityLabel={
                    `${DAY_NAMES_TR[dt.getDay()]} ${dt.getDate()}` +
                    (hasEntry ? ', kayıt var' : ', kayıt yok')
                  }
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={[s.dateDayName, isSelected && s.dateDayNameActive]}>
                    {['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'][dt.getDay()]}
                  </Text>
                  <Text style={[s.dateDay, isSelected && s.dateDayActive]}>{dt.getDate()}</Text>
                  {hasEntry && <View style={[s.entryDot, isSelected && s.entryDotActive]} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Ruh hali */}
          <View style={s.moodSection}>
            <Text style={s.moodTitle}>Bugün nasıl hissediyorsun?</Text>
            <View style={s.moodRow}>
              {MOODS.map((m) => (
                <TouchableOpacity
                  key={m.value}
                  style={[s.moodBtn, mood === m.value && { backgroundColor: m.color + '25', borderColor: m.color }]}
                  onPress={() => setMood(mood === m.value ? null : m.value)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Ruh hali: ${m.label}`}
                  accessibilityState={{ selected: mood === m.value, checked: mood === m.value }}
                >
                  <Text style={s.moodEmoji}>{m.emoji}</Text>
                  <Text style={[s.moodLabel, mood === m.value && { color: m.color }]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Yazma alanı */}
          <View style={s.writeCard}>
            {todayEntry?.ai_summary && (
              <View style={s.aiChip}>
                <Ionicons name="sparkles" size={11} color="#ec4899" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                <Text style={s.aiChipText}>AI özeti içeriyor</Text>
              </View>
            )}
            <Text style={s.promptText}>{randomPrompt}</Text>
            <TextInput
              style={s.textArea}
              placeholder="Bugünü anlat..."
              placeholderTextColor="#56544B"
              multiline
              value={content}
              onChangeText={setContent}
              textAlignVertical="top"
            />
          </View>

          {/* Kaydet */}
          <TouchableOpacity
            style={[s.saveBtn, saved && s.saveBtnDone, !content.trim() && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!content.trim()}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Günlük kaydedildi' : 'Günlüğü kaydet'}
            accessibilityState={{ disabled: !content.trim() }}
          >
            {saved ? (
              <>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={s.saveBtnText}>Kaydedildi</Text>
              </>
            ) : (
              <Text style={s.saveBtnText}>Kaydet</Text>
            )}
          </TouchableOpacity>

          {/* AI İçgörüleri — dönem butonları */}
          <View style={s.insightsCard}>
            <View style={s.insightsTop}>
              <Ionicons name="bulb-outline" size={15} color="#8b5cf6" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              <Text style={s.insightsTitle}>AI İÇGÖRÜLERİ</Text>
            </View>
            <Text style={s.insightsHint}>Yazdıklarından dönemsel içgörü al</Text>
            <View style={s.insightsRow}>
              {([['weekly', 'Haftalık'], ['monthly', 'Aylık'], ['yearly', 'Yıllık']] as const).map(
                ([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    style={s.insightBtn}
                    onPress={() => router.push(`/screens/journal-insights?period=${key}` as any)}
                    accessibilityRole="link"
                    accessibilityLabel={`${label} AI içgörülerini aç`}
                  >
                    <Text style={s.insightBtnText}>{label}</Text>
                  </TouchableOpacity>
                ),
              )}
            </View>
          </View>

          {/* Geçmiş kayıtlar */}
          {entries.filter((e) => e.date !== today).length > 0 && (
            <View style={s.historySection}>
              <View style={s.historyHeader}>
                <Text style={s.historyTitle}>GEÇMİŞ KAYITLAR</Text>
                <TouchableOpacity
                  style={s.archiveLink}
                  onPress={() => router.push('/screens/journal-archive' as any)}
                  accessibilityRole="link"
                  accessibilityLabel="Tüm günlük arşivini aç"
                >
                  <Ionicons name="library-outline" size={13} color="#ec4899" />
                  <Text style={s.archiveLinkText}>Tüm arşiv</Text>
                </TouchableOpacity>
              </View>
              {entries.filter((e) => e.date !== today).slice(0, 5).map((e) => (
                <TouchableOpacity
                  key={e.id}
                  style={s.historyItem}
                  onPress={() => setSelectedDate(e.date)}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.date} kaydını aç`}
                  accessibilityHint="Bu günün girdisini düzenlemek için açar"
                >
                  <View style={s.historyLeft}>
                    <View style={s.historyDateRow}>
                      <Text style={s.historyDate}>{e.date}</Text>
                      {e.ai_summary && (
                        <View style={s.aiChipSm}>
                          <Ionicons name="sparkles" size={9} color="#ec4899" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                          <Text style={s.aiChipSmText}>AI</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.historyPreview} numberOfLines={2}>{e.content}</Text>
                  </View>
                  {e.mood && (
                    <Text style={s.historyMood}>{MOODS.find((m) => m.value === e.mood)?.emoji}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#15140F' },
  content: { padding: 16, paddingBottom: 40 },

  dateRow: { marginBottom: 20 },
  dateBtn: {
    alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1, borderColor: '#383528',
    backgroundColor: '#1D1C17', marginRight: 8, minWidth: 52, gap: 2,
  },
  dateBtnActive: { backgroundColor: '#ec489920', borderColor: '#ec4899' },
  dateDayName: { fontSize: 10, color: '#827E72', fontWeight: '600' },
  dateDayNameActive: { color: '#ec4899' },
  dateDay: { fontSize: 18, fontWeight: '700', color: '#BFBBAE' },
  dateDayActive: { color: '#fff' },
  entryDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#56544B' },
  entryDotActive: { backgroundColor: '#ec4899' },

  moodSection: { marginBottom: 20 },
  moodTitle: { fontSize: 14, color: '#BFBBAE', marginBottom: 12 },
  moodRow: { flexDirection: 'row', justifyContent: 'space-between' },
  moodBtn: {
    alignItems: 'center', gap: 4, padding: 10, borderRadius: 12,
    borderWidth: 1, borderColor: '#383528', flex: 1, marginHorizontal: 2,
  },
  moodEmoji: { fontSize: 22 },
  moodLabel: { fontSize: 10, color: '#827E72' },

  writeCard: { backgroundColor: '#1D1C17', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#383528', marginBottom: 16 },
  aiChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: '#ec489918', borderColor: '#ec489940', borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, marginBottom: 10,
  },
  aiChipText: { fontSize: 11, color: '#ec4899', fontWeight: '700' },
  promptText: { fontSize: 13, color: '#BFBBAE', fontStyle: 'italic', marginBottom: 12 },
  textArea: { fontSize: 15, color: '#EDEAE0', minHeight: 160, lineHeight: 22 },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ec4899', borderRadius: 14, paddingVertical: 14, marginBottom: 24 },
  saveBtnDone: { backgroundColor: '#87A678' },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  archiveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  archiveBtnText: { fontSize: 13, fontWeight: '700', color: '#ec4899' },

  insightsCard: {
    backgroundColor: '#1D1C17', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#383528', marginBottom: 16,
  },
  insightsTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  insightsTitle: { fontSize: 11, fontWeight: '800', color: '#a78bfa', letterSpacing: 1 },
  insightsHint: { fontSize: 12, color: '#827E72', marginTop: 4, marginBottom: 12 },
  insightsRow: { flexDirection: 'row', gap: 8 },
  insightBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12,
    backgroundColor: '#8b5cf618', borderWidth: 1, borderColor: '#8b5cf640',
  },
  insightBtnText: { fontSize: 13, fontWeight: '700', color: '#a78bfa' },

  historySection: { marginTop: 8 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  historyTitle: { fontSize: 11, fontWeight: '700', color: '#827E72', letterSpacing: 1 },
  archiveLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  archiveLinkText: { fontSize: 12, fontWeight: '700', color: '#ec4899' },
  historyItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#383528', marginBottom: 8,
  },
  historyLeft: { flex: 1 },
  historyDateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  historyDate: { fontSize: 11, color: '#827E72' },
  aiChipSm: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#ec489918', borderColor: '#ec489940', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1,
  },
  aiChipSmText: { fontSize: 9, color: '#ec4899', fontWeight: '800', letterSpacing: 0.3 },
  historyPreview: { fontSize: 13, color: '#BFBBAE', lineHeight: 18 },
  historyMood: { fontSize: 20 },
});
