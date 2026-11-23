import { createSecureStoreModule, SECURE_STORE_MAX_VALUE_BYTES } from '../helpers/secureStoreFake';
import { createExpoSqliteModule } from '../helpers/sqliteAdapter';
import { unmockedNativeModule } from '../helpers/unmockedNativeModule';

describe('explicitFakes — sqliteAdapter, secureStoreFake & unmockedNativeModule (F48 C2)', () => {
  describe('sqliteAdapter (real sql.js WASM engine)', () => {
    const sqlite = createExpoSqliteModule();

    beforeEach(() => {
      sqlite.__resetForTests();
    });

    it('(+) CREATE TABLE IF NOT EXISTS is idempotent across repeated calls, INSERT OR REPLACE updates updated_at on same PK, and missing row returns null', async () => {
      const db = await sqlite.openDatabaseAsync('cache_test.db');
      const ddl =
        'CREATE TABLE IF NOT EXISTS read_cache (user_id TEXT NOT NULL, cache_key TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, cache_key));';

      await db.execAsync(ddl);
      await db.execAsync(ddl);
      expect(sqlite.__tables('cache_test.db')).toEqual(['read_cache']);

      const missing = await db.getFirstAsync('SELECT payload FROM read_cache WHERE user_id = ? AND cache_key = ?', [
        'u1',
        'k1',
      ]);
      expect(missing).toBeNull();

      const ins1 = await db.runAsync(
        'INSERT OR REPLACE INTO read_cache (user_id, cache_key, payload, updated_at) VALUES (?, ?, ?, ?)',
        ['u1', 'k1', '{"v":1}', 1000],
      );
      expect(ins1.changes).toBe(1);
      expect(ins1.lastInsertRowId).toBeGreaterThanOrEqual(1);

      const ins2 = await db.runAsync(
        'INSERT OR REPLACE INTO read_cache (user_id, cache_key, payload, updated_at) VALUES (?, ?, ?, ?)',
        ['u1', 'k1', '{"v":2}', 2000],
      );
      expect(ins2.changes).toBe(1);

      // Reopen after closeAsync preserves the database until __resetForTests()
      await db.closeAsync();
      const reopened = await sqlite.openDatabaseAsync('cache_test.db');
      const row = await reopened.getFirstAsync<{ payload: string; updated_at: number }>(
        'SELECT payload, updated_at FROM read_cache WHERE user_id = ? AND cache_key = ?',
        ['u1', 'k1'],
      );
      expect(row).toEqual({ payload: '{"v":2}', updated_at: 2000 });

      const all = await reopened.getAllAsync<{ user_id: string; cache_key: string }>(
        'SELECT user_id, cache_key FROM read_cache WHERE user_id = $uid',
        { uid: 'u1' },
      );
      expect(all).toEqual([{ user_id: 'u1', cache_key: 'k1' }]);
    });

    it('(-) rejects invalid SQL syntax with real SQLite engine error instead of silently returning 0/null', async () => {
      const db = await sqlite.openDatabaseAsync('syntax_err.db');
      await expect(db.execAsync('SELEC 1')).rejects.toThrow(/syntax error/i);
      await expect(db.runAsync('INSER INTO nope VALUES (1)')).rejects.toThrow(/syntax error/i);
      await expect(db.getFirstAsync('SELEC * FROM nope')).rejects.toThrow(/syntax error/i);
    });
  });

  describe('secureStoreFake (2048-byte limit, key charset, failure rules)', () => {
    const store = createSecureStoreModule();

    beforeEach(() => {
      store.__resetForTests();
    });

    it('(+) accepts an exact 2048-byte UTF-8 value and preserves round-trip + __snapshot', async () => {
      const exact2048 = 'a'.repeat(SECURE_STORE_MAX_VALUE_BYTES);
      expect(Buffer.byteLength(exact2048, 'utf8')).toBe(2048);

      await store.setItemAsync('valid.key_1-ok', exact2048);
      expect(await store.getItemAsync('valid.key_1-ok')).toBe(exact2048);
      expect(store.__snapshot()).toEqual({ 'valid.key_1-ok': exact2048 });
      expect(store.__callCount()).toBe(2);
    });

    it('(-) throws on a 2049-byte UTF-8 value (including multi-byte Turkish chars) and on invalid keys', async () => {
      const ascii2049 = 'x'.repeat(2049);
      await expect(store.setItemAsync('valid_key', ascii2049)).rejects.toThrow(/larger than 2048 bytes/);

      // 1025 x 2-byte 'ğ' = 2050 UTF-8 bytes (only 1025 UTF-16 code units!)
      const multibyte2050 = 'ğ'.repeat(1025);
      expect(multibyte2050.length).toBe(1025);
      expect(Buffer.byteLength(multibyte2050, 'utf8')).toBe(2050);
      await expect(store.setItemAsync('valid_key', multibyte2050)).rejects.toThrow(/larger than 2048 bytes/);

      await expect(store.setItemAsync('bad/key:colon', 'ok')).rejects.toThrow(/Invalid SecureStore key/);
    });

    it('(-) honours __failWhen inclusive [from, until] window and __clearFailures', async () => {
      store.__failWhen({ op: 'set', from: 2, until: 2 });
      await expect(store.setItemAsync('k1', 'v1')).resolves.toBeUndefined();
      await expect(store.setItemAsync('k2', 'v2')).rejects.toThrow(/SecureStore sahte hata/);
      await expect(store.setItemAsync('k3', 'v3')).resolves.toBeUndefined();
      store.__clearFailures();
      expect(store.__callCount()).toBe(0);
    });
  });

  describe('unmockedNativeModule', () => {
    it('(-) throws actionable Turkish guidance on method invocation while allowing constant reads, then, __esModule, and Symbol access', () => {
      const sqliteGuard = unmockedNativeModule<{ openDatabaseAsync: () => Promise<unknown> }>('expo-sqlite');
      expect((sqliteGuard as Record<string, unknown>).then).toBeUndefined();
      expect((sqliteGuard as Record<string, unknown>).__esModule).toBeUndefined();
      expect((sqliteGuard as Record<symbol, unknown>)[Symbol.toStringTag]).toBeUndefined();
      expect(() => sqliteGuard.openDatabaseAsync()).toThrow(
        /expo-sqlite bu test dosyasında sahtelenmedi.*sqliteAdapter.*createExpoSqliteModule/,
      );

      const secureGuard = unmockedNativeModule('expo-secure-store', {
        WHEN_UNLOCKED: 1,
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
      });
      expect(secureGuard.WHEN_UNLOCKED).toBe(1);
      expect(secureGuard.WHEN_UNLOCKED_THIS_DEVICE_ONLY).toBe(2);
      expect(() => (secureGuard as unknown as { getItemAsync: (k: string) => void }).getItemAsync('k')).toThrow(
        /expo-secure-store bu test dosyasında sahtelenmedi.*secureStoreFake.*createSecureStoreModule/,
      );
    });
  });
});
