/**
 * What is still missing before a proposed habit can honestly be installed.
 *
 * ## Why this is a gap check rather than a default
 *
 * `lib/routineProposal.ts` accepts a numeric habit with no `daily_goal`,
 * because plenty of legitimate sources have nothing to say about a target and
 * the install path defaults every column it does not receive. That is correct
 * for a validator and wrong for AI Coach.
 *
 * "Kitap okuma alışkanlığı ekle" with no number is not an invalid proposal; it
 * is an INCOMPLETE one. Installing it with a silent default target would put a
 * number in the user's history they never chose, and installing it with no
 * target at all would create a numeric habit that nothing can ever be logged
 * against — "bugün 10 dakika okudum" would have nothing to be partial of.
 *
 * So this names the gap and the screen asks about it. One field at a time, and
 * only fields that genuinely change what the habit means.
 *
 * ## What is deliberately NOT asked
 *
 * `difficulty` and `estimated_minutes` are required by the schema, so they are
 * always present. `target_direction` defaults to `at_least`, which is what
 * "20 dakika oku" means in every reading — a default that does not change the
 * meaning is not worth a tap. And a `binary` habit is asked nothing: it has no
 * target by definition.
 */
import type { ProposalHabit } from './routineProposal';

/** The two questions worth asking, in the order they are asked. */
export type MissingSemantic = 'goal' | 'frequency';

export type SemanticGap = { index: number; missing: MissingSemantic };

/**
 * The first habit in the list with something missing, or `null` when every
 * habit is complete enough to install.
 *
 * Scans habit by habit rather than field by field so a three-habit plan asks
 * about the first incomplete habit fully before moving on, instead of asking
 * every habit's target and then every habit's schedule.
 */
export function firstMissingSemantic(habits: readonly ProposalHabit[]): SemanticGap | null {
  for (let i = 0; i < habits.length; i++) {
    const h = habits[i];
    // A measurable habit with no measurement. The one gap that makes the
    // difference between a habit you can log against and one you cannot.
    if (h.tracking_type === 'numeric' && h.daily_goal == null) return { index: i, missing: 'goal' };
    // No schedule at all. The install path would default this to daily, which
    // is a real choice about which days the user is answerable for.
    if (h.frequency_config === undefined) return { index: i, missing: 'frequency' };
  }
  return null;
}
