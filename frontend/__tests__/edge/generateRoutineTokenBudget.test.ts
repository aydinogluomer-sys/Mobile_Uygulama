/**
 * The routine mode must be able to finish its sentence.
 *
 * ## The defect this exists to catch
 *
 * Every mode shared one `MAX_TOKENS = 400`. That is generous for the three
 * modes that return prose — a real coach reply measured 385 characters — and
 * far too small for the one mode that must return a complete JSON document in
 * a single message: up to 4 habits × 7 fields, which the model pretty-prints
 * to roughly 1.4 KB across ~45 lines.
 *
 * So the answer was cut mid-`items`. The extraction regex is greedy:
 *
 *     const match = text.match(/\{[\s\S]*\}/);
 *
 * On truncated text it still matches — from the first `{` to the last `}`
 * that survived, i.e. the closing brace of some nested object inside the
 * unfinished array. The result looks like JSON and is not, so `JSON.parse`
 * threw, the catch block reported "AI servisi şu an yanıt veremedi", and the
 * blame landed on Anthropic. Anthropic was fine. Four consecutive live
 * attempts against v14 on kbcuolhjjnmhjaarxxmu, with four different prompts,
 * failed at the byte-identical offset:
 *
 *     Expected ',' or ']' after array element in JSON
 *     at position  964 (line 40 column 6)
 *     at position  984 (line 40 column 6)
 *     at position  987 (line 40 column 6)
 *     at position 1007 (line 40 column 6)
 *
 * Same line, same column, four different prompts — the signature of a fixed
 * token budget, not of a flaky provider. The user was refunded each time and
 * never received a routine; the feature had never once succeeded end to end.
 *
 * Two things had to change, and this file pins both:
 *
 *   1. the routine mode gets its own, much larger budget, and
 *   2. a truncated response is REFUSED by name rather than scraped, so this
 *      failure can never again be reported as a provider outage.
 *
 * Source-level, like the rest of `__tests__/edge`: the function is Deno plus a
 * live paid key, and the property being protected is structural.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const FN = stripComments(
  readFileSync(
    join(__dirname, '..', '..', '..', 'supabase', 'functions', 'generate-routine', 'index.ts'),
    'utf8',
  ),
);

/** The `else` arm that builds the routine — from its model call to its parse. */
function routineBranch(): string {
  const start = FN.indexOf('system: SYSTEM_PROMPT,');
  const end = FN.indexOf('payload = JSON.parse(');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // Back up to the `client.messages.create({` that owns this call.
  const callStart = FN.lastIndexOf('client.messages.create({', start);
  expect(callStart).toBeGreaterThan(-1);
  return FN.slice(callStart, end);
}

function numericConst(name: string): number {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(FN);
  if (!m) throw new Error(`${name} is not declared in generate-routine`);
  return Number(m[1]);
}

// ---------------------------------------------------------------------------
describe('the routine mode has a budget of its own', () => {
  it('declares ROUTINE_MAX_TOKENS separately from the prose default', () => {
    expect(() => numericConst('ROUTINE_MAX_TOKENS')).not.toThrow();
    expect(numericConst('ROUTINE_MAX_TOKENS')).not.toBe(numericConst('MAX_TOKENS'));
  });

  it('the routine call uses it, and not the shared default', () => {
    const branch = routineBranch();
    expect(branch).toContain('max_tokens: ROUTINE_MAX_TOKENS');
    expect(branch).not.toContain('max_tokens: MAX_TOKENS');
  });

  it('the budget clears the size a real response was measured at', () => {
    // The captured production response is ~1.4 KB. At the conservative ~3
    // characters per token Haiku averages on indented Turkish JSON that is
    // ~470 tokens — already past the old 400, before any headroom. The floor
    // here is 3x the prose default, which the observed failures show is the
    // right order of magnitude rather than a number picked to pass.
    expect(numericConst('ROUTINE_MAX_TOKENS')).toBeGreaterThanOrEqual(3 * numericConst('MAX_TOKENS'));
  });

  it('the prose modes are untouched', () => {
    // The fix must not quietly raise the cost of coach/summarize/insights,
    // which are priced at 5/3/5 FP against a 400/500 budget.
    expect(numericConst('MAX_TOKENS')).toBe(400);
    expect(numericConst('INSIGHTS_MAX_TOKENS')).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('a truncated response is refused, not scraped', () => {
  it('the routine branch checks stop_reason', () => {
    expect(routineBranch()).toContain("stop_reason === 'max_tokens'");
  });

  it('the check runs BEFORE the greedy match and the parse', () => {
    const branch = routineBranch();
    const guard = branch.indexOf("stop_reason === 'max_tokens'");
    const greedy = branch.indexOf('text.match(');
    expect(guard).toBeGreaterThan(-1);
    expect(greedy).toBeGreaterThan(-1);
    // If the guard came after the match, the fragment would already have been
    // extracted and the parse would still be reached on a later edit.
    expect(guard).toBeLessThan(greedy);
  });

  it('it refunds, because the user got nothing', () => {
    const branch = routineBranch();
    const guard = branch.indexOf("stop_reason === 'max_tokens'");
    const tail = branch.slice(guard, guard + 400);
    expect(tail).toMatch(/await refund\('ai_truncated'\)/);
    // And says what happened, rather than blaming the provider.
    expect(tail).toContain('yarım kaldı');
    expect(tail).not.toContain('AI servisi şu an yanıt veremedi');
  });

  it('every paid exit from the routine branch still refunds', () => {
    // The guard is a new way out of a branch that has already charged. A
    // return that forgets the refund is the one mistake this whole area of
    // the function exists to prevent.
    const branch = routineBranch();
    const returns = branch.match(/return json\(/g) ?? [];
    const refunds = branch.match(/await refund\(/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(2);
    expect(refunds.length).toBe(returns.length);
  });
});
