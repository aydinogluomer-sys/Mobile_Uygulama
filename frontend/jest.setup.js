/**
 * Set before any module - and therefore any Date - is loaded.  (task 1E-L1)
 *
 * The date defects this suite exists to catch are timezone-dependent. Without a
 * pinned zone the 00:30 and 23:30 cases would pass or fail according to where
 * the machine is, which is the opposite of a regression test.
 */
process.env.TZ = 'Europe/Istanbul';

/**
 * AsyncStorage is a native module; under jest there is no native side, so any
 * module that transitively imports a persisted zustand store throws on load.
 * The package ships an official in-memory mock for exactly this.  (task 1E-L1)
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
