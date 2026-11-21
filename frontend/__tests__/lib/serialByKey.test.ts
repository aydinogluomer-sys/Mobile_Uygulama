import { createSerialByKey, serialByKey } from '../../lib/serialByKey';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('serialByKey — per-entity write serialization', () => {
  it('runs jobs on the same key strictly one after another in start order', async () => {
    const serial = createSerialByKey();
    const events: string[] = [];
    const gate = deferred<string>();

    const first = serial.run('kr:1', async () => {
      events.push('start:1');
      const val = await gate.promise;
      events.push('end:1');
      return val;
    });

    const second = serial.run('kr:1', async () => {
      events.push('start:2');
      events.push('end:2');
      return 'second-ok';
    });

    await Promise.resolve();
    expect(events).toEqual(['start:1']);
    expect(serial.size()).toBe(1);

    gate.resolve('first-ok');
    await expect(first).resolves.toBe('first-ok');
    await expect(second).resolves.toBe('second-ok');
    expect(events).toEqual(['start:1', 'end:1', 'start:2', 'end:2']);

    await Promise.resolve();
    expect(serial.size()).toBe(0);
  });

  it('continues the chain when an earlier job rejects, and cleans up size() to 0', async () => {
    const serial = createSerialByKey();
    const gate = deferred<never>();

    const failing = serial.run('goal:9', () => gate.promise);
    const next = serial.run('goal:9', async () => 42);

    gate.reject(new Error('boom'));
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe(42);

    await Promise.resolve();
    expect(serial.size()).toBe(0);
  });

  it('does not block independent keys on each other (negative case)', async () => {
    const serial = createSerialByKey();
    const events: string[] = [];
    const slowA = deferred<number>();

    const pA = serial.run('goal:a', async () => {
      events.push('start:a');
      const out = await slowA.promise;
      events.push('end:a');
      return out;
    });

    const pB = serial.run('goal:b', async () => {
      events.push('start:b');
      events.push('end:b');
      return 2;
    });

    await expect(pB).resolves.toBe(2);
    expect(events).toEqual(['start:a', 'start:b', 'end:b']);

    slowA.resolve(1);
    await expect(pA).resolves.toBe(1);
    await Promise.resolve();
    expect(serial.size()).toBe(0);
  });

  it('exports a shared singleton serialByKey runner', async () => {
    const order: number[] = [];
    const g = deferred<void>();
    const p1 = serialByKey('project:shared', async () => {
      await g.promise;
      order.push(1);
    });
    const p2 = serialByKey('project:shared', async () => {
      order.push(2);
    });
    g.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });
});
