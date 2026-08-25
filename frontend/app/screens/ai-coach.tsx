import { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useHabitStore } from '../../store/habitStore';
import { useTaskStore } from '../../store/taskStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { useJournalStore } from '../../store/journalStore';
import { ACTION_COST } from '../../lib/subscription';
import { extractInvokeError } from '../../lib/aiInvoke';
import { todayLocal, ymd, addDaysLocal } from '../../lib/date';
import { habitCompletionRate, weekdayBreakdown, bestWeekday, worstWeekday, recoverySuccessRate } from '../../lib/behaviorIntelligence';
import { fromLegacyRecoveryPlan } from '../../lib/recovery';
import { fetchHabitLogsForReview } from '../../repositories/habitLogRepository';
import { fetchRecoveryPlansForReview } from '../../repositories/recoveryRepository';
import { DOW_TR } from '../../lib/focusReport';

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
};

const QUICK_PROMPTS = [
  'Alışkanlıklarımı analiz et',
  'Yeni alışkanlık öner',
  'Motivasyon düşüşü için öneri',
  'Haftalık plan öner',
];

export default function AICoachScreen() {
  const router = useRouter();
  const { habits } = useHabitStore();
  const { tasks } = useTaskStore();
  const { state: wp, fetchToday } = useWillpowerStore();
  const { focusPoints, fetch: fetchSub, setBalance } = useSubscriptionStore();
  const appendEntry = useJournalStore((s) => s.appendEntry);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: 'Merhaba! Ben Atlas AI Coach\'un. Alışkanlıkların, görevlerin ve hedeflerin hakkında sana yardımcı olabilirim. Ne öğrenmek istersin?',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Günlüğe özetleme akışı
  const [summarizing, setSummarizing] = useState(false);
  const [summaryModal, setSummaryModal] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [summarySaving, setSummarySaving] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);

  const hasConversation = messages.some((m) => m.role === 'user');

  // Deterministic analytics summary (plan §13: "send walking_completion_30d
  // = 72, monday_completion = 41, recovery_success = 80 -- not raw rows").
  // Computed ONCE per screen visit from lib/behaviorIntelligence.ts (Phase 2's
  // exact-arithmetic engine, the same one app/screens/insights.tsx uses) --
  // never re-derived per message, and never blocking: a failure here leaves
  // both pieces of state `null` and `send()` below falls back to the plain
  // habit-name list it always sent, so an analytics hiccup can never break
  // the coach itself (Gate D).
  const [analyticsHabits, setAnalyticsHabits] = useState<string[] | null>(null);
  const [analyticsSummary, setAnalyticsSummary] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages]);

  useEffect(() => { fetchToday(); fetchSub(); loadAnalyticsSummary(); }, []);

  // Deliberately a one-shot, not re-run when `habits` changes later in the
  // session -- same intentional "fetch once on mount" scope as `fetchToday`/
  // `fetchSub` above.
  async function loadAnalyticsSummary() {
    try {
      const activeHabitRows = habits.filter((h) => h.status === 'active');
      if (activeHabitRows.length === 0) return;

      const today = new Date();
      const end = ymd(today);
      // 8 weeks: clears weekdayBreakdown's MIN_WEEKDAY_SAMPLES (3) for most
      // weekdays and is recoverySuccessRate's whole input window; short
      // enough to stay a cheap, single-screen-visit fetch.
      const start = ymd(addDaysLocal(today, -55));
      const start30 = ymd(addDaysLocal(today, -29));

      const [logsRes, recoveryRes] = await Promise.all([
        fetchHabitLogsForReview({ start, end }),
        fetchRecoveryPlansForReview({ start, end }),
      ]);
      if (!logsRes.ok) return; // best-effort -- see field doc
      const logs = logsRes.data;

      // Enriches the SAME `activeHabits` array the edge function already
      // reads verbatim into its prompt (`ctx.activeHabits.join(', ')`) with
      // each habit's real 30-day completion rate -- e.g. plan §13's own
      // `walking_completion_30d = 72` example, computed via
      // `habitCompletionRate`, never fabricated when data is insufficient.
      const enrichedHabits = activeHabitRows.slice(0, 20).map((h) => {
        const r = habitCompletionRate(h, logs, { start: start30, end });
        return r.ok ? `${h.name} (30g tamamlama: %${Math.round(r.value * 100)})` : h.name;
      });

      const summary: Record<string, string> = {};
      const stats = weekdayBreakdown(activeHabitRows, logs, { start, end });
      const best = bestWeekday(stats);
      const worst = worstWeekday(stats);
      if (best.ok) summary.en_iyi_gun = `${DOW_TR[best.value.weekday]} (%${Math.round(best.value.rate * 100)})`;
      if (worst.ok) summary.en_zayif_gun = `${DOW_TR[worst.value.weekday]} (%${Math.round(worst.value.rate * 100)})`;

      if (recoveryRes.ok) {
        const rate = recoverySuccessRate(recoveryRes.data.map(fromLegacyRecoveryPlan));
        if (rate.ok) summary.telafi_basari_orani = `%${Math.round(rate.value * 100)}`;
      }

      setAnalyticsHabits(enrichedHabits);
      setAnalyticsSummary(Object.keys(summary).length > 0 ? summary : null);
    } catch {
      // best-effort -- see field doc above
    }
  }

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput('');

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: msg };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setInsufficientCredits(false);

    try {
      // Deterministic analytics summary when available (see loadAnalyticsSummary
      // above), else the same plain habit-name list this screen always sent --
      // an analytics failure never blocks a coach message (Gate D).
      const activeHabits = analyticsHabits ?? habits.filter((h) => h.status === 'active').map((h) => h.name);
      const pendingTasks = tasks.filter((t) => !t.completed).length;

      const { data, error } = await supabase.functions.invoke('generate-routine', {
        body: {
          message: msg,
          context: {
            activeHabits,
            pendingTaskCount: pendingTasks,
            habitCount: habits.length,
            willpower: wp
              ? { used: wp.used, daily_budget: wp.daily_budget, active_count: wp.active_count, focus_capacity: wp.focus_capacity }
              : undefined,
            // Additional deterministic behaviorIntelligence.ts summaries
            // (best/worst weekday, recovery success). NOTE (see this task's
            // Edge Function Findings): today's generate-routine coach prompt
            // builder only reads ctx.activeHabits/habitCount/pendingTaskCount/
            // willpower -- this field is not yet forwarded into the LLM
            // prompt server-side. Sent anyway so the shape is correct and
            // ready the moment that prompt builder is updated to read it;
            // `activeHabits` above is where the enrichment actually reaches
            // the model today.
            analytics: analyticsSummary ?? undefined,
          },
          mode: 'coach',
        },
      });

      if (error) {
        // Sunucunun döndürdüğü gerçek hata mesajını çek (kredi, rate limit, vb.)
        const { msg, code, balance } = await extractInvokeError(error);
        if (typeof balance === 'number') setBalance(balance);
        if (code === 'INSUFFICIENT_CREDITS') setInsufficientCredits(true);
        throw new Error(msg);
      }

      if (data?.error) throw new Error(data.error);
      const reply = data?.reply;
      if (!reply) throw new Error('Yanıt alınamadı, tekrar deneyin.');

      if (typeof data?.balance === 'number') setBalance(data.balance);
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'assistant', content: reply }]);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Bir hata oluştu';
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'error', content: errMsg }]);
    } finally {
      setLoading(false);
    }
  }

  // Konuşmayı özetleyip günlüğe eklenebilir bir taslak üret → önizleme modalı aç
  async function summarize() {
    if (summarizing || loading || !hasConversation) return;

    const transcript = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.id !== '0')
      .map((m) => `${m.role === 'user' ? 'Ben' : 'Koç'}: ${m.content}`)
      .join('\n\n');
    if (transcript.trim().length < 10) return;

    setSummarizing(true);
    setInsufficientCredits(false);
    try {
      const { data, error } = await supabase.functions.invoke('generate-routine', {
        body: { mode: 'summarize', transcript },
      });

      if (error) {
        const { msg, code, balance } = await extractInvokeError(error);
        if (typeof balance === 'number') setBalance(balance);
        if (code === 'INSUFFICIENT_CREDITS') setInsufficientCredits(true);
        throw new Error(msg);
      }

      if (data?.error) throw new Error(data.error);
      const summary = data?.summary;
      if (!summary) throw new Error('Özet alınamadı, tekrar deneyin.');

      if (typeof data?.balance === 'number') setBalance(data.balance);
      setSummaryText(summary);
      setSummarySaved(false);
      setSummaryModal(true);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Bir hata oluştu';
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'error', content: errMsg }]);
    } finally {
      setSummarizing(false);
    }
  }

  // Düzenlenen özeti bugünün günlük kaydına ekle
  async function saveSummaryToJournal() {
    const text = summaryText.trim();
    if (!text || summarySaving) return;
    setSummarySaving(true);
    try {
      const today = todayLocal();
      await appendEntry(today, `🤖 AI Coach özeti\n${text}`);
      setSummarySaved(true);
    } catch {
      // sessizce geç — kullanıcı tekrar deneyebilir
    } finally {
      setSummarySaving(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity
              onPress={summarize}
              disabled={!hasConversation || summarizing || loading}
              style={s.headerBtn}
              hitSlop={8}
            >
              {summarizing ? (
                <ActivityIndicator size="small" color="#ec4899" />
              ) : (
                <Ionicons name="book-outline" size={16} color={hasConversation ? '#ec4899' : '#56544B'} />
              )}
              <Text style={[s.headerBtnText, { color: hasConversation ? '#ec4899' : '#56544B' }]}>Günlüğe</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >

        {/* Focus Point barı */}
        <View style={[s.fpBar, insufficientCredits && s.fpBarWarn]}>
          <View style={s.fpLeft}>
            <Ionicons name="flash" size={15} color="#D4A84A" />
            <Text style={s.fpText}>{focusPoints} FP</Text>
            <Text style={s.fpSub}>· mesaj {ACTION_COST.coach} FP</Text>
          </View>
          <TouchableOpacity style={s.upgradeBtn} onPress={() => router.push('/screens/paywall')}>
            <Ionicons name="diamond-outline" size={13} color="#fff" />
            <Text style={s.upgradeText}>Yükselt</Text>
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={s.messages}
          contentContainerStyle={s.messagesContent}
        >
          {messages.map((m) => (
            <View
              key={m.id}
              style={[
                s.bubble,
                m.role === 'user' ? s.bubbleUser : s.bubbleAssistant,
                m.role === 'error' && s.bubbleError,
              ]}
            >
              {m.role === 'assistant' && (
                <View style={s.assistantIcon}>
                  <Ionicons name="sparkles" size={12} color="#8b5cf6" />
                </View>
              )}
              <Text style={[
                s.bubbleText,
                m.role === 'user' && s.bubbleTextUser,
                m.role === 'error' && s.bubbleTextError,
              ]}>
                {m.content}
              </Text>
            </View>
          ))}
          {loading && (
            <View style={[s.bubble, s.bubbleAssistant]}>
              <ActivityIndicator size="small" color="#8b5cf6" />
            </View>
          )}
        </ScrollView>

        {/* Quick prompts */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.quickRow}
          contentContainerStyle={s.quickContent}
        >
          {QUICK_PROMPTS.map((p) => (
            <TouchableOpacity key={p} style={s.quickBtn} onPress={() => send(p)} disabled={loading}>
              <Text style={s.quickText}>{p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Input */}
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            placeholder="Bir şey sor..."
            placeholderTextColor="#56544B"
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={500}
            onSubmitEditing={() => send()}
            blurOnSubmit
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnDisabled]}
            onPress={() => send()}
            disabled={!input.trim() || loading}
          >
            <Ionicons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

      </KeyboardAvoidingView>

      {/* Günlüğe özet önizleme */}
      <Modal
        visible={summaryModal}
        transparent
        animationType="fade"
        onRequestClose={() => setSummaryModal(false)}
      >
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <View style={s.modalTitleWrap}>
                <Ionicons name="sparkles" size={15} color="#ec4899" />
                <Text style={s.modalTitle}>Günlüğe Özet</Text>
              </View>
              <TouchableOpacity onPress={() => setSummaryModal(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color="#827E72" />
              </TouchableOpacity>
            </View>

            {summarySaved ? (
              <View style={s.savedBox}>
                <View style={s.savedIcon}>
                  <Ionicons name="checkmark" size={22} color="#fff" />
                </View>
                <Text style={s.savedText}>Bugünün günlüğüne eklendi</Text>
                <View style={s.modalFooter}>
                  <TouchableOpacity style={[s.modalBtn, s.modalBtnGhost]} onPress={() => setSummaryModal(false)}>
                    <Text style={s.modalBtnGhostText}>Kapat</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.modalBtn, s.modalBtnPrimary]}
                    onPress={() => { setSummaryModal(false); router.push('/screens/journal' as any); }}
                  >
                    <Ionicons name="arrow-forward" size={15} color="#fff" />
                    <Text style={s.modalBtnPrimaryText}>Günlüğü Aç</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <Text style={s.modalSub}>Bu özeti düzenleyip bugünün günlüğüne ekleyebilirsin.</Text>
                <TextInput
                  style={s.summaryInput}
                  value={summaryText}
                  onChangeText={setSummaryText}
                  multiline
                  textAlignVertical="top"
                  placeholder="Özet..."
                  placeholderTextColor="#56544B"
                />
                <View style={s.modalFooter}>
                  <TouchableOpacity style={[s.modalBtn, s.modalBtnGhost]} onPress={() => setSummaryModal(false)}>
                    <Text style={s.modalBtnGhostText}>İptal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.modalBtn, s.modalBtnPrimary, (!summaryText.trim() || summarySaving) && s.modalBtnDisabled]}
                    onPress={saveSummaryToJournal}
                    disabled={!summaryText.trim() || summarySaving}
                  >
                    {summarySaving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="add" size={16} color="#fff" />
                        <Text style={s.modalBtnPrimaryText}>Günlüğe Ekle</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#15140F' },

  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  headerBtnText: { fontSize: 13, fontWeight: '700' },

  fpBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#1D1C17', borderBottomWidth: 1, borderBottomColor: '#28261F',
  },
  fpBarWarn: { backgroundColor: '#C76A6A12', borderBottomColor: '#C76A6A30' },
  fpLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fpText: { fontSize: 14, fontWeight: '700', color: '#D4A84A' },
  fpSub: { fontSize: 11, color: '#827E72' },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#D4A84A', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  upgradeText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 10, paddingBottom: 8 },

  bubble: {
    maxWidth: '85%', borderRadius: 16, padding: 12,
    borderWidth: 1,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#D97757',
    borderColor: '#D97757',
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#1D1C17',
    borderColor: '#383528',
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
  },
  bubbleError: {
    alignSelf: 'flex-start',
    backgroundColor: '#C76A6A15',
    borderColor: '#C76A6A30',
  },
  assistantIcon: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#8b5cf620', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  bubbleText: { fontSize: 14, color: '#EDEAE0', lineHeight: 20, flex: 1 },
  bubbleTextUser: { color: '#fff' },
  bubbleTextError: { color: '#C76A6A' },

  quickRow: { maxHeight: 44, borderTopWidth: 1, borderTopColor: '#1D1C17' },
  quickContent: { paddingHorizontal: 12, paddingVertical: 6, gap: 8 },
  quickBtn: {
    backgroundColor: '#1D1C17', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1, borderColor: '#383528',
  },
  quickText: { fontSize: 12, color: '#BFBBAE' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    padding: 12, borderTopWidth: 1, borderTopColor: '#1D1C17',
  },
  input: {
    flex: 1, backgroundColor: '#1D1C17', borderRadius: 14, padding: 12,
    fontSize: 14, color: '#fff', borderWidth: 1, borderColor: '#383528',
    maxHeight: 100,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#D97757', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },

  // Günlüğe özet modalı
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#1D1C17', borderRadius: 20, borderWidth: 1, borderColor: '#383528', padding: 18 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#EDEAE0' },
  modalSub: { fontSize: 12.5, color: '#827E72', marginBottom: 12, lineHeight: 18 },
  summaryInput: {
    backgroundColor: '#15140F', borderRadius: 14, borderWidth: 1, borderColor: '#383528',
    padding: 12, fontSize: 14, color: '#EDEAE0', lineHeight: 21,
    minHeight: 150, maxHeight: 280, marginBottom: 14,
  },
  modalFooter: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  modalBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 12, paddingVertical: 12,
  },
  modalBtnGhost: { backgroundColor: '#15140F', borderWidth: 1, borderColor: '#383528' },
  modalBtnGhostText: { fontSize: 14, fontWeight: '600', color: '#BFBBAE' },
  modalBtnPrimary: { backgroundColor: '#ec4899' },
  modalBtnPrimaryText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  modalBtnDisabled: { opacity: 0.4 },
  savedBox: { alignItems: 'center', paddingTop: 6 },
  savedIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#87A678',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  savedText: { fontSize: 14, color: '#EDEAE0', fontWeight: '600', marginBottom: 18 },
});
