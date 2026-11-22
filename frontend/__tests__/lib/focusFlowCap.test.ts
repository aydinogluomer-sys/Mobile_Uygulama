import {
  FLOW_DAILY_CAP,
  FOCUS_FLOW_ITEMS,
  addSeen,
  buildFeedEntries,
  capFlowFeed,
  findAtomicHabitById,
  flowSeenKey,
  isCappedCategory,
  parseFlowSeen,
  pickClosureAction,
} from '../../lib/focusFlowCatalog';

describe('focusFlowCap (PS-17)', () => {
  it('(+) caps feed to 3 items per day, preserving catalog order and marking exhausted at 3 seen', () => {
    expect(FLOW_DAILY_CAP).toBe(3);
    expect(flowSeenKey('u-42')).toBe('aderyth.focusFlow.seen.v1.u-42');
    expect(isCappedCategory('for_you')).toBe(true);
    expect(isCappedCategory('all')).toBe(true);
    expect(isCappedCategory('dopamine')).toBe(true);

    // 0 seen on 12+ items -> first 3 items, exhausted=false
    const empty = capFlowFeed(FOCUS_FLOW_ITEMS, []);
    expect(empty.items.map((i) => i.id)).toEqual(
      FOCUS_FLOW_ITEMS.slice(0, 3).map((i) => i.id),
    );
    expect(empty.seenCount).toBe(0);
    expect(empty.exhausted).toBe(false);

    // 1 seen -> seen item + 2 unseen items, exhausted=false
    const fifthId = FOCUS_FLOW_ITEMS[4].id;
    const oneSeen = capFlowFeed(FOCUS_FLOW_ITEMS, [fifthId]);
    expect(oneSeen.items.map((i) => i.id)).toEqual([
      fifthId,
      FOCUS_FLOW_ITEMS[0].id,
      FOCUS_FLOW_ITEMS[1].id,
    ]);
    expect(oneSeen.seenCount).toBe(1);
    expect(oneSeen.exhausted).toBe(false);

    // 3 seen -> only the 3 seen items, exhausted=true, seenCount=3
    const threeIds = [
      FOCUS_FLOW_ITEMS[0].id,
      FOCUS_FLOW_ITEMS[2].id,
      FOCUS_FLOW_ITEMS[5].id,
    ];
    const done = capFlowFeed(FOCUS_FLOW_ITEMS, threeIds);
    expect(done.items.map((i) => i.id)).toEqual(threeIds);
    expect(done.seenCount).toBe(3);
    expect(done.exhausted).toBe(true);
  });

  it('(+) pickClosureAction selects the most recently seen add_atomic_habit item, and parseFlowSeen / addSeen round-trip cleanly', () => {
    const habitItems = FOCUS_FLOW_ITEMS.filter(
      (i) => i.cta.actionType === 'add_atomic_habit',
    );
    const nonHabitItem = FOCUS_FLOW_ITEMS.find(
      (i) => i.cta.actionType !== 'add_atomic_habit',
    )!;
    expect(habitItems.length).toBeGreaterThanOrEqual(2);

    const picked = pickClosureAction(
      [habitItems[0], habitItems[1], nonHabitItem],
      new Set(),
    );
    expect(picked?.id).toBe(habitItems[1].id);

    let seen: string[] = [];
    seen = addSeen(seen, 'a');
    seen = addSeen(seen, 'a');
    seen = addSeen(seen, 'b');
    seen = addSeen(seen, 'c');
    seen = addSeen(seen, 'd');
    expect(seen).toEqual(['a', 'b', 'c']);

    const raw = JSON.stringify({ day: '2026-11-22', ids: ['a', 'b', 'a'] });
    expect(parseFlowSeen(raw, '2026-11-22')).toEqual(['a', 'b']);
  });

  it('(-) leaves saved uncapped, rejects stale/corrupt seen blobs, skips already-added habits, deducts cross-category seen budget, and omits closure unless passed', () => {
    expect(isCappedCategory('saved')).toBe(false);

    // Different day or malformed JSON -> []
    expect(
      parseFlowSeen(
        JSON.stringify({ day: '2026-11-21', ids: ['x'] }),
        '2026-11-22',
      ),
    ).toEqual([]);
    expect(parseFlowSeen('{corrupt', '2026-11-22')).toEqual([]);
    expect(parseFlowSeen(null, '2026-11-22')).toEqual([]);
    expect(parseFlowSeen('["array"]', '2026-11-22')).toEqual([]);

    // Existing habit is skipped in favor of earlier eligible habit, or null when all added
    const habitItems = FOCUS_FLOW_ITEMS.filter(
      (i) => i.cta.actionType === 'add_atomic_habit',
    );
    const secondAtomic = findAtomicHabitById(habitItems[1].cta.atomicHabitId)!;
    const firstAtomic = findAtomicHabitById(habitItems[0].cta.atomicHabitId)!;

    const fallback = pickClosureAction(
      [habitItems[0], habitItems[1]],
      new Set([secondAtomic.name.trim().toLocaleLowerCase('tr-TR')]),
    );
    expect(fallback?.id).toBe(habitItems[0].id);

    const noneLeft = pickClosureAction(
      [habitItems[0], habitItems[1]],
      new Set([
        firstAtomic.name.trim().toLocaleLowerCase('tr-TR'),
        secondAtomic.name.trim().toLocaleLowerCase('tr-TR'),
      ]),
    );
    expect(noneLeft).toBeNull();

    // Seen IDs from another category reduce the remaining unseen budget
    const focusOnly = FOCUS_FLOW_ITEMS.filter((i) => i.category === 'focus');
    const otherCatItem = FOCUS_FLOW_ITEMS.find((i) => i.category !== 'focus')!;
    const crossCapped = capFlowFeed(focusOnly, [otherCatItem.id, 'other-2']);
    expect(crossCapped.items).toHaveLength(1);
    expect(crossCapped.exhausted).toBe(false);

    // buildFeedEntries omits closure when closure is not given, and appends when given
    const plainEntries = buildFeedEntries(FOCUS_FLOW_ITEMS.slice(0, 3), 5);
    expect(plainEntries.some((e) => e.entryKind === 'closure')).toBe(false);

    const closedEntries = buildFeedEntries(FOCUS_FLOW_ITEMS.slice(0, 3), 5, {
      seenCount: 3,
      action: habitItems[0],
    });
    expect(closedEntries[closedEntries.length - 1]).toEqual({
      entryKind: 'closure',
      key: 'closure-daily-cap',
      seenCount: 3,
      action: habitItems[0],
    });
  });
});
