export type SerialRunner = <T>(key: string, run: () => Promise<T>) => Promise<T>;

export type SerialByKey = {
  run: SerialRunner;
  /** Uçuşta zinciri olan anahtar sayısı (sızıntı testi için; iş bitince 0 olur). */
  size(): number;
};

export function createSerialByKey(): SerialByKey {
  const tails = new Map<string, Promise<void>>();
  const run: SerialRunner = (key, fn) => {
    const prev = tails.get(key) ?? Promise.resolve();
    const result = prev.then(() => fn());
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
  return { run, size: () => tails.size };
}

/** Uygulama genelinde paylaşılan tekil: anahtarlar `goal:<id>`, `kr:<id>`, `reading:<id>`, `project:<id>` biçimindedir. */
export const serialByKey: SerialRunner = createSerialByKey().run;
