export const SECURE_STORE_MAX_VALUE_BYTES = 2048;

export type SecureStoreFailRule = {
  op: 'get' | 'set' | 'delete' | 'any';
  match?: (key: string) => boolean;
  from?: number; // 1-based call index, inclusive (defaults to 1)
  until?: number; // inclusive (defaults to MAX_SAFE_INTEGER)
};

export type SecureStoreFakeModule = {
  WHEN_UNLOCKED: 1;
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2;
  AFTER_FIRST_UNLOCK: 3;
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 4;
  ALWAYS: 5;
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 6;
  ALWAYS_THIS_DEVICE_ONLY: 7;
  isAvailableAsync: jest.Mock<Promise<boolean>, []>;
  getItemAsync: jest.Mock<Promise<string | null>, [string, unknown?]>;
  setItemAsync: jest.Mock<Promise<void>, [string, string, unknown?]>;
  deleteItemAsync: jest.Mock<Promise<void>, [string, unknown?]>;
  __failWhen(rule: SecureStoreFailRule): void;
  __clearFailures(): void;
  __callCount(): number;
  __snapshot(): Record<string, string>;
  __resetForTests(): void;
};

export function createSecureStoreModule(): SecureStoreFakeModule {
  const store = new Map<string, string>();
  let calls = 0;
  let failRule: SecureStoreFailRule | null = null;

  const maybeFail = (op: 'get' | 'set' | 'delete', key: string) => {
    calls += 1;
    if (!failRule) return;
    const opOk = failRule.op === 'any' || failRule.op === op;
    const keyOk = !failRule.match || failRule.match(key);
    const from = failRule.from === undefined ? 1 : failRule.from;
    const until = failRule.until === undefined ? Number.MAX_SAFE_INTEGER : failRule.until;
    if (opOk && keyOk && calls >= from && calls <= until) {
      throw new Error(`SecureStore sahte hata: ${op} ${key}`);
    }
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
    getItemAsync: jest.fn(async (key: string) => {
      maybeFail('get', key);
      return store.has(key) ? (store.get(key) ?? null) : null;
    }),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      maybeFail('set', key);
      if (!/^[A-Za-z0-9._-]+$/.test(key)) {
        throw new Error(`Invalid SecureStore key: ${key}`);
      }
      const strVal = String(value);
      if (Buffer.byteLength(strVal, 'utf8') > SECURE_STORE_MAX_VALUE_BYTES) {
        throw new Error('Value being stored in SecureStore is larger than 2048 bytes');
      }
      store.set(key, strVal);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      maybeFail('delete', key);
      store.delete(key);
    }),
    __failWhen: (rule: SecureStoreFailRule) => {
      failRule = rule;
      calls = 0;
    },
    __clearFailures: () => {
      failRule = null;
      calls = 0;
    },
    __callCount: () => calls,
    __snapshot: () => Object.fromEntries(store),
    __resetForTests: () => {
      store.clear();
      calls = 0;
      failRule = null;
    },
  };
}
