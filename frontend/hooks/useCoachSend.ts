import { useEffect, useRef, useState } from 'react';
import {
  createAttemptKeeper,
  IN_PROGRESS_NOTE,
  isNoAnswer,
  NO_ANSWER_NOTE,
  retryWhileInProgress,
} from '../lib/aiAttempt';
import { extractInvokeError } from '../lib/aiInvoke';
import { createEdgeAbortController, withEdgeDeadline } from '../lib/edgeCall';
import { supabase, type Habit } from '../lib/supabase';
import type { CoachInvokeResult } from '../services/aiCoachService';
import { invokeAiWithStream } from '../services/aiStreamService';
import { newRequestId } from '../services/focusPointService';

export type CoachMessage = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
};

export type UseCoachSendArgs = {
  activeId: string | null;
  input: string;
  setInput: (v: string) => void;
  hasConversation: boolean;
  habits: Habit[];
  tasks: { completed: boolean }[];
  wp: { used: number; daily_budget: number; active_count: number; focus_capacity: number } | null;
  analyticsHabits: string[] | null;
  analyticsSummary: Record<string, string> | null;
  sendToStore: (
    text: string,
    opts: {
      requestId: string;
      onConversationCreated?: (row: { id: string; user_id: string; title: string; project_id: string | null; created_at: string; updated_at: string; last_message_at: string; archived_at: string | null }) => void;
      invoke: (payload: Record<string, unknown>) => Promise<CoachInvokeResult>;
    },
  ) => Promise<{ ok: boolean; error?: string; stale?: boolean }>;
  setBalance: (n: number) => void;
  pushTransient: (m: CoachMessage) => void;
};

// R09.06 — an unanswered coach message / summary keeps its request id for the resend.
const coachAttempt = createAttemptKeeper(newRequestId);
const summaryAttempt = createAttemptKeeper(newRequestId);

export function useCoachSend(args: UseCoachSendArgs): {
  send: (text?: string) => Promise<void>;
  summarize: (transcript: string) => Promise<{ ok: true; summary: string } | { ok: false }>;
  loading: boolean;
  summarizing: boolean;
  streamingReply: string;
  insufficientCredits: boolean;
} {
  const {
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
  } = args;

  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const turn = useRef(0);

  const [loading, setLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [streamingReply, setStreamingReply] = useState('');
  const [insufficientCredits, setInsufficientCredits] = useState(false);

  useEffect(() => () => {
    mountedRef.current = false;
    abortRef.current?.abort();
  }, []);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    abortRef.current?.abort();
    const ctrl = createEdgeAbortController();
    abortRef.current = ctrl;
    const my = ++turn.current;

    setInput('');
    setLoading(true);
    setInsufficientCredits(false);
    // One key per attempt: a retry of THIS message replays the first charge
    // rather than paying for a second answer. R09.06 --
    // "a retry" includes sending the same text again after a lost answer.
    const requestId = coachAttempt.begin(`${activeId ?? ''}|${msg}`);
    const startedKey = `${activeId ?? ''}|${msg}`;

    try {
      // Deterministic analytics summary when available, else the plain habit-name list --
      // an analytics failure never blocks a coach message (Gate D).
      const activeHabits = analyticsHabits ?? habits.filter((h) => h.status === 'active').map((h) => h.name);
      const pendingTasks = tasks.filter((t) => !t.completed).length;

      const res = await sendToStore(msg, {
        requestId,
        onConversationCreated: (row) => coachAttempt.rebind(startedKey, `${row.id}|${msg}`),
        invoke: async (payload) => {
          if (turn.current === my && mountedRef.current) setStreamingReply('');
          const outcome = await retryWhileInProgress(
            () => invokeAiWithStream({
              signal: ctrl.signal,
              onReplyText: (partial) => {
                if (turn.current === my && mountedRef.current) setStreamingReply(partial);
              },
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
            }),
            { isCancelled: () => !mountedRef.current || ctrl.signal.aborted },
          );
          const { data, error } = outcome;

          if (error && isNoAnswer(error)) throw new Error(NO_ANSWER_NOTE);
          if (outcome.stillInProgress) throw new Error(IN_PROGRESS_NOTE); // anahtar KORUNUR: answered() çağrılmaz
          coachAttempt.answered();
          if (error) {
            const { msg: emsg, code, balance } = outcome.errorInfo ?? await extractInvokeError(error);
            if (typeof balance === 'number') setBalance(balance);
            if (code === 'INSUFFICIENT_CREDITS' && mountedRef.current) setInsufficientCredits(true);
            throw new Error(emsg);
          }
          if (typeof data?.balance === 'number') setBalance(data.balance);
          return data ?? {};
        },
      });

      if (res.stale || !mountedRef.current || turn.current !== my) return;
      if (!res.ok) throw new Error(res.error ?? 'Bir hata oluştu');
    } catch (e) {
      if (!mountedRef.current || ctrl.signal.aborted) return;
      const errMsg = e instanceof Error ? e.message : 'Bir hata oluştu';
      pushTransient({ id: Date.now().toString(), role: 'error', content: errMsg });
    } finally {
      if (turn.current === my && mountedRef.current) {
        setStreamingReply('');
        setLoading(false);
      }
    }
  }

  // Konuşmayı özetleyip günlüğe eklenebilir bir taslak üret
  async function summarize(transcript: string): Promise<{ ok: true; summary: string } | { ok: false }> {
    if (summarizing || loading || !hasConversation) return { ok: false };
    if (transcript.trim().length < 10) return { ok: false };

    setSummarizing(true);
    setInsufficientCredits(false);
    // One key per attempt: a retry of THIS summarise replays the first
    // charge instead of paying twice.
    const requestId = summaryAttempt.begin(transcript);
    try {
      const outcome = await retryWhileInProgress(
        () => withEdgeDeadline('AI Koç', (signal) =>
          supabase.functions.invoke('generate-routine', {
            signal,
            body: { mode: 'summarize', transcript, request_id: requestId },
          })),
        { isCancelled: () => !mountedRef.current },
      );
      const { data, error } = outcome;

      if (error && isNoAnswer(error)) throw new Error(NO_ANSWER_NOTE);
      if (outcome.stillInProgress) throw new Error(IN_PROGRESS_NOTE);
      summaryAttempt.answered();
      if (error) {
        const { msg, code, balance } = outcome.errorInfo ?? await extractInvokeError(error);
        if (typeof balance === 'number') setBalance(balance);
        if (code === 'INSUFFICIENT_CREDITS' && mountedRef.current) setInsufficientCredits(true);
        throw new Error(msg);
      }

      if (data?.error) throw new Error(data.error);
      const summary = data?.summary;
      if (!summary) throw new Error('Özet alınamadı, tekrar deneyin.');

      if (typeof data?.balance === 'number') setBalance(data.balance);
      return { ok: true, summary: String(summary) };
    } catch (e) {
      if (mountedRef.current) {
        const errMsg = e instanceof Error ? e.message : 'Bir hata oluştu';
        pushTransient({ id: Date.now().toString(), role: 'error', content: errMsg });
      }
      return { ok: false };
    } finally {
      if (mountedRef.current) setSummarizing(false);
    }
  }

  return { send, summarize, loading, summarizing, streamingReply, insufficientCredits };
}
