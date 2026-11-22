import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

export type TimerSnapshot = {
  running: boolean;
  secondsLeft: number;
  phaseKey: string;
  phaseLabel: string;
};

export type AnnouncementState = {
  phaseKey: string | null;
  minuteMark: number | null;
  wasRunning: boolean;
};

function minuteMarkOf(secondsLeft: number): number {
  return Math.ceil(Math.max(0, secondsLeft) / 60);
}

export function spokenDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  if (mins > 0 && secs > 0) return `${mins} dakika ${secs} saniye`;
  if (mins > 0) return `${mins} dakika`;
  return `${secs} saniye`;
}

export function initialAnnouncementState(s: TimerSnapshot): AnnouncementState {
  return {
    phaseKey: s.phaseKey,
    minuteMark: minuteMarkOf(s.secondsLeft),
    wasRunning: s.running,
  };
}

export function nextAnnouncement(
  prev: AnnouncementState,
  cur: TimerSnapshot,
): { text: string | null; state: AnnouncementState } {
  const curMark = minuteMarkOf(cur.secondsLeft);
  const nextState: AnnouncementState = {
    phaseKey: cur.phaseKey,
    minuteMark: curMark,
    wasRunning: cur.running,
  };

  if (prev.phaseKey === null) {
    return { text: null, state: nextState };
  }

  if (cur.phaseKey !== prev.phaseKey) {
    if (!cur.running && !prev.wasRunning) {
      return { text: null, state: nextState };
    }
    return {
      text: `${cur.phaseLabel} başladı. ${spokenDuration(cur.secondsLeft)}`,
      state: nextState,
    };
  }

  if (prev.wasRunning && !cur.running) {
    return { text: 'Duraklatıldı', state: nextState };
  }

  if (!prev.wasRunning && cur.running) {
    return {
      text: `Devam ediyor, ${spokenDuration(cur.secondsLeft)} kaldı`,
      state: nextState,
    };
  }

  if (cur.running && prev.minuteMark !== null && curMark < prev.minuteMark && cur.secondsLeft > 0) {
    return {
      text: `${curMark} dakika kaldı`,
      state: nextState,
    };
  }

  return { text: null, state: nextState };
}

export function useTimerAnnouncements(
  s: TimerSnapshot,
  announce: (text: string) => void = (t) => {
    AccessibilityInfo.announceForAccessibility(t);
  },
): void {
  const stateRef = useRef<AnnouncementState | null>(null);
  const { running, secondsLeft, phaseKey, phaseLabel } = s;

  useEffect(() => {
    const snap: TimerSnapshot = { running, secondsLeft, phaseKey, phaseLabel };
    if (stateRef.current === null) {
      stateRef.current = initialAnnouncementState(snap);
      return;
    }
    const { text, state } = nextAnnouncement(stateRef.current, snap);
    stateRef.current = state;
    if (text) {
      announce(text);
    }
  }, [running, secondsLeft, phaseKey, phaseLabel, announce]);
}
