const HELPER_RECIPES: Record<string, { helper: string; factory: string }> = {
  'expo-sqlite': { helper: 'sqliteAdapter', factory: 'createExpoSqliteModule' },
  'expo-secure-store': { helper: 'secureStoreFake', factory: 'createSecureStoreModule' },
};

export function unmockedNativeModule<T extends Record<string, unknown> = Record<string, unknown>>(
  moduleName: string,
  constants?: T,
): T {
  const base = (constants ? { ...constants } : {}) as T;
  const recipe = HELPER_RECIPES[moduleName] ?? {
    helper: `${moduleName}Fake`,
    factory: 'createFakeModule',
  };

  return new Proxy(base, {
    get(target, prop) {
      if (prop === '__esModule' || prop === 'then' || typeof prop === 'symbol') {
        return undefined;
      }
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return target[prop as keyof T];
      }
      return () => {
        throw new Error(
          `${moduleName} bu test dosyasında sahtelenmedi. Dosyanın başına şunu ekle: jest.mock('${moduleName}', () => require('../helpers/${recipe.helper}').${recipe.factory}());`,
        );
      };
    },
  });
}
