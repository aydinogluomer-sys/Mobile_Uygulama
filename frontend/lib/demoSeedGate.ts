/**
 * F06 (NAV-01, PRF-03) — the ONE way to load the demo seeder, and only in a development build.
 *
 * `lib/demoSeed.ts` (660+ lines of fabricated projects, tasks, habits, logs and journal entries)
 * used to be imported statically by the login screen and by Settings, so it shipped in every
 * release bundle. Metro inlines `__DEV__` as `false` in a production transform and constant-folds
 * conditionals BEFORE it collects dependencies, so a `require` inside a folded-away branch never
 * enters the bundle.
 *
 * Why the require is inside `__DEV__ ? ... : null` and not just after the early return: constant
 * folding turns `if (!false) return null;` into `return null;` but does not delete the statements
 * after it -- terser does, AFTER dependencies were collected. With the plain form the gate became
 * `function(){return null}` and `./demoSeed` still shipped as one of its dependencies (seen in the
 * F06 release bundle check, docs/implementation-v3/STATE.md). `__tests__/repo/loginNoBypassInRelease.test.ts`
 * keeps every other import of it out and pins this form.
 */
export type DemoSeedModule = typeof import('./demoSeed');

/** The seeder module in a `__DEV__` build, null otherwise. */
export function loadDemoSeed(): DemoSeedModule | null {
  if (!__DEV__) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return __DEV__ ? (require('./demoSeed') as DemoSeedModule) : null;
}
