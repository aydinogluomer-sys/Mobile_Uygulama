import { colors, hexA, alphaHex } from '../../lib/tokens';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { navigateTo } from '../../lib/destinations';
import { useJournalStore } from '../../store/journalStore';
import { MOODS } from '../../lib/journalMoods';
import { todayLocal, ymd, addDaysLocal, parseLocalDate } from '../../lib/date';
// R07.01 — offline draft, light formatting, tags.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { currentUser } from '../../lib/session';
import { draftDiffers, draftKey, extractTags, toggleListLine, wrapSelection, type JournalDraft } from '../../lib/journalText';
// R07.02 — several check-ins a day, with the user's own moods.
import MoodCheckins from '../../components/MoodCheckins';
import ConflictChoice from '../../components/ConflictChoice';
import { useCoreOutboxSync } from '../../hooks/useCoreOutboxSync';
import { EditorialBanner, TexturedSurface } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, getMoodSeal, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

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
  const { entries, fetchEntries, saveEntry, getByDate, conflicts, resolveConflict } = useJournalStore();
  // R02.05 — re-read on every outbox change, so a conflict appears the moment delivery reports it.
  useCoreOutboxSync();
  const [resolving, setResolving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today);
  const [content, setContent] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const selection = useRef({ start: 0, end: 0 });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const todayEntry = getByDate(selectedDate);
  const randomPrompt = PROMPTS[new Date().getDay() % PROMPTS.length];

  useEffect(() => { fetchEntries(); }, [fetchEntries]);
  useEffect(() => { void currentUser().then((u) => setUserId(u?.id ?? null)); }, []);

  // The day's entry -- or, if what was typed was never confirmed saved (an
  // offline save, an app kill), the draft that holds it.
  useEffect(() => {
    let alive = true;
    const e = getByDate(selectedDate);
    setContent(e?.content ?? '');
    setMood(e?.mood ?? null);
    setSaved(false);
    setSaveError(null);
    setDraftRestored(false);
    if (userId) {
      void AsyncStorage.getItem(draftKey(userId, selectedDate)).then((raw) => {
        if (!alive || !raw) return;
        try {
          const d = JSON.parse(raw) as JournalDraft;
          if (draftDiffers(d, e)) { setContent(d.content); setMood(d.mood); setDraftRestored(true); }
        } catch { /* unreadable draft: leave it */ }
      }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, [selectedDate, entries, getByDate, userId]);

  /** Every edit is kept on the device until a save is confirmed. */
  function edit(nextContent: string, nextMood: number | null) {
    setContent(nextContent);
    setMood(nextMood);
    setSaved(false);
    if (!userId) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const key = draftKey(userId, selectedDate);
    const draft: JournalDraft = { date: selectedDate, content: nextContent, mood: nextMood, savedAt: Date.now() };
    draftTimer.current = setTimeout(() => { AsyncStorage.setItem(key, JSON.stringify(draft)).catch(() => undefined); }, 600);
  }

  async function handleSave() {
    const res = await saveEntry(selectedDate, content, mood);
    if (!res.ok) {
      // Not saved: the text stays here and in the draft; nothing says otherwise.
      setSaveError('Kaydedilemedi; yazdıkların bu cihazda taslak olarak duruyor. Bağlantı gelince tekrar dene.');
      return;
    }
    setSaveError(null);
    setDraftRestored(false);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (userId) AsyncStorage.removeItem(draftKey(userId, selectedDate)).catch(() => undefined);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function format(kind: 'bold' | 'italic' | 'list') {
    const { start, end } = selection.current;
    const r = kind === 'list' ? toggleListLine(content, start) : wrapSelection(content, start, end, kind === 'bold' ? '**' : '_');
    edit(r.text, mood);
  }

  // Son 7 gün
  const last7 = Array.from({ length: 7 }, (_, i) => ymd(addDaysLocal(new Date(), -i)));

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.journalScriptorium} textureSource={TEXTURES.archivalPaper} scrim={0.58} tintColor={colors.warning} />
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigateTo(router, 'journal-archive')}
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
          <EditorialBanner
            source={SCREEN_BANNERS.journalDesk}
            textureSource={TEXTURES.archivalPaper}
            eyebrow="GÜNLÜK & YANSIMA"
            title="Günün Defteri"
            subtitle="Zihnini kağıda dök; düşüncelerin bu cihazda güvende."
            accentColor={colors.primary}
            minHeight={96}
            style={{ marginBottom: 14 }}
          />
          {conflicts().some((c) => c.entityId === selectedDate) && (
            <ConflictChoice what="Bu günün kaydı" busy={resolving}
              onChoose={async (choice) => { setResolving(true); await resolveConflict(selectedDate, choice); setResolving(false); }} />
          )}

          {/* Tarih seçici */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dateRow}>
            {last7.map((d) => {
              const dt = parseLocalDate(d) ?? new Date();
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

          <MoodCheckins />

          {/* Ruh hali */}
          <View style={s.moodSection}>
            <Text style={s.moodTitle}>Bugün nasıl hissediyorsun?</Text>
            <View style={s.moodRow}>
              {MOODS.map((m) => (
                <TouchableOpacity
                  key={m.value}
                  style={[s.moodBtn, mood === m.value && { backgroundColor: m.color + '25', borderColor: m.color }]}
                  onPress={() => edit(content, mood === m.value ? null : m.value)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Ruh hali: ${m.label}`}
                  accessibilityState={{ selected: mood === m.value, checked: mood === m.value }}
                >
                  <Image source={getMoodSeal(m.value)} style={s.moodSeal} contentFit="contain" cachePolicy="memory-disk" />
                  <Text style={[s.moodLabel, mood === m.value && { color: m.color }]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Yazma alanı */}
          <View style={s.writeCard}>
            <TexturedSurface source={TEXTURES.archivalPaper} textureOpacity={0.08} overlayOnly />
            <EmbeddedFiligree source={DECOR.cornerBotanical} size={118} opacity={0.16} />
            <View style={s.parchmentMargin} pointerEvents="none" />
            {todayEntry?.ai_summary && (
              <View style={s.aiChip}>
                <Ionicons name="sparkles" size={11} color="#ec4899" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                <Text style={s.aiChipText}>AI özeti içeriyor</Text>
              </View>
            )}
            <Text style={s.promptText}>{randomPrompt}</Text>
            {draftRestored && (
              <Text style={s.draftNote} accessibilityRole="alert">Kaydedilmemiş taslağın geri yüklendi.</Text>
            )}
            <View style={s.toolbar}>
              <TouchableOpacity onPress={() => format('bold')} style={s.toolBtn} accessibilityRole="button" accessibilityLabel="Kalın"><Text style={[s.toolText, { fontWeight: '700' }]}>K</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => format('italic')} style={s.toolBtn} accessibilityRole="button" accessibilityLabel="İtalik"><Text style={[s.toolText, { fontStyle: 'italic' }]}>İ</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => format('list')} style={s.toolBtn} accessibilityRole="button" accessibilityLabel="Liste satırı"><Text style={s.toolText}>• Liste</Text></TouchableOpacity>
              <Text style={s.toolHint}>#etiket yaz; bir alışkanlığın adı (#su-iç) onu bağlar</Text>
            </View>
            <TextInput
              style={s.textArea}
              placeholder="Bugünü anlat..."
              placeholderTextColor={colors.textFaint}
              multiline
              value={content}
              onChangeText={(t) => edit(t, mood)}
              onSelectionChange={(e) => { selection.current = e.nativeEvent.selection; }}
              textAlignVertical="top"
            />
          </View>

          {extractTags(content).length > 0 && (
            <Text style={s.tagLine}>{extractTags(content).map((t) => `#${t}`).join('  ')}</Text>
          )}
          {saveError && <Text style={s.saveError} accessibilityRole="alert">{saveError}</Text>}

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
                <Ionicons name="checkmark" size={18} color={colors.white} />
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
                    onPress={() => navigateTo(router, 'journal-insights', { period: key })}
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
              <ChapterDivider source={DECOR.dividerSundial} label="ARŞİV YAPRAKLARI" />
              <View style={s.historyHeader}>
                <Text style={s.historyTitle}>GEÇMİŞ KAYITLAR</Text>
                <TouchableOpacity
                  style={s.archiveLink}
                  onPress={() => navigateTo(router, 'journal-archive')}
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
                    <Image source={getMoodSeal(e.mood)} style={s.historySeal} contentFit="contain" cachePolicy="memory-disk" />
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
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },

  dateRow: { marginBottom: 20 },
  dateBtn: {
    alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, marginRight: 8, minWidth: 52, gap: 2,
  },
  dateBtnActive: { backgroundColor: '#ec489920', borderColor: '#ec4899' },
  dateDayName: { fontSize: 10, color: colors.textFaint, fontWeight: '600' },
  dateDayNameActive: { color: '#ec4899' },
  dateDay: { fontSize: 18, fontWeight: '700', color: colors.textDim },
  dateDayActive: { color: colors.white },
  entryDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.textGhost },
  entryDotActive: { backgroundColor: '#ec4899' },

  moodSection: { marginBottom: 20 },
  // R07.01
  draftNote: { fontSize: 12, color: colors.warning, marginBottom: 8 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  toolBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  toolText: { fontSize: 13, color: colors.textDim },
  toolHint: { fontSize: 11, color: colors.textFaint, flexShrink: 1 },
  tagLine: { fontSize: 12, color: colors.textDim, marginTop: 8 },
  saveError: { fontSize: 12, color: colors.error, marginTop: 8 },
  moodTitle: { fontSize: 14, color: colors.textDim, marginBottom: 12 },
  moodRow: { flexDirection: 'row', justifyContent: 'space-between' },
  moodBtn: {
    alignItems: 'center', gap: 4, padding: 10, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, flex: 1, marginHorizontal: 2,
  },
  moodSeal: { width: 34, height: 34 },
  historySeal: { width: 28, height: 28 },
  parchmentMargin: { position: 'absolute', top: 0, bottom: 0, left: 18, width: 1, backgroundColor: alphaHex(colors.warning, '35') },
  moodEmoji: { fontSize: 22 },
  moodLabel: { fontSize: 10, color: colors.textFaint },

  writeCard: { backgroundColor: hexA(colors.paperSurface, 0.94), borderRadius: 16, padding: 16, paddingLeft: 28, borderWidth: 1, borderColor: colors.paperBorder, marginBottom: 16, overflow: 'hidden', position: 'relative' },
  aiChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: '#ec489918', borderColor: '#ec489940', borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, marginBottom: 10,
  },
  aiChipText: { fontSize: 11, color: '#ec4899', fontWeight: '700' },
  promptText: { fontSize: 13, color: colors.textDim, fontStyle: 'italic', marginBottom: 12 },
  textArea: { fontSize: 15, color: colors.text, minHeight: 160, lineHeight: 22 },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ec4899', borderRadius: 14, paddingVertical: 14, marginBottom: 24 },
  saveBtnDone: { backgroundColor: colors.success },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },

  archiveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  archiveBtnText: { fontSize: 13, fontWeight: '700', color: '#ec4899' },

  insightsCard: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.border, marginBottom: 16,
  },
  insightsTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  insightsTitle: { fontSize: 11, fontWeight: '800', color: '#a78bfa', letterSpacing: 1 },
  insightsHint: { fontSize: 12, color: colors.textFaint, marginTop: 4, marginBottom: 12 },
  insightsRow: { flexDirection: 'row', gap: 8 },
  insightBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12,
    backgroundColor: '#8b5cf618', borderWidth: 1, borderColor: '#8b5cf640',
  },
  insightBtnText: { fontSize: 13, fontWeight: '700', color: '#a78bfa' },

  historySection: { marginTop: 8 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  historyTitle: { fontSize: 11, fontWeight: '700', color: colors.textFaint, letterSpacing: 1 },
  archiveLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  archiveLinkText: { fontSize: 12, fontWeight: '700', color: '#ec4899' },
  historyItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  historyLeft: { flex: 1 },
  historyDateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  historyDate: { fontSize: 11, color: colors.textFaint },
  aiChipSm: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#ec489918', borderColor: '#ec489940', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1,
  },
  aiChipSmText: { fontSize: 9, color: '#ec4899', fontWeight: '800', letterSpacing: 0.3 },
  historyPreview: { fontSize: 13, color: colors.textDim, lineHeight: 18 },
  historyMood: { fontSize: 20 },
});
