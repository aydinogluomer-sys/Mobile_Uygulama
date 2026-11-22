/**
 * R03.07 — "Akış içinde kısa açıklamalar yaz: 'ilk adımı seç', 'yükü
 * hafiflet', 'mola sonrası dön'. Metinler klinik iddia taşımaz, ayrı içerik
 * platformu gerektirmez; mevcut dil/erişilebilirlik sistemini kullanır."
 */
import * as fs from 'fs';
import * as path from 'path';
import { FLOW_COPY, recentlyEndedBreak, isBackFromFocusBreak } from '../../lib/flowCopy';
import type { PauseInterval } from '../../lib/habitPauses';

const p = (start: string, end: string | null, habit: string | null = null): PauseInterval =>
  ({ id: `${start}-${end}`, habit_id: habit, kind: habit ? 'pause' : 'holiday', start_date: start, end_date: end } as PauseInterval);

describe('the copy', () => {
  const CLINICAL = /tedavi|terapi|teşhis|tanı\b|klinik|depresyon|anksiyete|DEHB|ADHD|bozukluk|iyileştir|şifa|ilaç/i;
  it('three short explanations, none making a clinical claim', () => {
    for (const t of Object.values(FLOW_COPY)) {
      expect(t).not.toMatch(CLINICAL);
      expect(t.length).toBeLessThanOrEqual(220);
    }
  });
  it('is the ONE source the flows render (no second copy in the screens)', () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    expect(read('components/SmallStartSheet.tsx')).toMatch(/\{FLOW_COPY\.firstStep\}/);
    expect(read('app/tabs/today.tsx')).toMatch(/\{FLOW_COPY\.lighten\}/);
    expect(read('app/tabs/today.tsx')).toMatch(/\{FLOW_COPY\.afterBreak\}/);
    expect(read('app/tabs/focus.tsx')).toMatch(/\{FLOW_COPY\.afterFocusBreak\}/);
    expect(read('components/focus/FocusIntentSheet.tsx')).toMatch(/\{FLOW_COPY\.intentAsk\}/);
    expect(read('components/focus/InterruptionPrompt.tsx')).toMatch(/\{FLOW_COPY\.interruptionAsk\}/);
    expect(read('components/focusFlow/FlowClosurePage.tsx')).toMatch(/\{FLOW_COPY\.flowDailyDoneTitle\}/);
    expect(read('components/focusFlow/FlowClosurePage.tsx')).toMatch(/\{FLOW_COPY\.flowDailyTry\}/);
    expect(read('app/tabs/today.tsx')).not.toMatch(/Bugün kenara koyacaklarını seç\./);
    expect(read('components/focus/FocusIntentSheet.tsx')).not.toMatch(/Bu oturumda ne bitmiş olsun\?/);
    expect(read('components/focus/InterruptionPrompt.tsx')).not.toMatch(/Uygulamadan ayrılmıştın\. Ne oldu\?/);
    expect(read('components/focusFlow/FlowClosurePage.tsx')).not.toMatch(/Bugünlük yeterli/);
  });
});

describe('"mola sonrası dön" — when it shows', () => {
  it('the day after a holiday, and the day after that; not on the third', () => {
    const hol = [p('2026-10-01', '2026-10-05')];
    expect(recentlyEndedBreak(hol, '2026-10-06')?.end_date).toBe('2026-10-05');
    expect(recentlyEndedBreak(hol, '2026-10-07')?.end_date).toBe('2026-10-05');
    expect(recentlyEndedBreak(hol, '2026-10-08')).toBeNull();
  });
  it('not while a break is still running, and not for an open-ended one', () => {
    expect(recentlyEndedBreak([p('2026-10-01', '2026-10-05'), p('2026-10-06', null)], '2026-10-06')).toBeNull();
    expect(recentlyEndedBreak([p('2026-10-01', null)], '2026-10-06')).toBeNull();
    expect(recentlyEndedBreak([p('2026-10-01', '2026-10-06')], '2026-10-06')).toBeNull(); // last day of the break is still the break
  });
  it('picks the most recently ended one', () => {
    expect(recentlyEndedBreak([p('2026-10-01', '2026-10-04'), p('2026-10-02', '2026-10-05', 'h1')], '2026-10-06')?.habit_id).toBe('h1');
  });
  it('focus: back on work after a finished pomodoro, not yet started', () => {
    expect(isBackFromFocusBreak({ phase: 'work', status: 'idle', sessionsCompleted: 1 })).toBe(true);
    expect(isBackFromFocusBreak({ phase: 'work', status: 'idle', sessionsCompleted: 0 })).toBe(false);
    expect(isBackFromFocusBreak({ phase: 'work', status: 'running', sessionsCompleted: 2 })).toBe(false);
    expect(isBackFromFocusBreak({ phase: 'shortBreak', status: 'idle', sessionsCompleted: 2 })).toBe(false);
  });
});
