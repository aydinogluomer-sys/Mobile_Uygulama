import { accountEpoch } from './accountScope';

/** Bir isteğin ömrü. `await` sonrasındaki ilk satır `if (!run.isCurrent()) return;` olur. */
export type LatestRun = {
  /** Hâlâ en yeni çalıştırma mı VE `accountEpoch()` başladığı andakiyle aynı mı? */
  isCurrent(): boolean;
  /** İş bitti (başarılı, hatalı ya da bayat). Idempotent; `finally` içinde çağrılır. */
  done(): void;
};

export type Latest = {
  /** Yeni çalıştırma başlatır; öncekilerin hepsi bayatlar. */
  begin(): LatestRun;
  /** Yeni çalıştırma başlatmadan uçuştakileri bayatlatır. */
  invalidate(): void;
  /** `begin()` edilmiş ama `done()` edilmemiş çalıştırma sayısı (`loading` bayrağını kapatma kararı için). */
  pending(): number;
};

export function createLatest(): Latest {
  let seq = 0;
  let open = 0;
  return {
    begin() {
      const mine = ++seq;
      const epoch = accountEpoch();
      open += 1;
      let finished = false;
      return {
        isCurrent: () => mine === seq && epoch === accountEpoch(),
        done: () => {
          if (!finished) {
            finished = true;
            open -= 1;
          }
        },
      };
    },
    invalidate() {
      seq += 1;
    },
    pending: () => open,
  };
}

export type LatestByKey = {
  begin(key: string): LatestRun;
  /** `key` verilirse yalnız o anahtarı, verilmezse hepsini bayatlatır. */
  invalidate(key?: string): void;
  pending(): number;
};

/** `maxKeys` (varsayılan 256) aşılırsa en eski anahtar atılır; atılan anahtarın uçuşta kalmış çalıştırması bayat sayılır. */
export function createLatestByKey(opts?: { maxKeys?: number }): LatestByKey {
  const maxKeys = opts?.maxKeys ?? 256;
  let counter = 0;
  let open = 0;
  const latest = new Map<string, number>();
  return {
    begin(key) {
      const mine = ++counter;
      latest.delete(key);
      latest.set(key, mine);
      if (latest.size > maxKeys) latest.delete(latest.keys().next().value as string);
      const epoch = accountEpoch();
      open += 1;
      let finished = false;
      return {
        isCurrent: () => latest.get(key) === mine && epoch === accountEpoch(),
        done: () => {
          if (!finished) {
            finished = true;
            open -= 1;
          }
        },
      };
    },
    invalidate(key) {
      if (key === undefined) latest.clear();
      else latest.set(key, ++counter);
    },
    pending: () => open,
  };
}
