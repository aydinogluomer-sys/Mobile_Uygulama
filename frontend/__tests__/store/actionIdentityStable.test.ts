/**
 * Store actions keep their identity across state changes.
 *
 * ## Why this test exists
 *
 * Roughly thirty `useEffect` dependency arrays across the app now name their
 * store actions — `[fetchHabits, fetchToday]` instead of `[]` — because
 * `react-hooks/exhaustive-deps` is right that they ARE dependencies, and
 * listing them is free as long as the identity never changes.
 *
 * That "as long as" is an assumption about zustand, and it is invisible at
 * the call sites. If a store were ever refactored so an action is rebuilt
 * per render — a selector returning a fresh closure, an action recreated
 * inside `set`, a wrapper added around the slice — every one of those effects
 * would start re-running on each state change. The symptom would be a fetch
 * loop on a screen far away from the change that caused it, and nothing in
 * the suite would point at the cause.
 *
 * So the assumption gets asserted where it lives, once.
 *
 * The check is deliberately behavioural rather than structural: it reads an
 * action, mutates the store, and reads the action again.
 */
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: null } })),
      getUser: jest.fn(async () => ({ data: { user: null } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
    from: jest.fn(() => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) })),
  },
}));

import { useHabitStore } from '../../store/habitStore';
import { useTaskStore } from '../../store/taskStore';
import { useLogStore } from '../../store/logStore';
import { useNoteStore } from '../../store/noteStore';
import { useProjectStore } from '../../store/projectStore';
import { useProfileStore } from '../../store/profileStore';
import { useGoalStore } from '../../store/goalStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { useFocusStore } from '../../store/focusStore';
import { useJournalStore } from '../../store/journalStore';

type AnyStore = { getState: () => Record<string, unknown>; setState: (p: Record<string, unknown>) => void };

const STORES: [string, AnyStore][] = [
  ['habitStore', useHabitStore as unknown as AnyStore],
  ['taskStore', useTaskStore as unknown as AnyStore],
  ['logStore', useLogStore as unknown as AnyStore],
  ['noteStore', useNoteStore as unknown as AnyStore],
  ['projectStore', useProjectStore as unknown as AnyStore],
  ['profileStore', useProfileStore as unknown as AnyStore],
  ['goalStore', useGoalStore as unknown as AnyStore],
  ['recoveryStore', useRecoveryStore as unknown as AnyStore],
  ['focusStore', useFocusStore as unknown as AnyStore],
  ['journalStore', useJournalStore as unknown as AnyStore],
];

const actionsOf = (s: Record<string, unknown>) =>
  Object.entries(s).filter(([, v]) => typeof v === 'function');

describe('an action is the same function object before and after a state change', () => {
  it.each(STORES)('%s', (_name, store) => {
    const before = new Map(actionsOf(store.getState()));
    expect(before.size).toBeGreaterThan(0); // scanner sanity: a store with no actions proves nothing

    // Any state write at all. The point is that writing state does not
    // rebuild the action slice.
    store.setState({ __identityProbe: Date.now() });

    const after = new Map(actionsOf(store.getState()));
    const changed = [...before.keys()].filter((k) => before.get(k) !== after.get(k));
    expect(changed).toEqual([]);
  });
});

describe('the probe would notice if it stopped being true', () => {
  it('catches an action that is rebuilt on a state change', () => {
    // Mutation control: without this, `changed` could be empty because the
    // comparison is broken rather than because the stores behave.
    const store = useHabitStore as unknown as AnyStore;
    const before = new Map(actionsOf(store.getState()));
    const [firstName] = [...before.keys()];

    store.setState({ [firstName]: () => undefined });

    const after = new Map(actionsOf(store.getState()));
    const changed = [...before.keys()].filter((k) => before.get(k) !== after.get(k));
    expect(changed).toEqual([firstName]);

    store.setState({ [firstName]: before.get(firstName) });
  });
});
