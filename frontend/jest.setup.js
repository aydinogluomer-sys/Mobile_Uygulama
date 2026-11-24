/**
 * Set before any module - and therefore any Date - is loaded.  (task 1E-L1)
 *
 * The date defects this suite exists to catch are timezone-dependent. Without a
 * pinned zone the 00:30 and 23:30 cases would pass or fail according to where
 * the machine is, which is the opposite of a regression test.
 */
process.env.TZ = process.env.TEST_TZ || 'Europe/Istanbul';
if (!process.env.EXPO_PUBLIC_SUPABASE_URL) {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
}
if (!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key-local';
}
if (!process.env.EXPO_PUBLIC_AI_TRANSPORT) {
  process.env.EXPO_PUBLIC_AI_TRANSPORT = 'invoke';
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
 * Node/Jest. F48 (TST-09, BLD-17): global silent regex fakes are replaced with
 * explicit opt-in per-test fakes (`secureStoreFake`, `sqliteAdapter`). Any test
 * that invokes `expo-secure-store` or `expo-sqlite` without declaring its fake
 * fails loudly with copy-pasteable `jest.mock(...)` instructions.
 */
jest.mock('expo-secure-store', () =>
  require('./__tests__/helpers/unmockedNativeModule').unmockedNativeModule('expo-secure-store', {
    WHEN_UNLOCKED: 1,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
    AFTER_FIRST_UNLOCK: 3,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 4,
    ALWAYS: 5,
    WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 6,
    ALWAYS_THIS_DEVICE_ONLY: 7,
  }));
jest.mock('expo-sqlite', () =>
  require('./__tests__/helpers/unmockedNativeModule').unmockedNativeModule('expo-sqlite'));

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
