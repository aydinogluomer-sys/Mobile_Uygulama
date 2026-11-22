/**
 * The coach may now return a structured suggestion, and that must cost the
 * user nothing extra and take nothing away.
 *
 * Three properties are being protected here, all of which are structural and
 * therefore answerable from source (the function itself is Deno plus a live
 * Anthropic key, so these tests read it rather than invoke it — the same
 * approach as the other edge tests in this directory):
 *
 *   ONE CALL      the action block rides along with the prose in the SAME
 *                 Anthropic request. A second call to "extract intent" would
 *                 double the provider cost of a 5 FP message.
 *   SAME PRICE    coach stays 5 FP and routine stays 25. Asking for structure
 *                 is not a new product tier.
 *   NO LOSS       a malformed, truncated or absent block yields an empty
 *                 action list and the prose survives. The user paid for the
 *                 reply; a bad suggestion must not consume it.
 */
import { edgeSource } from '../helpers/edgeSource';

const SRC = edgeSource('generate-routine');

describe('coach action block — billing is untouched', () => {
  it('coach still costs 5 and routine still costs 25', () => {
    expect(SRC).toMatch(/COST\s*=\s*\{[^}]*coach:\s*5/);
    expect(SRC).toMatch(/COST\s*=\s*\{[^}]*routine:\s*25/);
  });

  it('there is still exactly one Anthropic call in the coach branch', () => {
    // The whole point of emitting prose and structure together. Counting
    // `messages.create` per mode is crude but it is precisely the thing that
    // would regress if someone "just added an extraction call".
    const coachBranch = SRC.slice(SRC.indexOf("if (mode === 'coach')", SRC.indexOf('const callAi')));
    const untilNextMode = coachBranch.slice(0, coachBranch.indexOf("else if (mode === 'summarize')"));
    const calls = untilNextMode.match(/client\.messages\.create\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('the request is still keyed for idempotent replay', () => {
    expect(SRC).toContain('request_id');
    expect(SRC).toMatch(/runIdempotentAiRequest/);
  });
});

describe('coach action block — the reply survives a bad block', () => {
  it('a splitter exists and is the only thing that reads the markers', () => {
    expect(SRC).toContain('function splitCoachActions');
    expect(SRC).toContain('[[ACTIONS]]');
    expect(SRC).toContain('[[/ACTIONS]]');
  });

  it('a missing block returns the prose and no actions', () => {
    const fn = SRC.slice(SRC.indexOf('function splitCoachActions'));
    expect(fn).toMatch(/indexOf\('\[\[ACTIONS\]\]'\)[\s\S]{0,120}return \{ reply: raw\.trim\(\), actions: \[\] \}/);
  });

  it('a truncated block (no closing marker) keeps the prose', () => {
    // This is the max_tokens case: the model ran out mid-JSON. Parsing a
    // fragment would be worse than dropping it.
    const fn = SRC.slice(SRC.indexOf('function splitCoachActions'));
    expect(fn).toMatch(/end === -1[\s\S]{0,80}return \{ reply, actions: \[\] \}/);
  });

  it('a JSON error is caught rather than thrown', () => {
    const fn = SRC.slice(SRC.indexOf('function splitCoachActions'));
    expect(fn).toMatch(/catch[\s\S]{0,80}return \{ reply, actions: \[\] \}/);
  });

  it('a non-array payload yields no actions', () => {
    const fn = SRC.slice(SRC.indexOf('function splitCoachActions'));
    expect(fn).toContain('Array.isArray(actions) ? actions : []');
  });

  it('an empty reply is still a provider failure, so the charge is refunded', () => {
    // Unchanged from before actions existed: no prose means the user got
    // nothing, which is the refund path, not a silent empty bubble.
    expect(SRC).toMatch(/if \(!reply\)[\s\S]{0,160}ai_empty_response/);
  });
});

describe('coach action block — the contract asked of the model', () => {
  it('an actionable request may NOT degrade into prose', () => {
    // This assertion is the inverse of the one it replaces. The prompt used to
    // say the action block was "İSTEĞE BAĞLIDIR" (optional), and on a real
    // device that is exactly what happened: "her gün 20 dakika kitap okuma
    // alışkanlığı eklemek istiyorum" came back as encouraging prose with
    // nothing to tap. Optional was the defect.
    expect(SRC).not.toMatch(/İSTEĞE BAĞLIDIR/);
    expect(SRC).toMatch(/SESSİZCE sadece metne dönüşmemeli/);
    expect(SRC).toMatch(/TAM OLARAK BİR/);
  });

  it('ordinary chat is still explicitly action-free', () => {
    // The other half of determinism: "motivasyonum düşük" must not manufacture
    // a habit nobody asked for.
    expect(SRC).toMatch(/Sıradan sohbet[\s\S]{0,120}actions: \[\]/);
  });

  it('one action at a time', () => {
    expect(SRC).toMatch(/Aynı anda birden fazla eylem üretme/);
    expect(SRC).toMatch(/maxItems: 1/);
  });

  it('only the three supported action types are described', () => {
    expect(SRC).toContain('propose_habit');
    expect(SRC).toContain('propose_habit_plan');
    expect(SRC).toContain('log_habit');
    // Nothing destructive is offered as a possibility.
    expect(SRC).not.toContain('delete_habit');
    expect(SRC).not.toContain('archive_habit');
  });

  it('the model is told it may not supply authority', () => {
    expect(SRC).toMatch(/ASLA user_id, habit_id, xp, cost, balance/);
  });

  it('the model is told not to compute completion or XP', () => {
    // The habit domain engine owns that. An LLM-supplied XP number is the
    // exact thing the app must never believe.
    expect(SRC).toMatch(/XP'sini veya yüzdesini SEN hesaplama/);
  });

  it('the model is told the block is only a proposal', () => {
    // Prose saying "kaydettim" beside a button saying "onayla" is how a user
    // ends up believing something was written when it was not.
    expect(SRC).toMatch(/Kullanıcı onaylamadan hiçbir şey kaydedilmez/);
  });

  it('the coach token budget leaves room for the block', () => {
    // 400 was a prose-only budget; a block would truncate inside the JSON.
    expect(SRC).toMatch(/COACH_MAX_TOKENS\s*=\s*900/);
    expect(SRC).toMatch(/max_tokens:\s*COACH_MAX_TOKENS/);
  });
});
