import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { splitStatements } from './sqlSchemaParser';
import { stripSqlComments } from './sourceText';

export type MigrationObject = { kind: 'table' | 'function'; name: string };

export type MigrationStatus = {
  file: string;
  number: number;
  header: 'APPLIED' | 'NOT APPLIED' | 'UNMARKED';
  readmeRow: 'APPLIED' | 'NOT APPLIED' | 'MISSING';
  objects: MigrationObject[];
};

function parseHeaderStatus(rawSql: string): 'APPLIED' | 'NOT APPLIED' | 'UNMARKED' {
  if (/STATUS:\s*(?:WRITTEN,\s*)?NOT\s+APPLIED\b/i.test(rawSql)) {
    return 'NOT APPLIED';
  }
  if (/STATUS:\s*APPLIED\b/i.test(rawSql)) {
    return 'APPLIED';
  }
  return 'UNMARKED';
}

function parseReadmeRowStatus(readme: string, file: string): 'APPLIED' | 'NOT APPLIED' | 'MISSING' {
  const lines = readme.replace(/\r\n?/g, '\n').split('\n');
  const needle = `\`${file}\``;
  const row = lines.find((l) => l.trim().startsWith('|') && l.includes(needle));
  if (!row) return 'MISSING';

  const cells = row
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
  const appliedCell = cells[2] ?? '';
  if (/\bNOT\s+APPLIED\b/i.test(appliedCell)) {
    return 'NOT APPLIED';
  }
  if (/\bAPPLIED\b/i.test(appliedCell) || /`\d{8,14}`/.test(appliedCell)) {
    return 'APPLIED';
  }
  return 'MISSING';
}

function rollbackDroppedFunctions(rollbacksDir: string, migrationFile: string): Set<string> | null {
  const rbPath = join(rollbacksDir, migrationFile.replace(/\.sql$/, '.rollback.sql'));
  if (!existsSync(rbPath)) return null;
  const clean = stripSqlComments(readFileSync(rbPath, 'utf8'));
  const dropped = new Set<string>();
  const re = /\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*(?:\(|;|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    dropped.add(m[1].toLowerCase());
  }
  return dropped;
}

function extractStatementsObjects(rawSql: string): MigrationObject[] {
  const objs: MigrationObject[] = [];
  for (const stmt of splitStatements(rawSql)) {
    if (/^CREATE\s+(?:TEMP|TEMPORARY)\s+TABLE\b/i.test(stmt)) continue;

    const tbl = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(
      stmt,
    );
    if (tbl) {
      const schema = (tbl[1] ?? 'public').toLowerCase();
      if (schema === 'public') {
        objs.push({ kind: 'table', name: tbl[2].toLowerCase() });
      }
      continue;
    }

    const fn = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(
      stmt,
    );
    if (fn) {
      const schema = (fn[1] ?? 'public').toLowerCase();
      if (schema === 'public') {
        objs.push({ kind: 'function', name: fn[2].toLowerCase() });
      }
    }
  }
  return objs;
}

export function readMigrationStatuses(migrationsDir: string, readmePath: string): MigrationStatus[] {
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
  const rollbacksDir = join(migrationsDir, '..', 'rollbacks');

  const allFiles = readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();

  const seenTables = new Set<string>();
  const seenFunctions = new Set<string>();
  const results: MigrationStatus[] = [];

  for (const file of allFiles) {
    const num = Number(file.slice(0, 3));
    const raw = readFileSync(join(migrationsDir, file), 'utf8');
    const stmtObjects = extractStatementsObjects(raw);

    if (num < 28) {
      for (const o of stmtObjects) {
        if (o.kind === 'table') seenTables.add(o.name);
        else seenFunctions.add(o.name);
      }
      continue;
    }

    const rbDrops = rollbackDroppedFunctions(rollbacksDir, file);
    const newlyIntroduced: MigrationObject[] = [];

    for (const o of stmtObjects) {
      if (o.kind === 'table') {
        if (!seenTables.has(o.name)) {
          newlyIntroduced.push(o);
          seenTables.add(o.name);
        }
      } else {
        const alreadySeen = seenFunctions.has(o.name);
        const isNewInRollback = rbDrops === null ? true : rbDrops.has(o.name);
        if (!alreadySeen && isNewInRollback) {
          newlyIntroduced.push(o);
        }
        seenFunctions.add(o.name);
      }
    }

    results.push({
      file,
      number: num,
      header: parseHeaderStatus(raw),
      readmeRow: parseReadmeRowStatus(readme, file),
      objects: newlyIntroduced,
    });
  }

  return results;
}

export function presentInLiveSchema(liveSchemaSql: string, obj: MigrationObject): boolean {
  const clean = stripSqlComments(liveSchemaSql);
  const escaped = obj.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (obj.kind === 'table') {
    const re = new RegExp(
      `\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"public"\\.|public\\.)?"?${escaped}"?\\s*\\(`,
      'i',
    );
    return re.test(clean);
  }
  const re = new RegExp(
    `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:"public"\\.|public\\.)?"?${escaped}"?\\s*\\(`,
    'i',
  );
  return re.test(clean);
}
