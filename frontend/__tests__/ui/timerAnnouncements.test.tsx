import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import TestRenderer, { act } from 'react-test-renderer';
import {
  initialAnnouncementState,
  nextAnnouncement,
  spokenDuration,
  useTimerAnnouncements,
  type TimerSnapshot,
} from '../../hooks/useTimerAnnouncements';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
jest.setTimeout(30_000);

function Harness({ snapshot, announce }: { snapshot: TimerSnapshot; announce: (t: string) => void }) {
  useTimerAnnouncements(snapshot, announce);
  return null;
}

describe('F26 (DSA-04, DSA-09) — timer announcements and spoken durations', () => {
  it('(+) spokenDuration formats minutes and seconds in Turkish', () => {
    expect(spokenDuration(303)).toBe('5 dakika 3 saniye');
    expect(spokenDuration(45)).toBe('45 saniye');
    expect(spokenDuration(60)).toBe('1 dakika');
    expect(spokenDuration(1500)).toBe('25 dakika');
    expect(spokenDuration(0)).toBe('0 saniye');
    expect(spokenDuration(-5)).toBe('0 saniye');
  });

  it('(+) initialAnnouncementState stays silent on mount, announces once per elapsed minute, and handles phase/pause/resume/background jumps', () => {
    const startSnap: TimerSnapshot = {
      running: true,
      secondsLeft: 1500,
      phaseKey: 'work',
      phaseLabel: 'Odak',
    };
    let st = initialAnnouncementState(startSnap);

    // Same snapshot right after mount -> silent
    let step = nextAnnouncement(st, startSnap);
    expect(step.text).toBeNull();
    st = step.state;

    // 1499..1441 -> still minuteMark 25 -> silent
    for (const s of [1499, 1470, 1441]) {
      step = nextAnnouncement(st, { ...startSnap, secondsLeft: s });
      expect(step.text).toBeNull();
      st = step.state;
    }

    // 1440 -> minuteMark drops 25 -> 24 -> "24 dakika kaldı"
    step = nextAnnouncement(st, { ...startSnap, secondsLeft: 1440 });
    expect(step.text).toBe('24 dakika kaldı');
    st = step.state;

    // 1439..1381 -> silent within that minute
    for (const s of [1439, 1410, 1381]) {
      step = nextAnnouncement(st, { ...startSnap, secondsLeft: s });
      expect(step.text).toBeNull();
      st = step.state;
    }

    // Background jump 1440 -> 1100 (ceil(1100/60) = 19) -> single announcement
    step = nextAnnouncement(st, { ...startSnap, secondsLeft: 1100 });
    expect(step.text).toBe('19 dakika kaldı');
    st = step.state;

    // Pause -> "Duraklatıldı"
    step = nextAnnouncement(st, { ...startSnap, running: false, secondsLeft: 180 });
    expect(step.text).toBe('Duraklatıldı');
    st = step.state;

    // Resume same phase -> "Devam ediyor, 3 dakika kaldı"
    step = nextAnnouncement(st, { ...startSnap, running: true, secondsLeft: 180 });
    expect(step.text).toBe('Devam ediyor, 3 dakika kaldı');
    st = step.state;

    // Phase change -> "{phaseLabel} başladı. {spokenDuration}"
    step = nextAnnouncement(st, {
      running: true,
      secondsLeft: 300,
      phaseKey: 'shortBreak',
      phaseLabel: 'Kısa mola',
    });
    expect(step.text).toBe('Kısa mola başladı. 5 dakika');
  });

  it('(+) useTimerAnnouncements hook emits announcements only on minute boundaries and state transitions', async () => {
    const announce = jest.fn<void, [string]>();
    let tree!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <Harness
          snapshot={{ running: true, secondsLeft: 125, phaseKey: 'work', phaseLabel: 'Odak' }}
          announce={announce}
        />,
      );
    });
    expect(announce).not.toHaveBeenCalled();

    // 124..121 silent (ceil = 3)
    for (const sec of [124, 122, 121]) {
      await act(async () => {
        tree.update(
          <Harness
            snapshot={{ running: true, secondsLeft: sec, phaseKey: 'work', phaseLabel: 'Odak' }}
            announce={announce}
          />,
        );
      });
    }
    expect(announce).not.toHaveBeenCalled();

    // 120 -> ceil drops 3 -> 2 -> "2 dakika kaldı"
    await act(async () => {
      tree.update(
        <Harness
          snapshot={{ running: true, secondsLeft: 120, phaseKey: 'work', phaseLabel: 'Odak' }}
          announce={announce}
        />,
      );
    });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('2 dakika kaldı');

    await act(async () => {
      tree.unmount();
    });
  });

  it('(-) never announces while idle/paused, never announces per-second in final minute, and preserves routine-runner S13 contract', () => {
    const idleSnap: TimerSnapshot = {
      running: false,
      secondsLeft: 1500,
      phaseKey: 'work',
      phaseLabel: 'Odak',
    };
    let st = initialAnnouncementState(idleSnap);
    for (const s of [1440, 1200, 600]) {
      const res = nextAnnouncement(st, { ...idleSnap, secondsLeft: s });
      expect(res.text).toBeNull();
      st = res.state;
    }

    // Final minute: 60 announces "1 dakika kaldı", then 59..0 stay silent
    let runSt = initialAnnouncementState({
      running: true,
      secondsLeft: 61,
      phaseKey: 'work',
      phaseLabel: 'Odak',
    });
    const at60 = nextAnnouncement(runSt, {
      running: true,
      secondsLeft: 60,
      phaseKey: 'work',
      phaseLabel: 'Odak',
    });
    expect(at60.text).toBe('1 dakika kaldı');
    runSt = at60.state;

    for (const s of [59, 30, 10, 1, 0]) {
      const sub = nextAnnouncement(runSt, {
        running: true,
        secondsLeft: s,
        phaseKey: 'work',
        phaseLabel: 'Odak',
      });
      expect(sub.text).toBeNull();
      runSt = sub.state;
    }

    const runnerRaw = readFileSync(join(ROOT, 'app/screens/routine-runner.tsx'), 'utf8');
    const runnerCode = stripComments(runnerRaw);
    expect(runnerRaw).toContain('AccessibilityInfo.announceForAccessibility(`Sıradaki adım: ${step.title}`)');
    expect(runnerCode).not.toMatch(/from ['"]expo-speech['"]|require\(['"]expo-speech['"]\)/);
    expect(runnerCode).toContain('RunningStepAnnouncer');
    expect(runnerRaw).toContain('accessibilityRole="timer"');

    const focusRaw = readFileSync(join(ROOT, 'app/tabs/focus.tsx'), 'utf8');
    expect(focusRaw).toContain('PHASE_SPOKEN');
    expect(focusRaw).toContain('accessibilityRole="timer"');
    expect(focusRaw).toContain('maxFontSizeMultiplier={1.25}');
    expect(focusRaw).toContain('maxFontSizeMultiplier={1.4}');
  });
});
