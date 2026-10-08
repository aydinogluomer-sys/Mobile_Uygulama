/**
 * R09.05 — "Günlük bağlamı ayrıca kullanıcı kontrolünde olsun." Journal text
 * goes to the model ONLY from the journal-insight screen, where the user picks
 * the records. The coach turn's context carries habit names, counts and the
 * deterministic analytics summary -- no journal content.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const code = (p: string) => stripComments(readFileSync(join(__dirname, '..', '..', p), 'utf8'));

it('the coach request context has exactly the known, journal-free keys', () => {
  const src = code('app/screens/ai-coach.tsx');
  const ctx = /context: \{([\s\S]*?)\n {16}\},\n/.exec(src)![1];
  const keys = [...ctx.matchAll(/^ {18}([a-zA-Z]+)[:,]/gm)].map((m) => m[1]);
  expect(keys).toEqual(['activeHabits', 'pendingTaskCount', 'habitCount', 'willpower', 'analytics']);
  expect(src).not.toMatch(/useJournalStore\(\(s\) => s\.entries\)/);
});

it('the only screen that sends journal entries builds them through the user-controlled prompt', () => {
  const src = code('app/screens/journal-insights.tsx');
  expect(src).toMatch(/const \{ text, used \} = prompt;/);
  expect(src).toMatch(/insightPrompt\(periodEntries, excluded\)/);
  expect(src).not.toMatch(/periodEntries\]?\s*\.sort\(/);
});
