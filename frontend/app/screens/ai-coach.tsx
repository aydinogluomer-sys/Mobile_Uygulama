import { colors, alphaHex } from '../../lib/tokens';
import { withEdgeDeadline } from '../../lib/edgeCall';
import { newRequestId } from '../../services/focusPointService';
import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { supabase, type Habit } from '../../lib/supabase';
import { useHabitStore } from '../../store/habitStore';
import { useTaskStore } from '../../store/taskStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { useJournalStore } from '../../store/journalStore';
import { ACTION_COST } from '../../lib/subscription';
import { extractInvokeError } from '../../lib/aiInvoke';
import { todayLocal, ymd, addDaysLocal, parseLocalDate } from '../../lib/date';
import { habitCompletionRate, weekdayBreakdown, bestWeekday, worstWeekday, recoverySuccessRate } from '../../lib/behaviorIntelligence';
import { planFromRow } from '../../lib/recovery';
import { loadReviewData } from '../../services/reviewService';
import { DOW_TR } from '../../lib/focusReport';
import * as Clipboard from 'expo-clipboard';
import * as Speech from 'expo-speech';
import {
  coachActionToRoutineProposal,
  resolveHabitQuery,
  type CoachAction,
  type CoachLogCompletion,
} from '../../lib/coachActions';
import CoachActionCard, { type StagedCoachAction } from '../../components/coach/CoachActionCard';
import { useRoutineStore } from '../../store/routineStore';
import { useLogStore } from '../../store/logStore';
import { useSpeechInput } from '../../hooks/useSpeechInput';
import { useAiConversationStore } from '../../store/aiConversationStore';
import ConversationSheet from '../../components/coach/ConversationSheet';
import { useProjectStore } from '../../store/projectStore';

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
  // ── Durable transcript ────────────────────────────────────────────────
  //
  // The conversation lives in Supabase, not here. `transient` holds the two
  // things that are NOT conversation and must not be persisted as if the model
  // had said them: request errors, and the "✓ written" receipts after a
  // confirmed action.
  const storeMessages = useAiConversationStore((st) => st.messages);
  const activeId = useAiConversationStore((st) => st.activeId);
  const conversations = useAiConversationStore((st) => st.conversations);
  const conversationsLoading = useAiConversationStore((st) => st.loadingConversations);
  const conversationsHasMore = useAiConversationStore((st) => st.conversationsHasMore);
  const pendingAction = useAiConversationStore((st) => st.pendingAction);
  const hydrateConversations = useAiConversationStore((st) => st.hydrate);
  const openConversation = useAiConversationStore((st) => st.openConversation);
  const loadOlderMessages = useAiConversationStore((st) => st.loadOlderMessages);
  const messagesHasMore = useAiConversationStore((st) => st.messagesHasMore);
  const newChat = useAiConversationStore((st) => st.newChat);
  const renameConversation = useAiConversationStore((st) => st.rename);
  const assignConversationProject = useAiConversationStore((st) => st.assignProject);
  const sendToStore = useAiConversationStore((st) => st.send);
  const resolvePendingAction = useAiConversationStore((st) => st.resolvePending);
  const loadMoreConversations = useAiConversationStore((st) => st.loadConversations);

  const [transient, setTransient] = useState<Message[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const projects = useProjectStore((st) => st.projects);

  const GREETING: Message = {
    id: 'greeting',
    role: 'assistant',
    content: 'Merhaba! Ben Aderyth AI Coach\'un. Alışkanlıkların, görevlerin ve hedeflerin hakkında sana yardımcı olabilirim. Ne öğrenmek istersin?',
  };

  const messages: Message[] = [
    ...(storeMessages.length === 0 ? [GREETING] : storeMessages.map((m) => ({ id: m.id, role: m.role, content: m.content }))),
    ...transient,
  ];
  const setMessages = (updater: (prev: Message[]) => Message[]) => {
    // Only ever appends transient rows. Durable turns are written by the store.
    setTransient((prev) => {
      const next = updater([...prev]);
      return next.filter((m) => !storeMessages.some((sm) => sm.id === m.id) && m.id !== 'greeting');
    });
  };
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

  // ── Conversational actions ────────────────────────────────────────────
  //
  // `staged` is the ONLY bridge between what the model suggested and what
  // gets written, and it is plain app state rather than something parsed back
  // out of chat history. That matters: "Evet" in a later message is not a
  // confirmation of anything specific, whereas a staged action names the
  // habit, the date and the completion, and the card shows all three.
  const [staged, setStaged] = useState<StagedCoachAction | null>(null);
  const [stagedBusy, setStagedBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const stageCoachProposal = useRoutineStore((s) => s.stageCoachProposal);
  const confirmInstall = useRoutineStore((s) => s.confirmInstall);
  const clearGenerated = useRoutineStore((s) => s.clearGenerated);
  const logHabitWrite = useLogStore((s) => s.logHabit);

  /** Dictation fills the composer. It never sends — see the hook's own doc. */
  const speech = useSpeechInput(setInput);

  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Leaving this screen must silence it: a half-read answer continuing to play
  // over whatever the user opened next is not something anyone asked for, and
  // the copy timer would otherwise touch state after unmount.
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    Speech.stop();
  }, []);

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

  // Reopen the thread the user was last in. This is the reported defect:
  // leaving AI Coach and returning must not silently start a fresh chat.
  useEffect(() => { void hydrateConversations(); }, [hydrateConversations]);

  // An error and a "✓ yazıldı" receipt belong to the thread they happened in.
  // They are not conversation and are never persisted, so switching threads
  // has to drop them -- otherwise thread A's "kredi yetersiz" sits underneath
  // thread B's transcript, which is a leak even though no row moved.
  useEffect(() => { setTransient([]); }, [activeId]);

  useEffect(() => {
    // The delay lets the new bubble lay out before scrolling to it. The
    // cleanup is the part that matters: without it every message left a live
    // timer behind, and on unmount those still fired and reached for a
    // ScrollView that no longer exists.
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [storeMessages, transient]);

  // Deliberately a one-shot, not re-run when `habits` changes later in the
  // session -- same intentional "fetch once on mount" scope as `fetchToday`/
  // `fetchSub` above.
  const loadAnalyticsSummary = useCallback(async () => {
    try {
      // Imperative read, not the `habits` binding from render: this is a
      // one-shot and must not gain a dependency that re-runs it.
      const activeHabitRows = useHabitStore.getState().habits.filter((h) => h.status === 'active');
      if (activeHabitRows.length === 0) return;

      const today = new Date();
      const end = ymd(today);
      // 8 weeks: clears weekdayBreakdown's MIN_WEEKDAY_SAMPLES (3) for most
      // weekdays and is recoverySuccessRate's whole input window; short
      // enough to stay a cheap, single-screen-visit fetch.
      const start = ymd(addDaysLocal(today, -55));
      const start30 = ymd(addDaysLocal(today, -29));

      const review = await loadReviewData({ start, end });
      if (!review.ok) return; // best-effort -- see field doc
      const logs = review.data.logs;
      const recoveryRes = { ok: true as const, data: review.data.recoveryPlans };

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
        const rate = recoverySuccessRate(recoveryRes.data.map(planFromRow));
        if (rate.ok) summary.telafi_basari_orani = `%${Math.round(rate.value * 100)}`;
      }

      setAnalyticsHabits(enrichedHabits);
      setAnalyticsSummary(Object.keys(summary).length > 0 ? summary : null);
    } catch {
      // best-effort -- see field doc above
    }
  }, []);

  useEffect(() => { fetchToday(); fetchSub(); loadAnalyticsSummary(); }, [fetchToday, fetchSub, loadAnalyticsSummary]);

  const stageLog = useCallback((query: string, date: string, completion: CoachLogCompletion) => {
    const resolution = resolveHabitQuery(query, habits);
    if (resolution.kind === 'none') { setStaged({ kind: 'nomatch', query }); return; }
    if (resolution.kind === 'ambiguous') {
      setStaged({ kind: 'ambiguous', candidates: resolution.candidates, date, completion });
      return;
    }
    setStaged({ kind: 'log', habit: resolution.habit, date, completion });
  }, [habits]);

  /**
   * Turn a validated suggestion into something the user can look at.
   *
   * Nothing here writes. A habit/plan is handed to the routine pipeline's
   * validator and capacity engine (the same one packs and AI routines use) so
   * the preview shows the REAL activate-vs-queue outcome rather than a guess;
   * a log is resolved against the user's own habits and refuses to choose when
   * two of them match.
   */
  const stageFromActions = useCallback((actions: CoachAction[]) => {
    const action = actions[0];
    if (!action) return;

    if (action.type === 'propose_habit' || action.type === 'propose_habit_plan') {
      const proposal = coachActionToRoutineProposal(action);
      if (!proposal) return;
      const ok = stageCoachProposal(proposal);
      if (!ok) {
        setStaged({ kind: 'invalid', reasons: useRoutineStore.getState().proposalErrors ?? ['Öneri doğrulanamadı.'] });
        return;
      }
      const st = useRoutineStore.getState();
      setStaged({
        kind: 'proposal',
        title: proposal.title,
        habitNames: proposal.habits.map((h) => h.name),
        evaluation: st.evaluation,
      });
      return;
    }

    stageLog(action.habit_query, action.date, action.completion);
  }, [stageCoachProposal, stageLog]);


  // A durable proposal belongs to the open conversation, so staging follows it
  // -- including on reopen, which is what makes a preview survive navigation.
  // Declared after `stageFromActions` on purpose: a callback used by an effect
  // has to exist before it, which is the same ordering rule that caught
  // `loadBadHabits` during the SDK migration.
  useEffect(() => {
    if (!pendingAction) { setStaged(null); return; }
    stageFromActions([pendingAction.action]);
  }, [pendingAction, stageFromActions]);

  /** Picking from the ambiguity card only narrows the target; it does not write. */
  function handlePickCandidate(habit: Habit) {
    setStaged((prev) =>
      prev && prev.kind === 'ambiguous'
        ? { kind: 'log', habit, date: prev.date, completion: prev.completion }
        : prev,
    );
  }

  function handleCancelStaged() {
    setStaged(null);
    clearGenerated();
    // Closes the DURABLE row too. Without this the proposal would come back as
    // pending the next time the conversation was opened, which is precisely
    // the "cancelled action silently reappears" case.
    void resolvePendingAction('cancelled');
  }

  /**
   * The only place in this screen that persists anything.
   *
   * `stagedBusy` is the double-tap guard; the install path has its own
   * (`installing` inside routineStore), and habit logs are reconciled on
   * `habit_id + completed_at`, so a repeated confirmation updates one row
   * rather than adding a second.
   */
  async function handleConfirmStaged() {
    if (!staged || stagedBusy) return;
    setStagedBusy(true);
    try {
      if (staged.kind === 'proposal') {
        const ok = await confirmInstall();
        // Resolved pending -> confirmed. The repository scopes that update to
        // rows still pending, so a second tap or a resumed app changes
        // nothing: one staged proposal, one install.
        if (ok) await resolvePendingAction('confirmed');
        setStaged(null);
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: ok ? 'assistant' : 'error',
          content: ok
            ? `✓ ${staged.habitNames.length} alışkanlık eklendi.`
            : (useRoutineStore.getState().installError ?? 'Alışkanlıklar eklenemedi.'),
        }]);
        if (ok) clearGenerated();
        return;
      }

      if (staged.kind === 'log') {
        const when = parseLocalDate(staged.date) ?? new Date();
        // The domain engine decides what a value MEANS. This passes the number
        // and the habit's own target; it never computes done/partial/miss and
        // never supplies XP.
        const res = await logHabitWrite({
          habitId: staged.habit.id,
          date: when,
          state: staged.completion.kind === 'state' ? staged.completion.state : 'done',
          value: staged.completion.kind === 'value' ? staged.completion.value : undefined,
          targetValue: staged.habit.daily_goal ?? undefined,
          targetDirection: staged.habit.target_direction ?? undefined,
        });
        const ok = res?.ok !== false;
        if (ok) await resolvePendingAction('confirmed');
        setStaged(null);
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: ok ? 'assistant' : 'error',
          content: ok
            ? `✓ ${staged.habit.name} kaydedildi.`
            : 'Kayıt yazılamadı. Tekrar deneyebilirsin.',
        }]);
        return;
      }

      setStaged(null);
    } finally {
      setStagedBusy(false);
    }
  }

  async function copyMessage(m: Message) {
    await Clipboard.setStringAsync(m.content);
    setCopiedId(m.id);
    // The "Kopyalandı" tick clears itself, and that timer must not outlive the
    // screen: a stray callback firing after unmount sets state on a component
    // that is gone. Held so it can be cancelled, and replaced rather than
    // stacked when two messages are copied in quick succession.
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId((cur) => (cur === m.id ? null : cur)), 1500);
  }

  function speakMessage(m: Message) {
    if (speakingId === m.id) { Speech.stop(); setSpeakingId(null); return; }
    Speech.stop();
    setSpeakingId(m.id);
    Speech.speak(m.content, {
      language: 'tr-TR',
      onDone: () => setSpeakingId((cur) => (cur === m.id ? null : cur)),
      onStopped: () => setSpeakingId((cur) => (cur === m.id ? null : cur)),
      onError: () => setSpeakingId((cur) => (cur === m.id ? null : cur)),
    });
  }

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput('');
    setLoading(true);
    setInsufficientCredits(false);
    // One key per attempt: a retry of THIS message replays the first charge
    // rather than paying for a second answer. See newRequestId().
    const requestId = newRequestId();

    try {
      // Deterministic analytics summary when available (see loadAnalyticsSummary
      // above), else the same plain habit-name list this screen always sent --
      // an analytics failure never blocks a coach message (Gate D).
      const activeHabits = analyticsHabits ?? habits.filter((h) => h.status === 'active').map((h) => h.name);
      const pendingTasks = tasks.filter((t) => !t.completed).length;

      // The STORE owns the turn now, because the ordering matters more than
      // the rendering: it persists the user message, calls the provider, and
      // persists the answer BEFORE any of this reports success. What the
      // screen supplies is the transport and the app's domain context.
      const res = await sendToStore(msg, {
        requestId,
        invoke: async (payload) => {
          const { data, error } = await withEdgeDeadline('AI Koç', (signal) =>
            supabase.functions.invoke('generate-routine', {
              signal,
              body: {
                ...payload,
                context: {
                  activeHabits,
                  pendingTaskCount: pendingTasks,
                  habitCount: habits.length,
                  willpower: wp
                    ? { used: wp.used, daily_budget: wp.daily_budget, active_count: wp.active_count, focus_capacity: wp.focus_capacity }
                    : undefined,
                  analytics: analyticsSummary ?? undefined,
                },
                mode: 'coach',
              },
            }));

          if (error) {
            // Sunucunun döndürdüğü gerçek hata mesajını çek (kredi, rate limit, vb.)
            const { msg: emsg, code, balance } = await extractInvokeError(error);
            if (typeof balance === 'number') setBalance(balance);
            if (code === 'INSUFFICIENT_CREDITS') setInsufficientCredits(true);
            throw new Error(emsg);
          }
          if (typeof data?.balance === 'number') setBalance(data.balance);
          return data ?? {};
        },
      });

      // A coach turn takes seconds and the user may open another conversation
      // meanwhile. The store says so, and a failure that belongs to a thread
      // nobody is looking at must not surface under the one they opened.
      if (res.stale) return;
      if (!res.ok) throw new Error(res.error ?? 'Bir hata oluştu');
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
    // One key per attempt: a retry of THIS summarise replays the first
    // charge instead of paying twice. See newRequestId().
    const requestId = newRequestId();
    try {
      const { data, error } = await withEdgeDeadline('AI Koç', (signal) =>
        supabase.functions.invoke('generate-routine', {
        signal,
        body: { mode: 'summarize', transcript, request_id: requestId },
      }));

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
              accessibilityRole="button"
              accessibilityLabel="Konuşmayı günlüğe özetle"
              accessibilityHint="Özeti önizleme penceresinde açar, düzenleyip bugünün günlüğüne ekleyebilirsin"
              accessibilityState={{ disabled: !hasConversation || summarizing || loading, busy: summarizing }}
            >
              {summarizing ? (
                <ActivityIndicator size="small" color="#ec4899" />
              ) : (
                <Ionicons name="book-outline" size={16} color={hasConversation ? '#ec4899' : colors.textGhost} />
              )}
              <Text style={[s.headerBtnText, { color: hasConversation ? '#ec4899' : colors.textGhost }]}>Günlüğe</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >

        {/* Sohbet çubuğu: hangi sohbetteyiz, ve geçmiş */}
        <View style={s.convBar}>
          <TouchableOpacity
            style={s.convBtn}
            onPress={() => { void loadMoreConversations({ reset: true }); setSheetOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel="Sohbet geçmişini aç"
          >
            <Ionicons name="chatbubbles-outline" size={15} color={colors.textDim} />
            <Text style={s.convTitle} numberOfLines={1}>
              {conversations.find((c) => c.id === activeId)?.title ?? 'Yeni Sohbet'}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.textGhost} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={newChat}
            hitSlop={8}
            style={s.convNew}
            accessibilityRole="button"
            accessibilityLabel="Yeni sohbet başlat"
          >
            <Ionicons name="add" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Focus Point barı */}
        <View style={[s.fpBar, insufficientCredits && s.fpBarWarn]}>
          <View style={s.fpLeft}>
            <Ionicons name="flash" size={15} color="#D4A84A" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={s.fpText}>{focusPoints} FP</Text>
            <Text style={s.fpSub}>· mesaj {ACTION_COST.coach} FP</Text>
          </View>
          <TouchableOpacity
            style={s.upgradeBtn}
            onPress={() => router.push('/screens/paywall')}
            accessibilityRole="button"
            accessibilityLabel="Üyeliği yükselt"
          >
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
          {messagesHasMore && (
            <TouchableOpacity
              onPress={() => void loadOlderMessages()}
              style={s.olderBtn}
              accessibilityRole="button"
              accessibilityLabel="Daha eski mesajları yükle"
            >
              <Text style={s.olderText}>Daha eski mesajlar</Text>
            </TouchableOpacity>
          )}
          {messages.map((m) => (
            /* The copy/speak controls are SIBLINGS of the bubble, never
               children of it. Putting them inside would mean touching the
               bubble's flex direction again, and that is the exact geometry
               that stretched a three-word message to the height of the
               conversation in Step 11A.1. This leaves those styles untouched. */
            <Fragment key={m.id}>
            <View
              style={[
                s.bubble,
                m.role === 'user' ? s.bubbleUser : s.bubbleAssistant,
                m.role === 'error' && s.bubbleError,
              ]}
              accessibilityRole={m.role === 'error' ? 'alert' : undefined}
            >
              {m.role === 'assistant' && (
                <View style={s.assistantIcon}>
                  <Ionicons name="sparkles" size={12} color="#8b5cf6" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                </View>
              )}
              <Text style={[
                s.bubbleText,
                // `flex: 1` belongs ONLY to the bubbles that lay out as a row.
                // Assistant and error bubbles put the sparkles icon beside the
                // text, so the text has to claim the rest of that row. The user
                // bubble has no icon and stays a column, where the very same
                // declaration stops meaning "fill the row" and starts meaning
                // "grow down the cross axis" -- which is what stretched a
                // three-word message to the height of the conversation.
                m.role !== 'user' && s.bubbleTextRow,
                m.role === 'user' && s.bubbleTextUser,
                m.role === 'error' && s.bubbleTextError,
              ]}>
                {m.content}
              </Text>
            </View>

            <View style={[s.msgActions, m.role === 'user' ? s.msgActionsRight : s.msgActionsLeft]}>
              <TouchableOpacity
                onPress={() => copyMessage(m)}
                hitSlop={10}
                style={s.msgActionBtn}
                accessibilityRole="button"
                accessibilityLabel="Mesajı kopyala"
              >
                <Ionicons
                  name={copiedId === m.id ? 'checkmark' : 'copy-outline'}
                  size={13}
                  color={copiedId === m.id ? colors.success : colors.textGhost}
                />
                {copiedId === m.id && <Text style={s.msgActionText}>Kopyalandı</Text>}
              </TouchableOpacity>

              {m.role === 'assistant' && (
                <TouchableOpacity
                  onPress={() => speakMessage(m)}
                  hitSlop={10}
                  style={s.msgActionBtn}
                  accessibilityRole="button"
                  accessibilityLabel={speakingId === m.id ? 'Sesli okumayı durdur' : 'Yanıtı sesli oku'}
                  accessibilityState={{ selected: speakingId === m.id }}
                >
                  <Ionicons
                    name={speakingId === m.id ? 'stop-circle-outline' : 'volume-medium-outline'}
                    size={14}
                    color={speakingId === m.id ? colors.primary : colors.textGhost}
                  />
                </TouchableOpacity>
              )}
            </View>
            </Fragment>
          ))}

          {/* The confirmation barrier. Rendered after the conversation so the
              thing being confirmed is the last thing on screen. */}
          {staged && (
            <CoachActionCard
              staged={staged}
              busy={stagedBusy}
              onConfirm={handleConfirmStaged}
              onCancel={handleCancelStaged}
              onPickCandidate={handlePickCandidate}
            />
          )}

          {loading && (
            // Yanıtın uzunluğu/şekli önceden bilinmiyor — burada iskelet değil,
            // "yazıyor" göstergesi doğru olan. Ekran okuyucuya da duyurulur.
            <View style={[s.bubble, s.bubbleAssistant]} accessibilityRole="progressbar" accessibilityLabel="Koç yanıt yazıyor">
              <ActivityIndicator size="small" color="#8b5cf6" />
            </View>
          )}
        </ScrollView>

        <ConversationSheet
          visible={sheetOpen}
          conversations={conversations}
          activeId={activeId}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          loading={conversationsLoading}
          hasMore={conversationsHasMore}
          onClose={() => setSheetOpen(false)}
          onOpen={(id) => void openConversation(id)}
          onNewChat={newChat}
          onRename={(id, title) => renameConversation(id, title)}
          onAssignProject={(id, projectId) => void assignConversationProject(id, projectId)}
          onLoadMore={() => void loadMoreConversations()}
        />

        {/* Quick prompts */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.quickRow}
          contentContainerStyle={s.quickContent}
        >
          {QUICK_PROMPTS.map((p) => (
            <TouchableOpacity
              key={p}
              style={s.quickBtn}
              onPress={() => send(p)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityHint="Bu soruyu koça gönderir"
              accessibilityState={{ disabled: loading }}
            >
              <Text style={s.quickText}>{p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Dictation state and failures are said out loud in text, because a
            microphone that silently did nothing is indistinguishable from one
            that is listening. */}
        {(speech.listening || speech.error) && (
          <Text style={s.micHint}>
            {speech.listening ? 'Dinliyorum… Bitince mikrofona tekrar dokun.' : speech.error}
          </Text>
        )}

        {/* Input */}
        <View style={s.inputRow}>
          {speech.available && (
            <TouchableOpacity
              style={[s.micBtn, speech.listening && s.micBtnActive]}
              onPress={() => (speech.listening ? speech.stop() : speech.start())}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={speech.listening ? 'Dinlemeyi durdur' : 'Sesli yanıt ver'}
              accessibilityHint="Söylediklerin yazı kutusuna geçer; göndermeden önce düzenleyebilirsin"
              accessibilityState={{ disabled: loading, selected: speech.listening }}
            >
              <Ionicons
                name={speech.listening ? 'stop' : 'mic-outline'}
                size={18}
                color={speech.listening ? colors.primary : colors.textDim}
              />
            </TouchableOpacity>
          )}
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
            accessibilityLabel="Koça mesajın"
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnDisabled]}
            onPress={() => send()}
            disabled={!input.trim() || loading}
            accessibilityRole="button"
            accessibilityLabel="Gönder"
            accessibilityState={{ disabled: !input.trim() || loading }}
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
                <Ionicons name="sparkles" size={15} color="#ec4899" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                <Text style={s.modalTitle} accessibilityRole="header">Günlüğe Özet</Text>
              </View>
              <TouchableOpacity
                onPress={() => setSummaryModal(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
              >
                <Ionicons name="close" size={20} color="#827E72" />
              </TouchableOpacity>
            </View>

            {summarySaved ? (
              <View style={s.savedBox}>
                <View style={s.savedIcon}>
                  <Ionicons name="checkmark" size={22} color="#fff" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                </View>
                <Text style={s.savedText}>Bugünün günlüğüne eklendi</Text>
                <View style={s.modalFooter}>
                  <TouchableOpacity
                    style={[s.modalBtn, s.modalBtnGhost]}
                    onPress={() => setSummaryModal(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Kapat"
                  >
                    <Text style={s.modalBtnGhostText}>Kapat</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.modalBtn, s.modalBtnPrimary]}
                    onPress={() => { setSummaryModal(false); router.push('/screens/journal' as any); }}
                    accessibilityRole="link"
                    accessibilityLabel="Günlüğü aç"
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
                  accessibilityLabel="Günlüğe eklenecek özet"
                />
                <View style={s.modalFooter}>
                  <TouchableOpacity
                    style={[s.modalBtn, s.modalBtnGhost]}
                    onPress={() => setSummaryModal(false)}
                    accessibilityRole="button"
                    accessibilityLabel="İptal"
                  >
                    <Text style={s.modalBtnGhostText}>İptal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.modalBtn, s.modalBtnPrimary, (!summaryText.trim() || summarySaving) && s.modalBtnDisabled]}
                    onPress={saveSummaryToJournal}
                    disabled={!summaryText.trim() || summarySaving}
                    accessibilityRole="button"
                    accessibilityLabel="Günlüğe ekle"
                    accessibilityState={{ disabled: !summaryText.trim() || summarySaving, busy: summarySaving }}
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
  safe: { flex: 1, backgroundColor: colors.bg },

  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  headerBtnText: { fontSize: 13, fontWeight: '700' },

  fpBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  fpBarWarn: { backgroundColor: alphaHex(colors.error, '12'), borderBottomColor: alphaHex(colors.error, '30') },
  fpLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fpText: { fontSize: 14, fontWeight: '700', color: colors.warning },
  fpSub: { fontSize: 11, color: colors.textFaint },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.warning, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  upgradeText: { fontSize: 12, fontWeight: '700', color: colors.white },

  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 10, paddingBottom: 8 },

  bubble: {
    maxWidth: '85%', borderRadius: 16, padding: 12,
    borderWidth: 1,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
  },
  bubbleError: {
    alignSelf: 'flex-start',
    backgroundColor: alphaHex(colors.error, '15'),
    borderColor: alphaHex(colors.error, '30'),
  },
  assistantIcon: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#8b5cf620', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  // Typography only -- deliberately no `flex` here. Every bubble shares this,
  // but they do not share a flex direction: `bubbleAssistant` (which the error
  // bubble also builds on) sets `flexDirection: 'row'`, while `bubbleUser`
  // stays a column. A single `flex: 1` cannot be right for both.
  bubbleText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  /** Row bubbles only: take the width left over beside the icon. */
  bubbleTextRow: { flex: 1 },
  bubbleTextUser: { color: colors.white },
  bubbleTextError: { color: colors.error },

  // Sits under the bubble, not inside it. `alignSelf` mirrors the bubble's own
  // side so the controls stay with their message; nothing here can influence
  // the bubble's height.
  msgActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: -4 },
  msgActionsLeft: { alignSelf: 'flex-start', paddingLeft: 4 },
  msgActionsRight: { alignSelf: 'flex-end', paddingRight: 4 },
  msgActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, minHeight: 28 },
  msgActionText: { fontSize: 11, color: colors.success, fontWeight: '600' },

  micBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  micBtnActive: { backgroundColor: alphaHex(colors.primary, '22'), borderColor: colors.primary },
  micHint: { fontSize: 11, color: colors.textFaint, paddingHorizontal: 16, paddingBottom: 4 },

  convBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  convBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 36, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  convTitle: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '600' },
  convNew: {
    width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  olderBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  olderText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },

  quickRow: { maxHeight: 44, borderTopWidth: 1, borderTopColor: colors.surface },
  quickContent: { paddingHorizontal: 12, paddingVertical: 6, gap: 8 },
  quickBtn: {
    backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  quickText: { fontSize: 12, color: colors.textDim },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    padding: 12, borderTopWidth: 1, borderTopColor: colors.surface,
  },
  input: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 12,
    fontSize: 14, color: colors.white, borderWidth: 1, borderColor: colors.border,
    maxHeight: 100,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },

  // Günlüğe özet modalı
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 18 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  modalSub: { fontSize: 12.5, color: colors.textFaint, marginBottom: 12, lineHeight: 18 },
  summaryInput: {
    backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: 12, fontSize: 14, color: colors.text, lineHeight: 21,
    minHeight: 150, maxHeight: 280, marginBottom: 14,
  },
  modalFooter: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  modalBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 12, paddingVertical: 12,
  },
  modalBtnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  modalBtnGhostText: { fontSize: 14, fontWeight: '600', color: colors.textDim },
  modalBtnPrimary: { backgroundColor: '#ec4899' },
  modalBtnPrimaryText: { fontSize: 14, fontWeight: '700', color: colors.white },
  modalBtnDisabled: { opacity: 0.4 },
  savedBox: { alignItems: 'center', paddingTop: 6 },
  savedIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  savedText: { fontSize: 14, color: colors.text, fontWeight: '600', marginBottom: 18 },
});
