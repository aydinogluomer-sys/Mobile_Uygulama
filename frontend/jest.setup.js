/**
 * Set before any module - and therefore any Date - is loaded.  (task 1E-L1)
 *
 * The date defects this suite exists to catch are timezone-dependent. Without a
 * pinned zone the 00:30 and 23:30 cases would pass or fail according to where
 * the machine is, which is the opposite of a regression test.
 */
process.env.TZ = 'Europe/Istanbul';
