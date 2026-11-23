import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  presentInLiveSchema,
  readMigrationStatuses,
  type MigrationStatus,
} from '../helpers/migrationStatus';
import { readSource } from '../helpers/sourceText';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const README_PATH = join(MIGRATIONS_DIR, 'README.md');

export function findMigrationConsistencyIssues(
  statuses: readonly MigrationStatus[],
  liveSchemaSql: string,
): string[] {
  const issues: string[] = [];
  for (const s of statuses) {
    if (s.header === 'UNMARKED') {
      issues.push(`${s.file}: missing STATUS: WRITTEN, NOT APPLIED or STATUS: APPLIED header`);
      continue;
    }
    if (s.readmeRow === 'MISSING') {
      issues.push(`${s.file}: missing row in supabase/migrations/README.md`);
      continue;
    }
    if (s.header !== s.readmeRow) {
      issues.push(`${s.file}: header is ${s.header} but README.md says ${s.readmeRow}`);
      continue;
    }
    for (const obj of s.objects) {
      const inLive = presentInLiveSchema(liveSchemaSql, obj);
      if (s.header === 'NOT APPLIED' && inLive) {
        issues.push(
          `${s.file}: marked NOT APPLIED, yet ${obj.kind} public.${obj.name} is present in live_schema.sql`,
        );
      } else if (s.header === 'APPLIED' && !inLive) {
        issues.push(
          `${s.file}: marked APPLIED, yet ${obj.kind} public.${obj.name} is missing from live_schema.sql`,
        );
      }
    }
  }
  return issues;
}

describe('F48 C9 (OD-07) — Migration Lifecycle Consistency (header ↔ README.md ↔ live_schema.sql)', () => {
  const liveSchemaSql = readSource('..', 'supabase', 'live_schema.sql');
  const statuses = readMigrationStatuses(MIGRATIONS_DIR, README_PATH);

  it('(+) all 028+ migrations have consistent header, README row, and live_schema.sql presence', () => {
    expect(statuses.length).toBeGreaterThanOrEqual(17);
    expect(statuses[0].number).toBe(28);
    expect(findMigrationConsistencyIssues(statuses, liveSchemaSql)).toEqual([]);
  });

  it('(+) passes cleanly when a migration transitions to APPLIED across header, README, and live_schema.sql', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-status-ok-'));
    try {
      writeFileSync(
        join(dir, '028_sample_feature.sql'),
        [
          '-- Migration 028: sample',
          '-- STATUS: APPLIED (2026-11-22)',
          'CREATE TABLE IF NOT EXISTS public.sample_items (id uuid PRIMARY KEY);',
          'CREATE OR REPLACE FUNCTION public.get_sample_items() RETURNS void LANGUAGE sql AS $$ SELECT; $$;',
        ].join('\n'),
        'utf8',
      );
      const readme = join(dir, 'README.md');
      writeFileSync(
        readme,
        '| # | File | Applied as |\n| --- | --- | --- |\n| 028 | `028_sample_feature.sql` | `20261122120000` |\n',
        'utf8',
      );
      const dumpedLive = [
        'CREATE TABLE IF NOT EXISTS "public"."sample_items" ("id" "uuid" NOT NULL);',
        'CREATE OR REPLACE FUNCTION "public"."get_sample_items"() RETURNS "void" LANGUAGE "sql" AS $$ SELECT; $$;',
      ].join('\n');

      const parsed = readMigrationStatuses(dir, readme);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].header).toBe('APPLIED');
      expect(parsed[0].readmeRow).toBe('APPLIED');
      expect(findMigrationConsistencyIssues(parsed, dumpedLive)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(-) flags a NOT APPLIED migration whose table or function is already in live_schema.sql', () => {
    const fakeDump = `${liveSchemaSql}\nCREATE OR REPLACE FUNCTION "public"."get_today_bootstrap"("p_today" "date") RETURNS "jsonb" LANGUAGE "plpgsql" AS $$ BEGIN RETURN '{}'::jsonb; END $$;`;
    const issues = findMigrationConsistencyIssues(statuses, fakeDump);
    expect(issues).toContain(
      '037_today_bootstrap_rpc.sql: marked NOT APPLIED, yet function public.get_today_bootstrap is present in live_schema.sql',
    );
  });

  it('(-) flags header vs README drift and missing README rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-status-bad-'));
    try {
      writeFileSync(
        join(dir, '037_today_bootstrap_rpc.sql'),
        '-- STATUS: APPLIED\nCREATE OR REPLACE FUNCTION public.get_today_bootstrap() RETURNS jsonb LANGUAGE sql AS $$ SELECT \'{}\'::jsonb $$;',
        'utf8',
      );
      writeFileSync(
        join(dir, '038_missing_readme.sql'),
        '-- STATUS: WRITTEN, NOT APPLIED\nSELECT 1;',
        'utf8',
      );
      const readme = join(dir, 'README.md');
      writeFileSync(
        readme,
        '| 037 | `037_today_bootstrap_rpc.sql` | **NOT APPLIED** (DB frozen) | — |\n',
        'utf8',
      );

      const parsed = readMigrationStatuses(dir, readme);
      const issues = findMigrationConsistencyIssues(parsed, '');
      expect(issues).toContain(
        '037_today_bootstrap_rpc.sql: header is APPLIED but README.md says NOT APPLIED',
      );
      expect(issues).toContain(
        '038_missing_readme.sql: missing row in supabase/migrations/README.md',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
