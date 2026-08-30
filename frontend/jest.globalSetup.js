/**
 * Pins the timezone BEFORE jest forks its workers.
 *
 * WHY THIS FILE EXISTS, and why `jest.setup.js` was not enough.
 *
 * `jest.setup.js` sets `process.env.TZ = 'Europe/Istanbul'` and its comment
 * says "set before any module - and therefore any Date - is loaded". That was
 * the intent; it is not what happens. `setupFiles` runs INSIDE an already-
 * running worker, and by then Node has resolved and cached the local zone, so
 * assigning `process.env.TZ` changes the variable and nothing else.
 *
 * The mechanism had therefore never worked — and nothing revealed it, because
 * the machine this project is developed on IS Europe/Istanbul. The pin was
 * invisibly redundant locally and inert in CI, so `date.test.ts` was passing
 * for the wrong reason on one machine and failing honestly on the other.
 * (`TZ=UTC npx jest __tests__/lib/date.test.ts` reproduces the CI failure on
 * any machine.)
 *
 * `globalSetup` runs once in the PARENT process before any worker is forked,
 * so the workers inherit `TZ` in their environment at spawn time and Node
 * initialises with the right zone instead of being told about it afterwards.
 *
 * The assignment is kept in `jest.setup.js` as well: `--runInBand` executes in
 * the parent, where no fork happens, and the parent's own zone may already be
 * cached. Neither location is redundant — and `date.test.ts`'s
 * `getTimezoneOffset() === -180` guard is what actually proves the zone took
 * effect, rather than either file's good intentions.
 */
module.exports = () => {
  process.env.TZ = 'Europe/Istanbul';
};
