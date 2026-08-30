/**
 * L1 tests for store-level date derivation.  (task 1E-L1b)
 *
 * AC-D03/D04 taskStore.dueToday()/overdue() at 01:00 local
 * AC-D08      deepWorkStore week boundary
 *
 * The clock is faked, so "what happens at 01:00" is a fact rather than
 * something you can only observe by staying up. TZ is Europe/Istanbul (UTC+3):
 * between 00:00 and 03:00 local, UTC is still yesterday.
 *
 * Written BEFORE the fix and observed to fail, per R-01.
 */
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      // The data layer resolves the user id from the LOCAL session -- see
      // `repositories/shared.currentUserId`. Derived from this mock's own
      // getUser so the two can never disagree.
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
       getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
    from: jest.fn(),
  },
}));

import { useTaskStore, type Task } from '../../store/taskStore';
import { useDeepWorkStore, type DeepWorkSession } from '../../store/deepWorkStore';

/** 2026-08-04 01:00 local (UTC+3) — UTC is still 2026-08-03T22:00. */
const AT_0100 = new Date(2026, 7, 4, 1, 0, 0);

function task(over: Partial<Task>): Task {
  return {
    id: 't1', user_id: 'u1', title: 'x', completed: false,
    status: 'pending', list_type: 'inbox', due_date: null,
    ...over,
  } as Task;
}
function session(over: Partial<DeepWorkSession>): DeepWorkSession {
  return { id: 's1', user_id: 'u1', subject: 'x', duration_minutes: 60, date: '2026-08-04', ...over } as DeepWorkSession;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(AT_0100);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the clock is where we think it is', () => {
  it('is 01:00 local on 2026-08-04, and 2026-08-03 in UTC', () => {
    const now = new Date();
    expect(now.getHours()).toBe(1);
    expect(now.getDate()).toBe(4);
    expect(now.toISOString().slice(0, 10)).toBe('2026-08-03'); // the trap
  });
});

describe('AC-D03 — taskStore.dueToday at 01:00 local', () => {
  it("returns tasks due TODAY, not yesterday's", () => {
    useTaskStore.setState({
      tasks: [
        task({ id: 'today', due_date: '2026-08-04' }),
        task({ id: 'yesterday', due_date: '2026-08-03' }),
      ],
    });
    const ids = useTaskStore.getState().dueToday().map((t) => t.id);
    expect(ids).toEqual(['today']);
  });
});

describe('AC-D04 — taskStore.overdue at 01:00 local', () => {
  it("still reports yesterday's unfinished task as overdue", () => {
    useTaskStore.setState({
      tasks: [
        task({ id: 'yesterday', due_date: '2026-08-03' }),
        task({ id: 'today', due_date: '2026-08-04' }),
      ],
    });
    const ids = useTaskStore.getState().overdue().map((t) => t.id);
    expect(ids).toEqual(['yesterday']);
  });

  it('does not report today as overdue', () => {
    useTaskStore.setState({ tasks: [task({ id: 'today', due_date: '2026-08-04' })] });
    expect(useTaskStore.getState().overdue()).toHaveLength(0);
  });
});

describe('deepWorkStore at 01:00 local', () => {
  it('todayMinutes counts sessions dated today', () => {
    useDeepWorkStore.setState({
      sessions: [
        session({ id: 'a', date: '2026-08-04', duration_minutes: 30 }),
        session({ id: 'b', date: '2026-08-03', duration_minutes: 90 }),
      ],
    });
    expect(useDeepWorkStore.getState().todayMinutes()).toBe(30);
  });
});

describe('AC-D08 — deep-work week boundary is local Monday', () => {
  it('a Sunday 22:00 session belongs to the week that is closing', () => {
    // Sunday 2026-08-09 22:00 local. The ISO week is Mon 03 .. Sun 09.
    jest.setSystemTime(new Date(2026, 7, 9, 22, 0, 0));
    useDeepWorkStore.setState({
      sessions: [
        session({ id: 'mon', date: '2026-08-03', duration_minutes: 60 }),
        session({ id: 'sun', date: '2026-08-09', duration_minutes: 30 }),
        session({ id: 'prev', date: '2026-08-02', duration_minutes: 999 }),
      ],
    });
    // Monday and Sunday are in-week; the previous Sunday is not.
    expect(useDeepWorkStore.getState().weekMinutes()).toBe(90);
  });

  it('at Monday 01:00 the week has just started', () => {
    jest.setSystemTime(new Date(2026, 7, 3, 1, 0, 0));
    useDeepWorkStore.setState({
      sessions: [
        session({ id: 'mon', date: '2026-08-03', duration_minutes: 25 }),
        session({ id: 'lastweek', date: '2026-08-02', duration_minutes: 999 }),
      ],
    });
    expect(useDeepWorkStore.getState().weekMinutes()).toBe(25);
  });
});
