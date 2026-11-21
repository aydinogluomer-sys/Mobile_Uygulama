import { resetAccountMemory } from '../../lib/accountScope';
import { createLatest, createLatestByKey } from '../../lib/latestOnly';

describe('latestOnly — request staleness and account epoch guard', () => {
  it('marks an earlier run stale as soon as a newer begin() starts', () => {
    const latest = createLatest();
    const first = latest.begin();
    const second = latest.begin();

    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    first.done();
    second.done();
  });

  it('marks an in-flight run stale across an account reset (resetAccountMemory)', () => {
    const latest = createLatest();
    const run = latest.begin();
    expect(run.isCurrent()).toBe(true);

    resetAccountMemory('user_changed');
    expect(run.isCurrent()).toBe(false);
    run.done();
  });

  it('invalidates in-flight runs without starting a new run', () => {
    const latest = createLatest();
    const run = latest.begin();
    latest.invalidate();

    expect(run.isCurrent()).toBe(false);
    expect(latest.pending()).toBe(1);
    run.done();
    expect(latest.pending()).toBe(0);
  });

  it('tracks pending() accurately and makes done() idempotent', () => {
    const latest = createLatest();
    expect(latest.pending()).toBe(0);

    const r1 = latest.begin();
    const r2 = latest.begin();
    expect(latest.pending()).toBe(2);

    r1.done();
    r1.done();
    expect(latest.pending()).toBe(1);

    r2.done();
    expect(latest.pending()).toBe(0);
  });

  it('keeps a single untouched run current (negative case)', () => {
    const latest = createLatest();
    const only = latest.begin();
    expect(only.isCurrent()).toBe(true);
    only.done();
    expect(latest.pending()).toBe(0);
  });

  describe('createLatestByKey', () => {
    it('invalidates per key while keeping other keys current', () => {
      const byKey = createLatestByKey();
      const a1 = byKey.begin('a');
      const b1 = byKey.begin('b');
      expect(a1.isCurrent()).toBe(true);
      expect(b1.isCurrent()).toBe(true);

      const a2 = byKey.begin('a');
      expect(a1.isCurrent()).toBe(false);
      expect(a2.isCurrent()).toBe(true);
      expect(b1.isCurrent()).toBe(true);

      byKey.invalidate('a');
      expect(a2.isCurrent()).toBe(false);
      expect(b1.isCurrent()).toBe(true);

      byKey.invalidate();
      expect(b1.isCurrent()).toBe(false);

      a1.done();
      a2.done();
      b1.done();
      expect(byKey.pending()).toBe(0);
    });

    it('evicts the oldest key when maxKeys is exceeded and treats its run as stale', () => {
      const byKey = createLatestByKey({ maxKeys: 2 });
      const k1 = byKey.begin('k1');
      const k2 = byKey.begin('k2');
      const k3 = byKey.begin('k3');

      expect(k1.isCurrent()).toBe(false);
      expect(k2.isCurrent()).toBe(true);
      expect(k3.isCurrent()).toBe(true);

      k1.done();
      k2.done();
      k3.done();
    });

    it('also invalidates keyed runs when accountEpoch advances', () => {
      const byKey = createLatestByKey();
      const run = byKey.begin('2026-11-21');
      resetAccountMemory('signed_out');
      expect(run.isCurrent()).toBe(false);
      run.done();
    });
  });
});
