import { colors, alphaHex, hexA } from '../../lib/tokens';
import { Image } from 'expo-image';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { navigateTo } from '../../lib/destinations';
import type { Habit } from '../../lib/supabase';
import { useHabitStore } from '../../store/habitStore';
import { useTaskStore } from '../../store/taskStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { useJournalStore } from '../../store/journalStore';
import { ACTION_COST } from '../../lib/subscription';
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
  SINGLE_HABIT_GOAL,
  type CoachAction,
  type CoachLogCompletion,
} from '../../lib/coachActions';
import CoachActionCard, { type StagedCoachAction, type ClarifyAnswer } from '../../components/coach/CoachActionCard';
// R09.02 — the second action set (gated): its own card, its own checks.
import CoachActionCardV2 from '../../components/coach/CoachActionCardV2';
import CoachMessageList, { type CoachMessage } from '../../components/coach/CoachMessageList';
import { habitFingerprint, isV2Type, staleness, type CoachActionV2 } from '../../lib/coachActionsV2';
import { completionFor, stateForValue } from '../../services/habitLogService';
import { firstMissingSemantic } from '../../lib/coachClarify';
import { sameUnit } from '../../lib/units';
import type { ProposalHabit } from '../../lib/routineProposal';
import { useRoutineStore } from '../../store/routineStore';
import { useLogStore } from '../../store/logStore';
import { useCoachSend } from '../../hooks/useCoachSend';
import { useSpeechInput } from '../../hooks/useSpeechInput';
import { useAiConversationStore } from '../../store/aiConversationStore';
import ConversationSheet from '../../components/coach/ConversationSheet';
import { useProjectStore } from '../../store/projectStore';
import { EmblemMedallion, TexturedSurface } from '../../components/ui';
import { AtmosphericScreenCanvas } from '../../components/spatial';
import { BENTO_ART, CANVASES, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

type Message = CoachMessage;

/**
 * What a completion MEANS for this habit, asked of the domain engine.
 *
 * AI Coach never decides done/partial/miss. For a value that is
 * `stateForValue` -- tracking type, behaviour type, target and direction, in
 * one place. For a state the user stated outright ("yaptım") it is that state,
 * minus `skip`, which is a deliberate action rather than an outcome and has no
 * place in a derived verdict.
 */
function derivedStateFor(
  habit: Habit,
  completion: CoachLogCompletion,
): 'done' | 'partial' | 'miss' {
  if (completion.kind === 'value') return stateForValue(habit, completion.value);
  return completion.state === 'skip' ? 'miss' : completion.state;
}

const QUICK_PROMPT_ART = [BENTO_ART.coachAnalyze, BENTO_ART.coachSuggest, BENTO_ART.coachShield, BENTO_ART.coachPlan] as const;
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
  const updatePendingPayload = useAiConversationStore((st) => st.updatePendingPayload);
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
  const setMessages = useCallback((updater: (prev: Message[]) => Message[]) => {
    // Only ever appends transient rows. Durable turns are written by the store.
    setTransient((prev) => {
      const next = updater([...prev]);
      return next.filter((m) => !storeMessages.some((sm) => sm.id === m.id) && m.id !== 'greeting');
    });
  }, [storeMessages]);
  const pushTransient = useCallback((m: Message) => {
    setMessages((prev) => [...prev, m]);
  }, [setMessages]);

  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // Günlüğe özetleme akışı
  const [summaryModal, setSummaryModal] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [summarySaving, setSummarySaving] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);

  // ── Conversational actions ────────────────────────────────────────────
  const [staged, setStaged] = useState<StagedCoachAction | null>(null);
  const [stagedV2, setStagedV2] = useState<CoachActionV2 | null>(null);
  const [stagedBusy, setStagedBusy] = useState(false);
  // R10.02 — state lags a render: two taps in one frame both read stagedBusy=false.
  const confirming = useRef(false);
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

  // Deterministic analytics summary computed ONCE per screen visit.
  const [analyticsHabits, setAnalyticsHabits] = useState<string[] | null>(null);
  const [analyticsSummary, setAnalyticsSummary] = useState<Record<string, string> | null>(null);

  const { send, summarize, loading, summarizing, streamingReply, insufficientCredits } = useCoachSend({
    activeId,
    input,
    setInput,
    hasConversation,
    habits,
    tasks,
    wp,
    analyticsHabits,
    analyticsSummary,
    sendToStore,
    setBalance,
    pushTransient,
  });

  // Reopen the thread the user was last in.
  useEffect(() => { void hydrateConversations(); }, [hydrateConversations]);

  // Transient receipts/errors belong to the thread they happened in.
  useEffect(() => { setTransient([]); }, [activeId]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [storeMessages, transient]);

  const loadAnalyticsSummary = useCallback(async () => {
    try {
      const activeHabitRows = useHabitStore.getState().habits.filter((h) => h.status === 'active');
      if (activeHabitRows.length === 0) return;

      const today = new Date();
      const end = ymd(today);
      const start = ymd(addDaysLocal(today, -55));
      const start30 = ymd(addDaysLocal(today, -29));

      const review = await loadReviewData({ start, end });
      if (!review.ok) return;
      const logs = review.data.logs;
      const recoveryRes = { ok: true as const, data: review.data.recoveryPlans };

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
      // best-effort
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
    const habit = resolution.habit;

    if (completion.kind === 'value' && completion.unit && !sameUnit(completion.unit, habit.unit)) {
      setStaged({ kind: 'unitMismatch', habit, date, value: completion.value, unit: completion.unit });
      return;
    }

    setStaged({ kind: 'log', habit, date, completion, derived: derivedStateFor(habit, completion) });
  }, [habits]);

  const previewProposal = useCallback((title: string, goal: string, list: ProposalHabit[]) => {
    const gap = firstMissingSemantic(list);
    if (gap) {
      setStaged({ kind: 'clarify', title, habits: list, index: gap.index, missing: gap.missing });
      return;
    }
    const ok = stageCoachProposal({ title, goal, habits: list });
    if (!ok) {
      setStaged({ kind: 'invalid', reasons: useRoutineStore.getState().proposalErrors ?? ['Öneri doğrulanamadı.'] });
      return;
    }
    setStaged({ kind: 'proposal', title, habits: list, evaluation: useRoutineStore.getState().evaluation });
  }, [stageCoachProposal]);

  const stageFromActions = useCallback((actions: CoachAction[]) => {
    const action = actions[0];
    if (!action) return;
    if (isV2Type(action.type)) { setStagedV2(action as CoachActionV2); return; }

    if (action.type === 'propose_habit_plan') {
      setStaged({ kind: 'planOffer', title: action.title, goal: action.goal, habits: action.habits });
      return;
    }

    if (action.type === 'propose_habit') {
      const proposal = coachActionToRoutineProposal(action);
      if (!proposal) return;
      previewProposal(proposal.title, proposal.goal, proposal.habits);
      return;
    }

    if (action.type === 'log_habit') stageLog(action.habit_query, action.date, action.completion);
  }, [previewProposal, stageLog]);

  function handleAcceptPlan() {
    if (staged?.kind !== 'planOffer') return;
    previewProposal(staged.title, staged.goal, staged.habits);
  }

  function handleClarify(answer: ClarifyAnswer) {
    if (staged?.kind !== 'clarify') return;
    const { title, habits: list, index } = staged;
    const next: ProposalHabit[] = list.map((h, i) => {
      if (i !== index) return h;
      if (answer.missing === 'frequency') return { ...h, frequency_config: answer.frequency_config };
      if (answer.daily_goal === null) {
        const { unit: _unit, daily_goal: _goal, target_direction: _dir, ...rest } = h;
        return { ...rest, tracking_type: 'binary' };
      }
      return {
        ...h,
        tracking_type: 'numeric',
        daily_goal: answer.daily_goal,
        unit: answer.unit,
        target_direction: h.target_direction ?? 'at_least',
      };
    });
    void updatePendingPayload(
      next.length === 1
        ? { type: 'propose_habit', habit: next[0] }
        : { type: 'propose_habit_plan', title, goal: SINGLE_HABIT_GOAL, habits: next },
    );
    previewProposal(title, SINGLE_HABIT_GOAL, next);
  }

  useEffect(() => {
    if (!pendingAction) { setStaged(null); setStagedV2(null); return; }
    stageFromActions([pendingAction.action]);
  }, [pendingAction, stageFromActions]);

  function handlePickCandidate(habit: Habit) {
    setStaged((prev) =>
      prev && prev.kind === 'ambiguous'
        ? {
            kind: 'log',
            habit,
            date: prev.date,
            completion: prev.completion,
            derived: derivedStateFor(habit, prev.completion),
          }
        : prev,
    );
  }

  function handleCancelStaged() {
    setStaged(null);
    clearGenerated();
    void resolvePendingAction('cancelled');
  }

  async function handleConfirmStaged() {
    if (!staged || stagedBusy || confirming.current) return;
    confirming.current = true;
    setStagedBusy(true);
    try {
      if (staged.kind === 'proposal') {
        const ok = await confirmInstall(pendingAction?.row.id);
        if (ok) {
          const resolved = await resolvePendingAction('confirmed');
          if (!resolved) await resolvePendingAction('confirmed');
        }
        setStaged(null);
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: ok ? 'assistant' : 'error',
          content: ok
            ? `✓ ${staged.habits.length} alışkanlık eklendi.`
            : (useRoutineStore.getState().installError ?? 'Alışkanlıklar eklenemedi.'),
        }]);
        if (ok) clearGenerated();
        return;
      }

      if (staged.kind === 'log' || staged.kind === 'unitMismatch') {
        const when = parseLocalDate(staged.date) ?? new Date();
        // R09.03 — re-verify entity fingerprint before writing.
        const live = useHabitStore.getState().habits.find((h) => h.id === staged.habit.id);
        const freshness = staleness(habitFingerprint(staged.habit), live, habitFingerprint);
        if (freshness === 'gone') {
          await resolvePendingAction('cancelled');
          setStaged(null);
          setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'error', content: `${staged.habit.name} artık yok; kayıt yazılmadı.` }]);
          return;
        }
        if (freshness === 'changed') {
          const c: CoachLogCompletion = staged.kind === 'unitMismatch' ? { kind: 'value', value: staged.value, unit: staged.unit } : staged.completion;
          stageLog(live!.name, staged.date, c);
          setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'Bu alışkanlık sen bakarken değişti; önizleme güncellendi. Tekrar onayla.' }]);
          return;
        }
        const habit = live!;
        const completion: CoachLogCompletion = staged.kind === 'unitMismatch'
          ? { kind: 'value', value: staged.value }
          : staged.completion;

        const intent = completion.kind === 'value'
          ? completionFor(habit, completion.value)
          : {
              state: completion.state,
              value: undefined as number | undefined,
              targetValue: habit.daily_goal ?? undefined,
              targetDirection: habit.target_direction ?? undefined,
            };

        const res = await logHabitWrite({
          habitId: habit.id,
          date: when,
          state: intent.state,
          value: intent.value,
          targetValue: intent.targetValue,
          targetDirection: intent.targetDirection,
        });
        const ok = res?.ok !== false;
        if (ok) await resolvePendingAction('confirmed');
        setStaged(null);
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: ok ? 'assistant' : 'error',
          content: ok
            ? `✓ ${habit.name} kaydedildi.`
            : 'Kayıt yazılamadı. Tekrar deneyebilirsin.',
        }]);
        return;
      }

      setStaged(null);
    } finally {
      confirming.current = false;
      setStagedBusy(false);
    }
  }

  async function copyMessage(m: Message) {
    await Clipboard.setStringAsync(m.content);
    setCopiedId(m.id);
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

  async function handleSummarize() {
    if (summarizing || loading || !hasConversation) return;
    const transcript = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.id !== '0')
      .map((m) => `${m.role === 'user' ? 'Ben' : 'Koç'}: ${m.content}`)
      .join('\n\n');
    const out = await summarize(transcript);
    if (out.ok) {
      setSummaryText(out.summary);
      setSummarySaved(false);
      setSummaryModal(true);
    }
  }

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
      <AtmosphericScreenCanvas source={CANVASES.oracleChamber} textureSource={TEXTURES.neural} scrim={0.62} tintColor={colors.primary} />
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity
              onPress={() => void handleSummarize()}
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
              <Text style={[s.headerBtnText, { color: hasConversation ? '#ec4899' : colors.textFaint }]}>Günlüğe</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        <TexturedSurface source={TEXTURES.neural} textureOpacity={0.05} overlayOnly />

        {/* Sohbet çubuğu: hangi sohbetteyiz, ve geçmiş */}
        <View style={s.convBar}>
          <EmblemMedallion
            source={SCREEN_BANNERS.coachOracle}
            size={36}
            unlocked
            accentColor={colors.primary}
          />
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
            <Ionicons name="flash" size={15} color={colors.warning} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={s.fpText}>{focusPoints} FP</Text>
            <Text style={s.fpSub}>· mesaj {ACTION_COST.coach} FP</Text>
          </View>
          <TouchableOpacity
            style={s.creditsBtn}
            onPress={() => router.push('/screens/focus-points')}
            accessibilityRole="button"
            accessibilityLabel="Focus Point bakiyeni aç"
          >
            <Ionicons name="flash-outline" size={13} color={colors.white} />
            <Text style={s.creditsText}>Krediler</Text>
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={s.messages}
          contentContainerStyle={s.messagesContent}
        >
          <CoachMessageList
            messages={messages}
            hasOlder={messagesHasMore}
            onLoadOlder={() => void loadOlderMessages()}
            copiedId={copiedId}
            speakingId={speakingId}
            onCopy={(m) => void copyMessage(m)}
            onSpeak={speakMessage}
            loading={loading}
            streamingReply={streamingReply}
          >
            {stagedV2 && (
              <CoachActionCardV2
                action={stagedV2}
                onDone={(ok, message) => {
                  void resolvePendingAction(ok ? 'confirmed' : 'cancelled');
                  setStagedV2(null);
                  setMessages((prev) => [...prev, { id: Date.now().toString(), role: ok ? 'assistant' : 'error', content: message }]);
                }}
              />
            )}

            {staged && (
              <CoachActionCard
                staged={staged}
                busy={stagedBusy}
                onConfirm={handleConfirmStaged}
                onCancel={handleCancelStaged}
                onPickCandidate={handlePickCandidate}
                onClarify={handleClarify}
                onAcceptPlan={handleAcceptPlan}
              />
            )}
          </CoachMessageList>
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
              onPress={() => void send(p)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityHint="Bu soruyu koça gönderir"
              accessibilityState={{ disabled: loading }}
            >
              <Image source={QUICK_PROMPT_ART[QUICK_PROMPTS.indexOf(p)] ?? BENTO_ART.coachAnalyze} style={s.quickThumb} contentFit="cover" cachePolicy="memory-disk" />
              <Text style={s.quickText}>{p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

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
            placeholderTextColor={colors.textFaint}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={500}
            onSubmitEditing={() => void send()}
            blurOnSubmit
            accessibilityLabel="Koça mesajın"
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnDisabled]}
            onPress={() => void send()}
            disabled={!input.trim() || loading}
            accessibilityRole="button"
            accessibilityLabel="Gönder"
            accessibilityState={{ disabled: !input.trim() || loading }}
          >
            <Ionicons name="send" size={18} color={colors.white} />
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
                <Ionicons name="close" size={20} color={colors.textFaint} />
              </TouchableOpacity>
            </View>

            {summarySaved ? (
              <View style={s.savedBox}>
                <View style={s.savedIcon}>
                  <Ionicons name="checkmark" size={22} color={colors.white} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
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
                    onPress={() => { setSummaryModal(false); navigateTo(router, 'journal'); }}
                    accessibilityRole="link"
                    accessibilityLabel="Günlüğü aç"
                  >
                    <Ionicons name="arrow-forward" size={15} color={colors.white} />
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
                  placeholderTextColor={colors.textFaint}
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
                      <ActivityIndicator size="small" color={colors.white} />
                    ) : (
                      <>
                        <Ionicons name="add" size={16} color={colors.white} />
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
  creditsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.warning, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  creditsText: { fontSize: 12, fontWeight: '700', color: colors.white },

  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 10, paddingBottom: 8 },

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

  quickRow: { maxHeight: 54, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  quickThumb: { width: 24, height: 24, borderRadius: 6 },
  quickContent: { paddingHorizontal: 12, paddingVertical: 6, gap: 8 },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: hexA(colors.surface, 0.92), borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6,
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
