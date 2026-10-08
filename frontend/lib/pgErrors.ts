/**
 * Postgres / PostgREST error codes the client branches on. Pure, so tests and
 * services can share the exact rule without pulling in the Supabase client.
 */

/** A table that does not exist yet (its migration has not run): PostgREST PGRST205, Postgres 42P01. */
export const isMissingTable = (code?: string) => code === 'PGRST205' || code === '42P01';
