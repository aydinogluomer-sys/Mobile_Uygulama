/**
 * Set before any module - and therefore any Date - is loaded.  (task 1E-L1)
 *
 * The date defects this suite exists to catch are timezone-dependent. Without a
 * pinned zone the 00:30 and 23:30 cases would pass or fail according to where
 * the machine is, which is the opposite of a regression test.
 */
process.env.TZ = 'Europe/Istanbul';
if (!process.env.EXPO_PUBLIC_SUPABASE_URL) {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
}
if (!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key-local';
}

/**
 * AsyncStorage is a native module; under jest there is no native side, so any
 * module that transitively imports a persisted zustand store throws on load.
 * The package ships an official in-memory mock for exactly this.  (task 1E-L1)
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

/**
 * Native hardware-backed storage & SQLite engines have no native JSI bridge in
 * Node/Jest. Provide deterministic in-memory implementations matching Expo SDK 57.
 */
jest.mock('expo-secure-store', () => {
  const store = new Map();
  // F06 (TST-08): failures can be injected, and the platform's 2048-byte value ceiling is enforced.
  //   __failWhen({ op: 'set'|'get'|'delete'|'any', match?: (key) => boolean, from?: n, until?: n })
  //     arms a rule and restarts the call counter; calls number from 1, `from`/`until` are inclusive.
  //   __clearFailures()  drops the rule and the counter;  __callCount()  calls so far;
  //   __snapshot()       a plain copy of everything stored.
  let calls = 0;
  let failRule = null;
  const maybeFail = (op, key) => {
    calls += 1;
    if (!failRule) return;
    const opOk = failRule.op === 'any' || failRule.op === op;
    const keyOk = !failRule.match || failRule.match(key);
    const from = failRule.from === undefined ? 1 : failRule.from;
    const until = failRule.until === undefined ? Number.MAX_SAFE_INTEGER : failRule.until;
    if (opOk && keyOk && calls >= from && calls <= until) {
      throw new Error('SecureStore sahte hata: ' + op + ' ' + key);
    }
  };
  const utf8Bytes = (s) => {
    let n = 0;
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1; }
      else n += 3;
    }
    return n;
  };
  return {
    WHEN_UNLOCKED: 1,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
    AFTER_FIRST_UNLOCK: 3,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 4,
    ALWAYS: 5,
    WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 6,
    ALWAYS_THIS_DEVICE_ONLY: 7,
    isAvailableAsync: jest.fn(async () => true),
    getItemAsync: jest.fn(async (key) => {
      maybeFail('get', key);
      return store.has(key) ? store.get(key) : null;
    }),
    setItemAsync: jest.fn(async (key, value) => {
      maybeFail('set', key);
      if (!/^[A-Za-z0-9._-]+$/.test(key)) {
        throw new Error(`Invalid SecureStore key: ${key}`);
      }
      if (utf8Bytes(String(value)) > 2048) {
        throw new Error('Value being stored in SecureStore is larger than 2048 bytes');
      }
      store.set(key, String(value));
    }),
    deleteItemAsync: jest.fn(async (key) => {
      maybeFail('delete', key);
      store.delete(key);
    }),
    __resetForTests: () => { store.clear(); calls = 0; failRule = null; },
    __failWhen: (rule) => { failRule = rule; calls = 0; },
    __clearFailures: () => { failRule = null; calls = 0; },
    __callCount: () => calls,
    __snapshot: () => Object.fromEntries(store),
  };
});

jest.mock('expo-sqlite', () => {
  const databases = new Map();
  function getTable(dbName) {
    if (!databases.has(dbName)) databases.set(dbName, new Map());
    return databases.get(dbName);
  }
  return {
    openDatabaseAsync: jest.fn(async (dbName) => {
      const table = getTable(dbName);
      return {
        execAsync: jest.fn(async (sql) => {
          if (/DELETE\s+FROM\s+read_cache\s*;?\s*$/i.test(sql.trim())) {
            table.clear();
          }
        }),
        runAsync: jest.fn(async (sql, params = []) => {
          const list = Array.isArray(params) ? params : [params];
          if (/INSERT\s+OR\s+REPLACE\s+INTO\s+read_cache/i.test(sql)) {
            const [user_id, cache_key, payload, updated_at] = list;
            table.set(`${user_id}::${cache_key}`, {
              user_id,
              cache_key,
              payload,
              updated_at,
            });
            return { changes: 1, lastInsertRowId: 1 };
          }
          if (/DELETE\s+FROM\s+read_cache\s+WHERE\s+user_id\s*=\s*\?\s+AND\s+cache_key\s*=\s*\?/i.test(sql)) {
            const [user_id, cache_key] = list;
            const existed = table.delete(`${user_id}::${cache_key}`);
            return { changes: existed ? 1 : 0, lastInsertRowId: 0 };
          }
          if (/DELETE\s+FROM\s+read_cache\s+WHERE\s+user_id\s*=\s*\?/i.test(sql)) {
            const [user_id] = list;
            let changes = 0;
            for (const [k, row] of table.entries()) {
              if (row.user_id === user_id) {
                table.delete(k);
                changes += 1;
              }
            }
            return { changes, lastInsertRowId: 0 };
          }
          return { changes: 0, lastInsertRowId: 0 };
        }),
        getFirstAsync: jest.fn(async (sql, params = []) => {
          const list = Array.isArray(params) ? params : [params];
          if (/SELECT\s+payload,\s*updated_at\s+FROM\s+read_cache/i.test(sql)) {
            const [user_id, cache_key] = list;
            const row = table.get(`${user_id}::${cache_key}`);
            return row ? { payload: row.payload, updated_at: row.updated_at } : null;
          }
          return null;
        }),
        getAllAsync: jest.fn(async () => Array.from(table.values())),
        closeAsync: jest.fn(async () => undefined),
      };
    }),
    __resetForTests: () => databases.clear(),
  };
});

/**
 * One message, filtered — not console.warn.
 *
 * `lib/notifications.ts` imports `expo-notifications`, whose
 * `DevicePushTokenAutoRegistration.fx` module warns AT IMPORT TIME that remote
 * push was removed from Expo Go in SDK 53. Five suites import it transitively,
 * so a green run ended with five copies of an eight-line warning about a
 * client this test run is not.
 *
 * It is filtered by its exact text rather than by silencing `console.warn`,
 * because the warnings worth having are the ones nobody predicted. Anything
 * else printed still comes through, and if this message ever stops being
 * emitted the filter simply stops matching — it cannot hide a different
 * warning that takes its place.
 *
 * Mocking `expo-notifications` outright was the other option and was rejected:
 * `__tests__/store/recoveryPersistence.test.ts` deliberately schedules through
 * the real module ("no ad-hoc mocking beyond the Supabase client"), and
 * replacing it would have quietly hollowed out that test.
 */
const EXPO_GO_PUSH_NOTICE =
  'expo-notifications: Android Push notifications (remote notifications) functionality provided by expo-notifications was removed from Expo Go';

const realWarn = console.warn.bind(console);
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes(EXPO_GO_PUSH_NOTICE)) return;
  realWarn(...args);
};
