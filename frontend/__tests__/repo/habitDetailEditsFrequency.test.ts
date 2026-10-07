/**
 * KD-09 — habit-detail shows and edits the schedule through the shared pieces.
 *
 * Source-text invariant (same instrument as `habitFormFrequency.test.ts`):
 * the screen must use `frequencySummary` (not a private kind-based label), the
 * shared `FrequencyEditor` (not a second copy of the controls), and must save
 * through `frequencyEditPatch` behind the same `isFrequencyComplete` gate the
 * creation form uses.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const src = stripComments(readFileSync(join(__dirname, '..', '..', 'app/screens/habit-detail.tsx'), 'utf8'));

describe('KD-09 — habit-detail schedule', () => {
  it('shows frequencySummary, and the private kind-based label is gone', () => {
    expect(src).toMatch(/value=\{frequencySummary\(habit\.frequency_config\)\}/);
    expect(src).not.toMatch(/function scheduleLabel\(/);
  });

  it('edits with the shared FrequencyEditor, not a copy of its controls', () => {
    expect(src).toMatch(/<FrequencyEditor value=\{freqDraft\} onChange=\{setFreqDraft\} \/>/);
    expect(src).not.toMatch(/setFrequencyKind\(|toggleWeekday\(|setIntervalDays\(/);
  });

  it('saves through frequencyEditPatch, and only a complete schedule', () => {
    expect(src).toMatch(/await updateHabit\(habit\.id, frequencyEditPatch\(habit, freqDraft\)\);/);
    expect(src).toMatch(/if \(!habit \|\| !freqDraft \|\| !isFrequencyComplete\(freqDraft\)\) return;/);
    expect(src).toMatch(/disabled=\{!freqDraft \|\| !isFrequencyComplete\(freqDraft\) \|\| savingFreq\}/);
  });

  it('the edit control is a labelled button', () => {
    expect(src).toMatch(/editLabel="Sıklığı düzenle"/);
    expect(src).toMatch(/accessibilityLabel=\{editLabel \?\? `\$\{label\} düzenle`\}/);
  });
});
