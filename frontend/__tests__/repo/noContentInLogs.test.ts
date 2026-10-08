/**
 * R06.05 — "Günlük ve AI metnini hata loglarında gösterme."
 *
 * Two halves: (1) the journal and coach code paths never hand user text to a
 * log or the crash funnel; (2) the funnel itself strips a quoted value, which
 * is how any future error message carrying text must present it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildCrashReport, scrubMessage } from '../../lib/crashReporting';

const ROOT = path.join(__dirname, '../..');
const FILES = [
  'repositories/journalRepository.ts', 'repositories/journalInsightRepository.ts', 'repositories/aiConversationRepository.ts',
  'services/journalService.ts', 'services/aiCoachService.ts', 'store/journalStore.ts', 'store/aiConversationStore.ts',
  'app/screens/journal.tsx', 'app/screens/journal-archive.tsx', 'app/screens/journal-reader.tsx', 'app/screens/journal-insights.tsx',
  'app/screens/ai-coach.tsx', 'components/coach/CoachActionCard.tsx', 'components/coach/CoachActionCardV2.tsx',
  'components/coach/ConversationSheet.tsx', 'lib/journalText.ts', 'lib/coachActions.ts', 'lib/coachActionsV2.ts',
];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

it('every listed file exists (the guard is not vacuous)', () => {
  for (const f of FILES) expect([f, fs.existsSync(path.join(ROOT, f))]).toEqual([f, true]);
});

it('journal and coach code never writes to the console', () => {
  const offenders = FILES.filter((f) => /\bconsole\.(log|warn|error|info|debug)\(/.test(strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
  expect(offenders).toEqual([]);
});

it('nor builds an error message out of the text it holds', () => {
  const TEXTY = /(throw new Error|reportError)\([^)]*\$\{[^}]*(content|text|message|body|note|title|summary)\b/;
  const offenders = FILES.filter((f) => TEXTY.test(strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
  expect(offenders).toEqual([]);
});

it('the core outbox conflict for a journal day carries no journal text', () => {
  const src = fs.readFileSync(path.join(ROOT, 'services/coreOutbox.ts'), 'utf8');
  expect(src).toMatch(/kind: 'conflict', error: 'Bu günün kaydı başka bir yerde değiştirilmiş\.'/);
});

it('the crash funnel strips a quoted journal sentence and keeps the diagnostic spine', () => {
  const r = scrubMessage('upsert failed for "Bugün annemle kavga ettim" (23514)');
  expect(r.text).toBe('upsert failed for [redacted] (23514)');
  expect(r.redacted).toBe(true);
  const report = buildCrashReport(new Error('coach reply rejected: "seni anlıyorum, zor bir gün"'), 'manual');
  expect(JSON.stringify(report)).not.toMatch(/zor bir gün/);
});
