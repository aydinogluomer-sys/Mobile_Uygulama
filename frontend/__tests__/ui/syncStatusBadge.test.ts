/**
 * §18 — `dead` must be VISIBLY DISTINCT from `pending`.
 *
 * WHY THIS IS A REAL ASSERTION AND NOT POLISH. `lib/syncQueue.ts` produces two
 * statuses whose meaning to the user is opposite:
 *
 *   pending — the write has not gone yet, but it will. Do nothing.
 *   dead    — the write exhausted its retry budget and is TERMINAL.
 *             `orderedPending` excludes it, so the app will never try again.
 *             Without user action that tap is lost, permanently.
 *
 * Rendering the second like the first is silent data loss with a progress
 * indicator over it: the user waits, nothing happens, the record is gone.
 *
 * The component's decision is factored out into the pure `syncBadgeParts` so
 * these properties can be asserted directly. `react-test-renderer` is
 * deliberately not used: it ships with `jest-expo` but has no type
 * declarations, so importing it puts `npx tsc --noEmit` errors into the repo
 * (there is a live example of exactly that in the tree today).
 * `__tests__/repo/syncLifecycleWired.test.ts` covers the remaining half —
 * that the component actually renders these parts and is mounted.
 *
 * AC-B01  nothing queued -> nothing rendered
 * AC-B02  each status produces its own part
 * AC-B03  dead differs from pending in MORE than colour (icon + label +
 *         outline), because colour alone is not a signal for a colour-blind
 *         user or a washed-out screen
 * AC-B04  dead is listed FIRST when both are present
 * AC-B05  the screen-reader label states the recovery path for dead
 */
import { syncBadgeParts, syncBadgeA11yLabel } from '../../components/ui/SyncStatusBadge';

describe('AC-B01 — a fully synced queue renders nothing', () => {
  it('produces no parts at zero', () => {
    expect(syncBadgeParts(0, 0)).toEqual([]);
  });

  it('never renders a "0 bekliyor" placeholder', () => {
    // A permanent zero badge is noise that trains the user to ignore the one
    // place they would otherwise notice a real failure.
    expect(syncBadgeParts(0, 0)).toHaveLength(0);
    expect(syncBadgeA11yLabel(0, 0)).toBe('');
  });
});

describe('AC-B02 — each status produces its own part', () => {
  it('pending only', () => {
    const parts = syncBadgeParts(3, 0);
    expect(parts).toHaveLength(1);
    expect(parts[0].tone).toBe('pending');
    expect(parts[0].count).toBe(3);
    expect(parts[0].label).toContain('3');
  });

  it('dead only', () => {
    const parts = syncBadgeParts(0, 2);
    expect(parts).toHaveLength(1);
    expect(parts[0].tone).toBe('dead');
    expect(parts[0].count).toBe(2);
    expect(parts[0].label).toContain('2');
  });

  it('both', () => {
    expect(syncBadgeParts(3, 2).map((p) => p.tone)).toEqual(['dead', 'pending']);
  });
});

describe('AC-B03 — dead is distinguishable by more than colour', () => {
  const dead = syncBadgeParts(0, 1)[0];
  const pending = syncBadgeParts(1, 0)[0];

  it('different colour', () => {
    expect(dead.color).not.toBe(pending.color);
  });

  it('different icon — the signal survives a colour-blind viewer', () => {
    expect(dead.icon).not.toBe(pending.icon);
  });

  it('different wording — the signal survives a monochrome screenshot', () => {
    expect(dead.label).not.toBe(pending.label);
    // Not merely a different number: the WORDS must differ.
    expect(dead.label.replace(/\d+/g, '')).not.toBe(pending.label.replace(/\d+/g, ''));
  });

  it('only dead is outlined', () => {
    expect(dead.outlined).toBe(true);
    expect(pending.outlined).toBe(false);
  });

  it('the labels are Turkish, as the app requires', () => {
    expect(dead.label).toMatch(/eşitlenemedi/);
    expect(pending.label).toMatch(/bekliyor/);
  });
});

describe('AC-B04 — dead comes first when both are present', () => {
  it('the status needing attention is not a footnote after the harmless one', () => {
    const parts = syncBadgeParts(5, 1);
    expect(parts[0].tone).toBe('dead');
    expect(parts[1].tone).toBe('pending');
  });
});

describe('AC-B05 — the screen-reader label carries the recovery path', () => {
  it('tells a dead-op user what actually un-sticks it', () => {
    // `enqueue` in lib/syncQueue.ts revives a dead op on a fresh tap for the
    // same (habit, day). That is the ONLY recovery, so it is the one the
    // label must name -- "retry" would be a lie, since flushPendingSync
    // never looks at a dead op.
    const label = syncBadgeA11yLabel(0, 1);
    expect(label).toMatch(/eşitlenemedi/);
    expect(label).toMatch(/dokun/);
  });

  it('says nothing about retrying when only pending ops exist', () => {
    const label = syncBadgeA11yLabel(2, 0);
    expect(label).toMatch(/bekliyor/);
    expect(label).not.toMatch(/dokun/);
  });

  it('mentions both when both exist', () => {
    const label = syncBadgeA11yLabel(2, 1);
    expect(label).toMatch(/eşitlenemedi/);
    expect(label).toMatch(/bekliyor/);
  });
});
