/**
 * The coach answers through a forced tool call, and that is what makes an
 * actionable request actionable.
 *
 * ## What was wrong before
 *
 * The transport was prose with an OPTIONAL `[[ACTIONS]]` block appended. Two
 * failure modes, both seen on a real device:
 *
 *   optional     "Her gün 20 dakika kitap okuma alışkanlığı eklemek
 *                istiyorum" could legally return encouraging prose and an
 *                empty action list. Nothing to tap, 5 FP spent.
 *   best-effort  a block cut off by `max_tokens`, or one comma out, silently
 *                became no action rather than a visible failure.
 *
 * A forced tool call removes both: the model cannot answer any other way, and
 * `actions` is a required array in a schema the provider checks before the
 * response is sent.
 *
 * These tests read the function's source rather than invoking it, for the same
 * reason as every other test in this directory: it is Deno plus a live
 * Anthropic key. What they can prove is the contract — that the call is forced,
 * that it is still ONE call, that the schema says what the app's validator
 * expects, and that nothing here is trusted downstream.
 */
import { edgeSource } from '../helpers/edgeSource';

const SRC = edgeSource('generate-routine');

/** The coach branch of the request handler. */
const COACH_BRANCH = (() => {
  const start = SRC.indexOf("if (mode === 'coach')", SRC.indexOf('const callAi'));
  return SRC.slice(start, SRC.indexOf("else if (mode === 'summarize')", start));
})();

const TOOL = (() => {
  const start = SRC.indexOf('const COACH_TOOL = {');
  expect(start).toBeGreaterThan(-1);
  return SRC.slice(start, SRC.indexOf('\n} as const;', start));
})();

const HABIT_SCHEMA = (() => {
  const start = SRC.indexOf('const COACH_HABIT_SCHEMA = {');
  expect(start).toBeGreaterThan(-1);
  return SRC.slice(start, SRC.indexOf('\n} as const;', start));
})();

describe('the structured response is forced, not offered', () => {
  it('the coach branch declares the tool and requires it', () => {
    expect(COACH_BRANCH).toContain('tools: [COACH_TOOL]');
    expect(COACH_BRANCH).toMatch(/tool_choice: \{ type: 'tool', name: COACH_TOOL\.name \}/);
  });

  it('`auto` is never used for the coach', () => {
    // `auto` is the setting that lets an actionable request come back as prose.
    expect(COACH_BRANCH).not.toMatch(/tool_choice:\s*\{\s*type:\s*'auto'/);
    expect(COACH_BRANCH).not.toMatch(/tool_choice:\s*\{\s*type:\s*'any'/);
  });

  it('reply and actions are both REQUIRED by the schema', () => {
    expect(TOOL).toMatch(/required: \['reply', 'actions'\]/);
  });

  it('the schema is closed — no field the validator has never heard of', () => {
    expect(TOOL).toContain('additionalProperties: false');
    expect(HABIT_SCHEMA).toContain('additionalProperties: false');
  });

  it('at most one action per turn', () => {
    expect(TOOL).toContain('maxItems: 1');
  });

  it('only the three known action types are expressible', () => {
    expect(TOOL).toContain("enum: ['propose_habit']");
    expect(TOOL).toContain("enum: ['propose_habit_plan']");
    expect(TOOL).toContain("enum: ['log_habit']");
    expect(TOOL).not.toMatch(/delete_habit|archive_habit|drop/);
  });

  it('the model cannot name a habit by id', () => {
    // Resolution is the app's job, against the user's own rows. An id from the
    // model is authority, and authority never comes from a model.
    expect(TOOL).toContain('habit_query');
    expect(TOOL).not.toMatch(/habit_id/);
  });
});

describe('the five cases the device retest walks through', () => {
  // Each of these is a real prompt from the failing device report. The prompt
  // names them so the mapping from sentence to action is stated, not hoped for.
  const CASES: [string, string][] = [
    ['Motivasyonum çok düşük.', 'actions: []'],
    ['Bana 3 maddelik kısa bir haftalık plan öner.', 'propose_habit_plan'],
    ['Her gün 20 dakika kitap okuma alışkanlığı eklemek istiyorum.', 'propose_habit'],
    ['Bugünkü yürüyüşümü yaptım.', 'log_habit'],
    ['Bugün 10 dakika kitap okudum.', 'log_habit'],
  ];

  it.each(CASES)('%s is named in the prompt', (prompt) => {
    expect(SRC).toContain(prompt);
  });

  it('the two logging shapes are spelled out, state and value', () => {
    expect(SRC).toMatch(/completion\.kind = "state", state = "done"/);
    expect(SRC).toMatch(/completion\.kind = "value", value = 10, unit = "dakika"/);
  });

  it('the create example carries the target, not just the estimate', () => {
    expect(SRC).toMatch(/unit: "dakika", daily_goal: 20, target_direction: "at_least"/);
    expect(SRC).toMatch(/frequency_config: \{ "kind": "daily" \}, estimated_minutes: 20/);
  });
});

describe('one request, one charge', () => {
  it('there is still exactly one Anthropic call in the coach branch', () => {
    const calls = COACH_BRANCH.match(/client\.messages\.create\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('`tools` rides on that same call rather than a second one', () => {
    const call = COACH_BRANCH.slice(COACH_BRANCH.indexOf('client.messages.create('));
    const body = call.slice(0, call.indexOf('});'));
    expect(body).toContain('tools:');
    expect(body).toContain('tool_choice:');
    expect(body).toContain('system: COACH_SYSTEM_PROMPT');
  });

  it('the coach still costs 5 FP', () => {
    expect(SRC).toMatch(/COST\s*=\s*\{[^}]*coach:\s*5/);
  });

  it('the turn is still keyed for idempotent replay', () => {
    expect(SRC).toMatch(/runIdempotentAiRequest/);
    expect(SRC).toContain('request_id');
  });
});

describe('the habit schema carries the semantics, not just the effort', () => {
  it('names the four measurement fields the app persists', () => {
    for (const field of ['unit', 'daily_goal', 'target_direction', 'frequency_config']) {
      expect(HABIT_SCHEMA).toContain(`${field}:`);
    }
  });

  it('keeps daily_goal and estimated_minutes as different facts', () => {
    // The whole defect in one line: "20 dakika kitap oku" used to become
    // estimated_minutes 20 and no target at all.
    expect(SRC).toMatch(/estimated_minutes[\s\S]{0,120}Hedef değildir/);
    expect(SRC).toMatch(/Sadece \\`estimated_minutes: 20\\` yazmak YANLIŞTIR/);
  });

  it('states the app’s weekday indexing, which is NOT JavaScript’s', () => {
    // `lib/habitSchedule.ts`'s weekdayIndex is (getDay() + 6) % 7. A model
    // emitting Sunday as 0 would schedule Monday, and no range check can catch
    // it — only saying so can.
    expect(SRC).toMatch(/Pzt=0, Sal=1, Çar=2, Per=3, Cum=4, Cmt=5, Paz=6/);
    expect(SRC).toMatch(/JavaScript'in Pazar=0 düzeni DEĞİL/);
    expect(HABIT_SCHEMA).toMatch(/Pzt=0 … Paz=6/);
  });

  it('tells the model to omit what the user did not say', () => {
    expect(SRC).toMatch(/BİLMEDİĞİNİ UYDURMA/);
    expect(SRC).toMatch(/ikisi birlikte gelir ya da hiç gelmez/);
  });

  it('bounds every free field', () => {
    expect(HABIT_SCHEMA).toMatch(/maxLength: 80/);   // name
    expect(HABIT_SCHEMA).toMatch(/maxLength: 24/);   // unit
    expect(HABIT_SCHEMA).toMatch(/maximum: 1440/);   // estimated_minutes
    expect(HABIT_SCHEMA).toMatch(/maximum: 100000/); // daily_goal
  });
});

describe('the response is read defensively', () => {
  const READER = SRC.slice(SRC.indexOf('function readCoachResponse'), SRC.indexOf('\n/**\n * How much of a thread'));

  it('only the app’s own tool is read', () => {
    expect(READER).toMatch(/block\.name !== COACH_TOOL\.name/);
  });

  it('a non-object tool input yields nothing rather than throwing', () => {
    expect(READER).toMatch(/typeof input !== 'object' \|\| Array\.isArray\(input\)/);
  });

  it('actions is coerced to an array, never trusted as one', () => {
    expect(READER).toContain('Array.isArray(actions) ? actions : []');
  });

  it('a truncated tool call is named, not parsed', () => {
    expect(COACH_BRANCH).toMatch(/stop_reason === 'max_tokens'[\s\S]{0,160}ai_truncated/);
  });

  it('the delimiter block survives only as a fallback', () => {
    // Kept so a surprising text-only response still reaches the user as prose.
    // It must not be the path the contract depends on.
    expect(READER).toContain('splitCoachActions');
    expect(SRC).toMatch(/LEGACY FALLBACK ONLY -- no longer the action transport/);
  });

  it('an empty reply is still a provider failure, so the charge is refunded', () => {
    expect(COACH_BRANCH).toMatch(/if \(!reply\)[\s\S]{0,160}ai_empty_response/);
  });
});

describe('F21 (GEM-08) — routine mode is also a forced tool call with bounded schema', () => {
  const ROUTINE_SCHEMA = (() => {
    const start = SRC.indexOf('export const ROUTINE_TOOL = {');
    expect(start).toBeGreaterThan(-1);
    return SRC.slice(start, SRC.indexOf('\n} as const;', start));
  })();
  const ROUTINE_BRANCH = (() => {
    const start = SRC.indexOf('system: SYSTEM_PROMPT,', SRC.indexOf('const callAi'));
    const callStart = SRC.lastIndexOf('client.messages.create({', start);
    return SRC.slice(callStart, SRC.indexOf('payload = routine.payload', start));
  })();

  it('forces routine_response via tool_choice and caps items at maxItems: 4 without text.match or JSON.parse', () => {
    expect(ROUTINE_SCHEMA).toContain("name: 'routine_response'");
    expect(ROUTINE_SCHEMA).toContain('maxItems: 4');
    expect(ROUTINE_SCHEMA).toContain('additionalProperties: false');
    expect(ROUTINE_BRANCH).toMatch(/tool_choice:\s*\{\s*type:\s*'tool',\s*name:\s*ROUTINE_TOOL\.name\s*\}/);
    expect(ROUTINE_BRANCH).not.toContain('text.match(');
    expect(ROUTINE_BRANCH).not.toContain('JSON.parse(');
  });
});
