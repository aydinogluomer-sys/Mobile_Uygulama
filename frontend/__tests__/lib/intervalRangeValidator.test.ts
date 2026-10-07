/**
 * R01.02-d — the validator accepts interval_days and the date range.
 *
 * A6  one end-to-end case: what the validator lets through, the scheduler
 *     evaluates as the user meant it -- "every 3 days, 11-20 Aug, created 1 Aug"
 *     is 11, 14, 17, 20 (cycle anchored at max(created_at, range_start), owner
 *     decision R01.02-d), NOT 13, 16, 19 (anchored at created_at).
 * A7  no config WITHOUT the three keys changes its validator result. The
 *     expected values below were captured by running the corpus through
 *     `validateFrequencyConfig` at HEAD 1cd0bc9, before the change, and pasted
 *     verbatim -- with ONE normalisation, stated rather than hidden: the
 *     "(allowed: ...)" list inside an unknown-field message necessarily grows by
 *     the three new keys, so that list is compared as "<list>". Verdicts, paths
 *     and every other word are compared exactly. (Calendar A7 for range-less
 *     habits is `rangelessPreservation.test.ts`, captured at 3524e26 and
 *     re-checked byte-identical at 1cd0bc9 before this card's anchor change.)
 * A8  the AI Coach path keeps an interval habit's schedule whole, all the way
 *     to the install row.
 */
jest.mock('../../repositories/habitRepository', () => ({
  insertRoutineHabits: jest.fn(async () => ({ ok: true, data: [] })),
}));
jest.mock('../../repositories/routineRepository', () => ({
  fetchRoutines: jest.fn(async () => ({ ok: true, data: [] })),
}));

import type { Habit } from '../../lib/supabase';
import { validateFrequencyConfig, validateRoutineProposal } from '../../lib/routineProposal';
import { validateCoachActions, coachActionToRoutineProposal } from '../../lib/coachActions';
import { buildInstallRows } from '../../services/routineService';
import { isEligibleOn, scheduleKind, scheduledCompletionRate } from '../../lib/habitSchedule';
import { VALIDATOR_CORPUS_RANGELESS } from '../helpers/validatorCorpus';

const aug = (d: number) => new Date(2026, 7, d);
const AUG = Array.from({ length: 31 }, (_, i) => i + 1);
const habitWith = (frequency_config: Habit['frequency_config'], created_at: string | undefined): Habit => ({
  id: 'h1', user_id: 'u1', name: 't', behavior_type: 'positive', status: 'active',
  tracking_type: 'boolean', daily_goal: null, target_direction: null,
  frequency_config, created_at, end_condition: null,
} as unknown as Habit);

describe('A6 — validator -> scheduler, end to end', () => {
  const v = validateFrequencyConfig({ kind: 'daily', interval_days: 3, range_start: '2026-08-11', range_end: '2026-08-20' }, 'f');

  it('passes the validator unchanged', () => {
    expect(v.errors).toEqual([]);
    expect(v.frequency).toEqual({ kind: 'daily', interval_days: 3, range_start: '2026-08-11', range_end: '2026-08-20' });
  });

  it('created 1 Aug: due 11, 14, 17, 20 -- the cycle starts at the range, not at creation', () => {
    const h = habitWith(v.frequency!, '2026-08-01T09:00:00');
    expect(scheduleKind(h)).toEqual({ kind: 'every_n_days', intervalDays: 3 });
    const due = AUG.filter((d) => isEligibleOn(h, aug(d)));
    expect(due).toEqual([11, 14, 17, 20]);
    expect(due).not.toEqual([13, 16, 19]); // what a created_at anchor gives
  });

  it('created AFTER the range starts: the cycle starts at creation (max wins)', () => {
    const h = habitWith(v.frequency!, '2026-08-13T09:00:00');
    expect(AUG.filter((d) => isEligibleOn(h, aug(d)))).toEqual([13, 16, 19]);
  });

  it('no created_at: the range start anchors the cycle', () => {
    const h = habitWith(v.frequency!, undefined);
    expect(AUG.filter((d) => isEligibleOn(h, aug(d)))).toEqual([11, 14, 17, 20]);
  });

  it('due-day denominator over August is 4', () => {
    const h = habitWith(v.frequency!, '2026-08-01T09:00:00');
    expect(scheduledCompletionRate(h, [], { from: aug(1), to: aug(31) }).dueDays).toBe(4);
  });

  it('A2 — weekly count + range passes and is evaluated as a count inside the envelope', () => {
    const w = validateFrequencyConfig({ kind: 'weekly', count: 3, range_start: '2026-08-05', range_end: '2026-08-20' }, 'f');
    expect(w.frequency).toEqual({ kind: 'weekly', count: 3, range_start: '2026-08-05', range_end: '2026-08-20' });
    const h = habitWith(w.frequency!, '2026-07-01T09:00:00');
    expect(scheduleKind(h)).toEqual({ kind: 'weekly_count', count: 3 });
    expect(AUG.filter((d) => isEligibleOn(h, aug(d)))).toEqual(AUG.filter((d) => d >= 5 && d <= 20));
  });
});

describe('A5 — forbidden keys are still refused next to the new ones', () => {
  it('__proto__ alongside interval_days', () => {
    const r = validateFrequencyConfig(JSON.parse('{"kind":"daily","interval_days":3,"__proto__":{"x":1}}'), 'f');
    expect(r.frequency).toBeNull();
  });
  it('constructor alongside a range', () => {
    const r = validateFrequencyConfig(JSON.parse('{"kind":"daily","range_start":"2026-08-05","constructor":1}'), 'f');
    expect(r.frequency).toBeNull();
  });
});

// Captured at HEAD 1cd0bc9 (before this card); see the file header.
const EXPECTED_AT_1CD0BC9 = [
  {
    "frequency": {
      "kind": "daily"
    },
    "errors": []
  },
  {
    "frequency": {
      "kind": "daily",
      "part_of_day": [
        "morning"
      ]
    },
    "errors": []
  },
  {
    "frequency": {
      "kind": "daily",
      "part_of_day": [
        "morning",
        "evening"
      ]
    },
    "errors": []
  },
  {
    "frequency": {
      "kind": "weekly",
      "days": [
        0,
        2,
        4
      ]
    },
    "errors": []
  },
  {
    "frequency": {
      "kind": "weekly",
      "days": [
        0,
        1,
        2,
        3,
        4,
        5,
        6
      ]
    },
    "errors": []
  },
  {
    "frequency": {
      "kind": "weekly",
      "count": 1
    },
    "errors": []
  },
  {
    "frequency": {
      "kind": "weekly",
      "count": 7
    },
    "errors": []
  },
  {
    "frequency": {
      "kind": "weekly",
      "days": [
        1
      ],
      "count": 2
    },
    "errors": []
  },
  {
    "frequency": {
      "kind": "monthly",
      "count": 10
    },
    "errors": []
  },
  {
    "frequency": {
      "kind": "monthly",
      "count": 31
    },
    "errors": []
  },
  {
    "frequency": {
      "kind": "monthly"
    },
    "errors": []
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f",
        "message": "f: kind 'weekly' needs either days or count -- without one the habit is never due"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.count",
        "message": "f.count: expected an integer 1-7 for kind 'weekly'"
      },
      {
        "path": "f",
        "message": "f: kind 'weekly' needs either days or count -- without one the habit is never due"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.count",
        "message": "f.count: expected an integer 1-7 for kind 'weekly'"
      },
      {
        "path": "f",
        "message": "f: kind 'weekly' needs either days or count -- without one the habit is never due"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.count",
        "message": "f.count: expected an integer 1-7 for kind 'weekly'"
      },
      {
        "path": "f",
        "message": "f: kind 'weekly' needs either days or count -- without one the habit is never due"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.count",
        "message": "f.count: expected an integer 1-31 for kind 'monthly'"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.count",
        "message": "f.count: meaningless with kind 'daily'"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.days",
        "message": "f.days: only meaningful with kind 'weekly', got 'daily'"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.days",
        "message": "f.days: expected 1-7 weekdays, got 0"
      },
      {
        "path": "f",
        "message": "f: kind 'weekly' needs either days or count -- without one the habit is never due"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.days",
        "message": "f.days: weekdays must be integers 0-6 (Pzt=0 … Paz=6)"
      },
      {
        "path": "f",
        "message": "f: kind 'weekly' needs either days or count -- without one the habit is never due"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.days",
        "message": "f.days: contains a duplicate weekday"
      },
      {
        "path": "f",
        "message": "f: kind 'weekly' needs either days or count -- without one the habit is never due"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.days",
        "message": "f.days: expected an array, got string"
      },
      {
        "path": "f",
        "message": "f: kind 'weekly' needs either days or count -- without one the habit is never due"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.part_of_day",
        "message": "f.part_of_day: expected 1-3 entries, got 0"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.part_of_day",
        "message": "f.part_of_day: entries must be morning/afternoon/evening"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.part_of_day",
        "message": "f.part_of_day: contains a duplicate"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.kind",
        "message": "f.kind: expected one of daily/weekly/monthly/yearly, got string"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f.kind",
        "message": "f.kind: expected one of daily/weekly/monthly/yearly, got undefined"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f",
        "message": "f: expected an object, got string"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f",
        "message": "f: expected an object, got null"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f",
        "message": "f: expected an object, got array"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f",
        "message": "f: unexpected field(s): foo (allowed: <list>)"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f",
        "message": "f: unexpected field(s): bar, baz (allowed: <list>)"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f",
        "message": "f: contains a forbidden key (__proto__ / constructor / prototype)"
      }
    ]
  },
  {
    "frequency": null,
    "errors": [
      {
        "path": "f",
        "message": "f: contains a forbidden key (__proto__ / constructor / prototype)"
      }
    ]
  }
];

describe('A7 — configs without the new keys: validator result unchanged from 1cd0bc9', () => {
  const norm = (m: string) => m.replace(/\(allowed: [^)]*\)/, '(allowed: <list>)');

  it('the corpus carries none of the three new keys', () => {
    for (const raw of VALIDATOR_CORPUS_RANGELESS) {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const k of ['interval_days', 'range_start', 'range_end']) expect(Object.keys(raw)).not.toContain(k);
      }
    }
    expect(VALIDATOR_CORPUS_RANGELESS).toHaveLength(EXPECTED_AT_1CD0BC9.length);
  });

  VALIDATOR_CORPUS_RANGELESS.forEach((raw, i) => {
    it(`#${i} ${JSON.stringify(raw)}`, () => {
      const r = validateFrequencyConfig(raw, 'f');
      expect({ frequency: r.frequency, errors: r.errors.map((e) => ({ path: e.path, message: norm(e.message) })) })
        .toEqual(EXPECTED_AT_1CD0BC9[i]);
    });
  });

  // Wording now lists 'yearly' among the kinds (#25/#26 above) and the R01.02
  // keys in the allowed list: the results are otherwise unchanged.
  it('the one deliberate wording change: the allowed list names the new keys', () => {
    const r = validateFrequencyConfig({ kind: 'daily', foo: 1 }, 'f');
    expect(r.errors[0].message).toBe('f: unexpected field(s): foo (allowed: kind, days, part_of_day, count, interval_days, range_start, range_end, month_days, short_month, month, day, leap_day)');
  });
});

describe('A8 — the AI Coach path keeps an interval habit whole', () => {
  const HABIT = {
    name: 'Koşu', tracking_type: 'binary', difficulty: 3, estimated_minutes: 30,
    frequency_config: { kind: 'daily', interval_days: 3, range_start: '2026-08-11', range_end: '2026-08-20' },
  };

  it('validateCoachActions accepts it and keeps the proposed config, nothing dropped', () => {
    const { actions, rejected } = validateCoachActions([{ type: 'propose_habit', habit: HABIT }]);
    expect(rejected).toEqual([]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ type: 'propose_habit', habit: HABIT });
  });

  it('crosses into the routine pipeline and reaches the install row unchanged', () => {
    const { actions } = validateCoachActions([{ type: 'propose_habit', habit: HABIT }]);
    const proposal = coachActionToRoutineProposal(actions[0]);
    const res = validateRoutineProposal(proposal);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.habits[0].frequency_config).toEqual(HABIT.frequency_config);
    const [row] = buildInstallRows(res.proposal.habits, ['Koşu']);
    expect(row.frequency_config).toEqual(HABIT.frequency_config);
  });

  it('an invalid interval from the coach is rejected, not installed as daily', () => {
    const bad = { ...HABIT, frequency_config: { kind: 'daily', interval_days: 1 } };
    const { actions, rejected } = validateCoachActions([{ type: 'propose_habit', habit: bad }]);
    expect(actions).toEqual([]);
    expect(rejected).toHaveLength(1);
  });
});
