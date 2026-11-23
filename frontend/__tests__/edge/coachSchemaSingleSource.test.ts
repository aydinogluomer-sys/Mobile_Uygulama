import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ALL_COACH_ACTION_TYPES,
  COACH_HABIT_SCHEMA,
  COACH_SCHEMA_BOUNDS,
} from '../../../supabase/functions/_shared/coachContractSchema';
import { V2_ACTION_TYPES } from '../../lib/coachActionsV2';
import {
  MAX_ESTIMATED_MINUTES,
  MAX_GOAL_LENGTH,
  MAX_HABITS_PER_PROPOSAL,
  MAX_HABIT_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  PERSISTABLE_TRACKING_TYPES,
  VALID_DIFFICULTIES,
} from '../../lib/routineProposal';
import { edgeSource } from '../helpers/edgeSource';
import { stripComments } from '../helpers/sourceText';

export function isSupportedAnthropicSdkSpec(spec: string | undefined): boolean {
  if (!spec) return false;
  const m = /^npm:@anthropic-ai\/sdk@(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major >= 1 || (major === 0 && minor >= 30);
}

describe('F21 — Coach Contract Schema Single-Source-of-Truth & SDK Pinning', () => {
  it('shared _shared/coachContractSchema bounds match client routineProposal.ts and coachActionsV2.ts byte-for-byte', () => {
    expect(COACH_SCHEMA_BOUNDS.MAX_HABIT_NAME_LENGTH).toBe(MAX_HABIT_NAME_LENGTH);
    expect(COACH_SCHEMA_BOUNDS.MAX_TITLE_LENGTH).toBe(MAX_TITLE_LENGTH);
    expect(COACH_SCHEMA_BOUNDS.MAX_GOAL_LENGTH).toBe(MAX_GOAL_LENGTH);
    expect(COACH_SCHEMA_BOUNDS.MAX_HABITS_PER_PROPOSAL).toBe(MAX_HABITS_PER_PROPOSAL);
    expect(COACH_SCHEMA_BOUNDS.MAX_ESTIMATED_MINUTES).toBe(MAX_ESTIMATED_MINUTES);
    expect([...COACH_SCHEMA_BOUNDS.VALID_DIFFICULTIES]).toEqual([...VALID_DIFFICULTIES]);
    expect([...COACH_SCHEMA_BOUNDS.PERSISTABLE_TRACKING_TYPES]).toEqual([...PERSISTABLE_TRACKING_TYPES]);

    expect([...ALL_COACH_ACTION_TYPES]).toEqual([
      'propose_habit',
      'propose_habit_plan',
      'log_habit',
      ...V2_ACTION_TYPES,
    ]);

    expect(COACH_HABIT_SCHEMA.properties.name.maxLength).toBe(MAX_HABIT_NAME_LENGTH);
    expect(COACH_HABIT_SCHEMA.properties.estimated_minutes.maximum).toBe(MAX_ESTIMATED_MINUTES);
  });

  it('generate-routine imports shared schema & sseFrames and deno.json pins @anthropic-ai/sdk (>= 0.30.0)', () => {
    const edgeCode = stripComments(edgeSource('generate-routine'));
    const denoCfg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', 'deno.json'), 'utf8'),
    ) as { imports?: Record<string, string> };

    expect(edgeCode).toContain("from '../_shared/coachContractSchema.ts'");
    expect(edgeCode).toContain("from '../_shared/sseFrames.ts'");
    expect(isSupportedAnthropicSdkSpec(denoCfg.imports?.['@anthropic-ai/sdk'])).toBe(true);
    expect(edgeCode).toContain('text/event-stream');

    // Benign minor/major upgrades stay green; unpinned or <0.30 specs fail
    expect(isSupportedAnthropicSdkSpec('npm:@anthropic-ai/sdk@0.40.0')).toBe(true);
    expect(isSupportedAnthropicSdkSpec('npm:@anthropic-ai/sdk@1.0.0')).toBe(true);
    expect(isSupportedAnthropicSdkSpec('npm:@anthropic-ai/sdk@0.29.9')).toBe(false);
    expect(isSupportedAnthropicSdkSpec('npm:@anthropic-ai/sdk@^0.39.0')).toBe(false);
    expect(stripComments('// text/event-stream\nconst x = 1;')).not.toContain('text/event-stream');
  });
});
