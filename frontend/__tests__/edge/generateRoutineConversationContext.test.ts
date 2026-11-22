/**
 * The coach now remembers — and remembering is exactly where a chat feature
 * leaks.
 *
 * Sending prior turns to the model is what makes "bunu haftada üçe çıkaralım"
 * mean anything. It is also the moment a coach can start answering thread B
 * with thread A's contents, or worse, with someone else's. These tests fix the
 * three properties that keep that from happening. They read the function's
 * source rather than invoking it, for the same reason as every other test in
 * this directory: it is Deno plus a live Anthropic key.
 *
 *   ONE THREAD   history is selected BY `conversation_id`, and the thread is
 *                verified as the caller's before a single message is read.
 *   ONE USER     the read goes through the CALLER'S client, so RLS is a second
 *                barrier behind the explicit `user_id` filter — a bug in this
 *                function still cannot return another person's messages.
 *   BOUNDED      the context is capped by BOTH a message count and a character
 *                budget, dropping from the old end. No summary call is made,
 *                because a second provider call on a 5 FP message is a cost
 *                the user never agreed to.
 */
import { edgeSource } from '../helpers/edgeSource';

const SRC = edgeSource('generate-routine');

/** The body of `loadCoachHistory`, which is where all three rules live. */
const LOADER = (() => {
  const start = SRC.indexOf('async function loadCoachHistory');
  expect(start).toBeGreaterThan(-1);
  return SRC.slice(start, SRC.indexOf('\nconst PERIOD_LABEL', start));
})();

/** The coach branch of the request handler. */
const COACH_BRANCH = (() => {
  const start = SRC.indexOf("if (mode === 'coach')", SRC.indexOf('const callAi'));
  return SRC.slice(start, SRC.indexOf("else if (mode === 'summarize')", start));
})();

describe('history belongs to one conversation', () => {
  it('messages are selected by conversation_id', () => {
    expect(LOADER).toContain(".eq('conversation_id', conversationId)");
  });

  it('the conversation is verified as the caller’s BEFORE any message is read', () => {
    const ownership = LOADER.indexOf("from('ai_conversations')");
    const messages = LOADER.indexOf("from('ai_messages')");
    expect(ownership).toBeGreaterThan(-1);
    expect(messages).toBeGreaterThan(ownership);
    // And the ownership check must be a hard stop, not a warning.
    expect(LOADER.slice(ownership, messages)).toMatch(/if \(!conv\) return null;/);
  });

  it('an unowned or forged conversation id ends the request instead of falling back', () => {
    // `null` means "not yours". Answering anyway with an empty history would
    // silently start a second, invisible thread under a foreign id.
    expect(COACH_BRANCH).toMatch(/history === null[\s\S]{0,160}conversation_not_found/);
  });

  it('a request with no conversation id gets no history at all', () => {
    expect(COACH_BRANCH).toMatch(/const conversationId = typeof body\?\.conversation_id === 'string'/);
    expect(COACH_BRANCH).toMatch(/conversationId\s*\n?\s*\?\s*await loadCoachHistory\([\s\S]{0,80}:\s*\[\]/);
  });
});

describe('history belongs to one user', () => {
  it('both reads carry the explicit owner filter', () => {
    const filters = LOADER.match(/\.eq\('user_id', userId\)/g) ?? [];
    expect(filters).toHaveLength(2);
  });

  it('the read goes through the caller’s client, not the service-role one', () => {
    // `supabase` is built from the request's Authorization header; `admin`
    // holds the service-role key and bypasses RLS. Passing `admin` here would
    // make the explicit user_id filter the ONLY thing between two users.
    expect(COACH_BRANCH).toMatch(/loadCoachHistory\(\s*supabase\s*,/);
    expect(COACH_BRANCH).not.toMatch(/loadCoachHistory\(\s*admin\s*,/);
  });

  it('the caller never supplies the user id', () => {
    // It comes from the verified session, the same place every other write in
    // this function gets it.
    expect(COACH_BRANCH).toMatch(/loadCoachHistory\(supabase, conversationId, user\.id,/);
    expect(LOADER).not.toMatch(/body\?\.user_id|body\.user_id/);
  });
});

describe('the context is bounded, and says so', () => {
  it('there is both a message cap and a character budget', () => {
    expect(SRC).toMatch(/const COACH_HISTORY_MESSAGES = (\d+);/);
    expect(SRC).toMatch(/const COACH_HISTORY_CHARS = (\d+);/);
    const messages = Number(/const COACH_HISTORY_MESSAGES = (\d+);/.exec(SRC)![1]);
    const chars = Number(/const COACH_HISTORY_CHARS = (\d+);/.exec(SRC)![1]);
    // Either cap alone is escapable: 16 long essays blow a token budget, and
    // a character budget alone permits hundreds of one-word turns.
    expect(messages).toBeGreaterThan(0);
    expect(messages).toBeLessThanOrEqual(40);
    expect(chars).toBeGreaterThan(0);
    expect(chars).toBeLessThanOrEqual(20000);
  });

  it('both caps are actually applied to the rows that were read', () => {
    expect(LOADER).toContain('.limit(COACH_HISTORY_MESSAGES + 4)');
    expect(LOADER).toContain('.slice(0, COACH_HISTORY_MESSAGES)');
    expect(LOADER).toContain('let budget = COACH_HISTORY_CHARS;');
  });

  it('the OLD end is what gets dropped', () => {
    // Read newest-first, spend the budget, then restore chronological order.
    expect(LOADER).toContain("order('created_at', { ascending: false })");
    expect(LOADER).toMatch(/if \(cost > budget\) break;/);
    expect(LOADER).toMatch(/return kept\.reverse\(\);/);
  });

  it('the current turn is not counted twice', () => {
    // The client persists the user message before invoking, so it is already
    // in this query's result and is excluded by request_id.
    expect(LOADER).toMatch(/filter\(\(m\) => m\.request_id !== excludeRequestId\)/);
  });

  it('remembering did not add a second provider call', () => {
    const calls = COACH_BRANCH.match(/client\.messages\.create\(/g) ?? [];
    expect(calls).toHaveLength(1);
    // No rolling-summary call hiding elsewhere in the branch either.
    expect(COACH_BRANCH).not.toMatch(/summar/i);
  });

  it('history is sent as prior turns, ahead of the current one', () => {
    // Not concatenated into the prompt string: the model has to be able to
    // tell what was said from what is true in the app right now.
    expect(COACH_BRANCH).toMatch(/\.\.\.\(history \?\? \[\]\),[\s\S]{0,200}role: 'user', content: `Bağlam:/);
  });
});
