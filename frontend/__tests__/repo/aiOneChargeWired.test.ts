/**
 * R09.06 — every paid AI call site keeps an unanswered attempt's request id
 * for the resend and closes it only on a server answer. The routine store and
 * the journal-insight screen are covered behaviourally
 * (store/routineGenerateOneCharge, ui/journalInsightsContext); the coach
 * hook's two calls (`hooks/useCoachSend.ts`, extracted in F21) are pinned here structurally.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const code = (p: string) => stripComments(readFileSync(join(__dirname, '..', '..', p), 'utf8'));

describe('coach screen / useCoachSend hook', () => {
  const src = code('hooks/useCoachSend.ts');
  const send = src.slice(src.indexOf('async function send('), src.indexOf('async function summarize('));
  const summStart = src.indexOf('async function summarize(');
  const summ = src.slice(summStart, src.indexOf('\n  return {', summStart));

  it('a message: the id comes from the keeper keyed by thread + text; no-answer is rethrown before the attempt is closed', () => {
    expect(send).toMatch(/const requestId = coachAttempt\.begin\(`\$\{activeId \?\? ''\}\|\$\{msg\}`\);/);
    expect(send).not.toMatch(/newRequestId\(\)/);
    const noAns = send.indexOf('if (error && isNoAnswer(error)) throw new Error(NO_ANSWER_NOTE);');
    const close = send.indexOf('coachAttempt.answered();');
    expect(noAns).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(noAns);
    expect(send.indexOf('extractInvokeError(error)')).toBeGreaterThan(close);
  });
  it('a summary: same rule, keyed by the transcript', () => {
    expect(summ).toMatch(/const requestId = summaryAttempt\.begin\(transcript\);/);
    expect(summ).not.toMatch(/newRequestId\(\)/);
    const noAns = summ.indexOf('if (error && isNoAnswer(error)) throw new Error(NO_ANSWER_NOTE);');
    expect(noAns).toBeGreaterThan(-1);
    expect(summ.indexOf('summaryAttempt.answered();')).toBeGreaterThan(noAns);
  });
  it('F07: a message waits out REQUEST_IN_PROGRESS and rebinds its attempt; the stillInProgress branch comes before answered()', () => {
    expect(send).toContain('retryWhileInProgress(');
    expect(send).toContain('coachAttempt.rebind(');
    const still = send.indexOf('outcome.stillInProgress');
    expect(still).toBeGreaterThan(-1);
    expect(still).toBeLessThan(send.indexOf('coachAttempt.answered();'));
  });
  it('F07: a summary the same way', () => {
    expect(summ).toContain('retryWhileInProgress(');
    const still = summ.indexOf('outcome.stillInProgress');
    expect(still).toBeGreaterThan(-1);
    expect(still).toBeLessThan(summ.indexOf('summaryAttempt.answered();'));
  });
  it('the keepers live outside the hook (they survive a re-render)', () => {
    const hookFn = src.indexOf('export function useCoachSend');
    expect(src.indexOf('const coachAttempt = createAttemptKeeper(newRequestId);')).toBeLessThan(hookFn);
    expect(src.indexOf('const summaryAttempt = createAttemptKeeper(newRequestId);')).toBeLessThan(hookFn);
  });
});
