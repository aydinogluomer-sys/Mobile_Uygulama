/**
 * F34 (PRF-24, INT-19/4) — Single-interval clock context for the routine runner.
 *
 * Isolates the 1-second tick so `RoutineRunnerScreen` (including
 * `AtmosphericScreenCanvas`, step list, and controls) does NOT re-render every
 * second while a session runs; only the three time-dependent leaves
 * (`RunnerTimerText`, `RunnerEtaText`, `RunnerTimeUp`) update.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { spokenDuration } from '../../hooks/useTimerAnnouncements';
import {
  computeRunnerClock,
  currentStep,
  etaLabel,
  formatMmSs,
  type RoutineSession,
  type RunnerClockView,
} from '../../lib/routineRunner';

export type RunnerClockProps = {
  session: RoutineSession;
  running: boolean;
  children: React.ReactNode;
};

type InternalClockContext = {
  view: RunnerClockView;
  paused: boolean;
  stepId: string | null;
  stepTitle: string | null;
};

const ClockContext = createContext<InternalClockContext | null>(null);

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [active]);

  return now;
}

function useInternalRunnerClock(): InternalClockContext {
  const ctx = useContext(ClockContext);
  if (!ctx) {
    throw new Error('useRunnerClock must be used within <RunnerClock>');
  }
  return ctx;
}

export function RunnerClock({ session, running, children }: RunnerClockProps): React.JSX.Element {
  const now = useNow(running);
  const step = currentStep(session);
  const stepId = step?.id ?? null;
  const stepTitle = step?.title ?? null;
  const paused = session.status === 'paused';

  const value = useMemo<InternalClockContext>(
    () => ({
      view: computeRunnerClock(session, now),
      paused,
      stepId,
      stepTitle,
    }),
    [session, now, paused, stepId, stepTitle],
  );

  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

export function useRunnerClock(): RunnerClockView {
  return useInternalRunnerClock().view;
}

export function RunnerTimerText(props: {
  style?: StyleProp<TextStyle>;
  warnStyle?: StyleProp<TextStyle>;
}): React.JSX.Element {
  const { view, stepTitle } = useInternalRunnerClock();
  const displayMs = view.remainingMs !== null ? view.remainingMs : view.elapsedMs;
  const secs = Math.max(0, Math.ceil(displayMs / 1000));
  const label = stepTitle
    ? `${stepTitle}, ${spokenDuration(secs)} ${view.remainingMs !== null ? 'kaldı' : 'geçti'}`
    : formatMmSs(displayMs);

  return (
    <Text
      style={[props.style, view.timeUp ? props.warnStyle : null]}
      accessibilityRole="timer"
      accessibilityLabel={label}
    >
      {formatMmSs(displayMs)}
    </Text>
  );
}

export function RunnerEtaText(props: { style?: StyleProp<TextStyle> }): React.JSX.Element {
  const { view, paused } = useInternalRunnerClock();
  return <Text style={props.style}>{etaLabel(view.eta, { paused })}</Text>;
}

export function RunnerTimeUp(props: {
  children: React.ReactNode;
  onTimeUp?: () => void;
}): React.JSX.Element | null {
  const { view, stepId } = useInternalRunnerClock();
  const firedStepRef = useRef<string | null>(null);
  const onTimeUpRef = useRef(props.onTimeUp);
  onTimeUpRef.current = props.onTimeUp;

  useEffect(() => {
    if (view.timeUp && stepId && firedStepRef.current !== stepId) {
      firedStepRef.current = stepId;
      onTimeUpRef.current?.();
    }
  }, [view.timeUp, stepId]);

  if (!view.timeUp) return null;
  return <View accessibilityLiveRegion="polite">{props.children}</View>;
}
