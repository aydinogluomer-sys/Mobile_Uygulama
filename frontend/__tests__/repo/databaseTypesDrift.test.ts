import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import {
  applyStatement,
  buildSchemaModel,
  liveSchemaSource,
  migrationSources,
  parseColumnDefinition,
  renderTableBlock,
  splitStatements,
  splitTopLevel,
  tsCategoryOfSqlType,
  type SqlModel,
  type SqlTable,
} from '../helpers/sqlSchemaParser';

type TsColumn = { name: string; typeText: string; optional: boolean; tag: string | null };
type TsTable = {
  name: string;
  tag: string | null;
  row: Map<string, TsColumn>;
  insertOptional: Map<string, boolean>;
  updateKeys: Set<string>;
};
type TsFunction = { name: string; tag: string | null };
type TsModel = { tables: Map<string, TsTable>; functions: Map<string, TsFunction> };

type DriftKind =
  | 'table-missing-in-types'
  | 'table-missing-in-sql'
  | 'tag-missing'
  | 'tag-wrong'
  | 'column-missing-in-types'
  | 'column-missing-in-sql'
  | 'column-tag'
  | 'nullability'
  | 'type-category'
  | 'insert-requiredness'
  | 'update-keys'
  | 'function-missing-in-sql'
  | 'function-tag'
  | 'omission-stale'
  | 'dynamic-ddl';

type DriftIssue = { kind: DriftKind; where: string; detail: string };

/** Live tables the client types deliberately omit -> the guard that enforces the omission. */
const INTENTIONAL_TYPE_OMISSIONS: Readonly<Record<string, string>> = {
  daily_capacity: 'frontend/__tests__/repo/capacitySingleSourceOfTruth.test.ts',
};

const REPO_ROOT = join(__dirname, '..', '..', '..');
const DB_TYPES_PATH = join(REPO_ROOT, 'frontend', 'lib', 'database.types.ts');

const SOURCE_TAG_LINE_RE = /^\s*\/\/\s*@source\s+(live|migration:\d{3})\s*$/;
const ANY_SOURCE_TAG_RE = /^\s*\/\/\s*@source\b/;

function propNameOf(nameNode: ts.PropertyName, sf: ts.SourceFile): string {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }
  return nameNode.getText(sf);
}

function readLeadingSourceTag(sourceText: string, node: ts.Node): string | null {
  const ranges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  const found: string[] = [];
  for (const r of ranges) {
    const raw = sourceText.slice(r.pos, r.end);
    for (const line of raw.split(/\r?\n/)) {
      const valid = line.match(SOURCE_TAG_LINE_RE);
      if (valid) {
        found.push(valid[1]);
      } else if (ANY_SOURCE_TAG_RE.test(line)) {
        found.push(`INVALID(${line.trim()})`);
      }
    }
  }
  if (found.length === 0) return null;
  if (found.length > 1) return `DUPLICATE(${found.join(', ')})`;
  return found[0];
}

function findPropertyLiteral(lit: ts.TypeLiteralNode, name: string, sf: ts.SourceFile): ts.TypeLiteralNode | null {
  for (const m of lit.members) {
    if (ts.isPropertySignature(m) && propNameOf(m.name, sf) === name && m.type && ts.isTypeLiteralNode(m.type)) {
      return m.type;
    }
  }
  return null;
}

/** typescript AST over the source text; tags are read from the `// @source live` / `// @source migration:<NNN>` comment above each member. */
function readDatabaseTypes(sourceText: string): TsModel {
  const sf = ts.createSourceFile('database.types.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tables = new Map<string, TsTable>();
  const functions = new Map<string, TsFunction>();

  let dbLiteral: ts.TypeLiteralNode | null = null;
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'Database' && ts.isTypeLiteralNode(stmt.type)) {
      dbLiteral = stmt.type;
      break;
    }
  }
  if (!dbLiteral) return { tables, functions };

  const publicLit = findPropertyLiteral(dbLiteral, 'public', sf);
  if (!publicLit) return { tables, functions };

  const tablesLit = findPropertyLiteral(publicLit, 'Tables', sf);
  if (tablesLit) {
    for (const member of tablesLit.members) {
      if (!ts.isPropertySignature(member) || !member.type || !ts.isTypeLiteralNode(member.type)) continue;
      const tName = propNameOf(member.name, sf);
      const tag = readLeadingSourceTag(sourceText, member);
      const row = new Map<string, TsColumn>();
      const insertOptional = new Map<string, boolean>();
      const updateKeys = new Set<string>();

      const rowLit = findPropertyLiteral(member.type, 'Row', sf);
      if (rowLit) {
        for (const col of rowLit.members) {
          if (!ts.isPropertySignature(col)) continue;
          const cName = propNameOf(col.name, sf);
          const typeText = col.type ? sourceText.slice(col.type.getStart(sf), col.type.getEnd()).trim() : 'unknown';
          row.set(cName, {
            name: cName,
            typeText,
            optional: Boolean(col.questionToken),
            tag: readLeadingSourceTag(sourceText, col),
          });
        }
      }

      const insertLit = findPropertyLiteral(member.type, 'Insert', sf);
      if (insertLit) {
        for (const col of insertLit.members) {
          if (!ts.isPropertySignature(col)) continue;
          insertOptional.set(propNameOf(col.name, sf), Boolean(col.questionToken));
        }
      }

      const updateLit = findPropertyLiteral(member.type, 'Update', sf);
      if (updateLit) {
        for (const col of updateLit.members) {
          if (!ts.isPropertySignature(col)) continue;
          // Only optional Update properties satisfy the Partial<Row> Update invariant.
          if (col.questionToken) {
            updateKeys.add(propNameOf(col.name, sf));
          }
        }
      }

      tables.set(tName, { name: tName, tag, row, insertOptional, updateKeys });
    }
  }

  const fnsLit = findPropertyLiteral(publicLit, 'Functions', sf);
  if (fnsLit) {
    for (const member of fnsLit.members) {
      if (!ts.isPropertySignature(member)) continue;
      const fnName = propNameOf(member.name, sf);
      functions.set(fnName, { name: fnName, tag: readLeadingSourceTag(sourceText, member) });
    }
  }

  return { tables, functions };
}

function parseTsTypeCategory(typeText: string): { nullable: boolean; category: string } {
  const arms = typeText
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const nullable = arms.includes('null');
  const nonNull = arms.filter((a) => a !== 'null');

  if (nonNull.length === 1) {
    const arm = nonNull[0];
    if (
      arm === 'string' ||
      arm === 'number' ||
      arm === 'boolean' ||
      arm === 'Json' ||
      arm === 'string[]' ||
      arm === 'number[]'
    ) {
      return { nullable, category: arm };
    }
    if (/^'[^']*'$/.test(arm)) {
      return { nullable, category: 'string' };
    }
    return { nullable, category: `other:${arm}` };
  }

  if (nonNull.length > 1 && nonNull.every((a) => /^'[^']*'$/.test(a))) {
    return { nullable, category: 'string' };
  }

  return { nullable, category: `other:${nonNull.join(' | ')}` };
}

function diffSchemas(
  sql: SqlModel,
  tsModel: TsModel,
  omissions: Readonly<Record<string, string>>,
): DriftIssue[] {
  const issues: DriftIssue[] = [];

  for (const dyn of sql.dynamicDdl) {
    issues.push({
      kind: 'dynamic-ddl',
      where: dyn.file,
      detail: `unmodeled dynamic DDL inside DO block: ${dyn.snippet}`,
    });
  }

  for (const [omittedTable, guardRel] of Object.entries(omissions)) {
    const sqlTbl = sql.tables.get(omittedTable);
    if (!sqlTbl || sqlTbl.source !== 'live') {
      issues.push({
        kind: 'omission-stale',
        where: omittedTable,
        detail: `${omittedTable} is in INTENTIONAL_TYPE_OMISSIONS but is not a live table in SQL`,
      });
      continue;
    }
    if (tsModel.tables.has(omittedTable)) {
      issues.push({
        kind: 'omission-stale',
        where: omittedTable,
        detail: `${omittedTable} is in INTENTIONAL_TYPE_OMISSIONS (guarded by ${guardRel}) yet appears in database.types.ts`,
      });
      continue;
    }
    const guardPath = join(REPO_ROOT, ...guardRel.split('/'));
    if (!existsSync(guardPath) || !readFileSync(guardPath, 'utf8').includes(omittedTable)) {
      issues.push({
        kind: 'omission-stale',
        where: omittedTable,
        detail: `guard file ${guardRel} is missing or no longer mentions ${omittedTable}`,
      });
    }
  }

  for (const [tName, sqlTable] of sql.tables) {
    if (Object.prototype.hasOwnProperty.call(omissions, tName)) continue;
    if (!tsModel.tables.has(tName)) {
      issues.push({
        kind: 'table-missing-in-types',
        where: tName,
        detail: `table ${tName} (${sqlTable.source}) is missing from database.types.ts; paste:\n${renderTableBlock(sqlTable, sqlTable.source)}`,
      });
    }
  }

  for (const [tName, tsTable] of tsModel.tables) {
    if (Object.prototype.hasOwnProperty.call(omissions, tName)) continue;
    const sqlTable = sql.tables.get(tName);
    if (!sqlTable) {
      const moved = sql.movedOut.get(tName);
      issues.push({
        kind: 'table-missing-in-sql',
        where: tName,
        detail: moved
          ? `table ${tName} moved to schema ${moved} and is no longer exposed in public`
          : `table ${tName} is in database.types.ts but not in public SQL schema`,
      });
      continue;
    }

    if (tsTable.tag === null) {
      issues.push({
        kind: 'tag-missing',
        where: tName,
        detail: `expected // @source ${sqlTable.source} above ${tName}`,
      });
    } else if (tsTable.tag !== sqlTable.source) {
      issues.push({
        kind: 'tag-wrong',
        where: tName,
        detail: `${tName}: expected ${sqlTable.source}, found ${tsTable.tag}`,
      });
    }

    for (const [cName, sqlCol] of sqlTable.columns) {
      if (!tsTable.row.has(cName)) {
        issues.push({
          kind: 'column-missing-in-types',
          where: `${tName}.${cName}`,
          detail: `column ${tName}.${cName} (${sqlCol.sqlType}, ${sqlCol.source}) is missing from Row`,
        });
      }
    }

    for (const [cName] of tsTable.row) {
      if (!sqlTable.columns.has(cName)) {
        issues.push({
          kind: 'column-missing-in-sql',
          where: `${tName}.${cName}`,
          detail: `column ${tName}.${cName} is in database.types.ts Row but not in SQL`,
        });
      }
    }

    for (const [cName, sqlCol] of sqlTable.columns) {
      const tsCol = tsTable.row.get(cName);
      if (!tsCol) continue;

      if (sqlCol.source !== sqlTable.source) {
        if (tsCol.tag !== sqlCol.source) {
          issues.push({
            kind: 'column-tag',
            where: `${tName}.${cName}`,
            detail: `late column ${tName}.${cName} requires // @source ${sqlCol.source}, found ${tsCol.tag ?? 'none'}`,
          });
        }
      } else if (tsCol.tag !== null && tsCol.tag !== sqlCol.source) {
        issues.push({
          kind: 'column-tag',
          where: `${tName}.${cName}`,
          detail: `column ${tName}.${cName} tag ${tsCol.tag} disagrees with ${sqlCol.source}`,
        });
      }

      const parsed = parseTsTypeCategory(tsCol.typeText);
      const expectedNullable = !sqlCol.notNull;
      if (parsed.nullable !== expectedNullable || tsCol.optional) {
        issues.push({
          kind: 'nullability',
          where: `${tName}.${cName}`,
          detail: `SQL notNull=${sqlCol.notNull} vs TS Row ${tsCol.optional ? '(optional) ' : ''}${tsCol.typeText}`,
        });
      }

      const expectedCat = tsCategoryOfSqlType(sqlCol.sqlType);
      if (parsed.category !== expectedCat) {
        issues.push({
          kind: 'type-category',
          where: `${tName}.${cName}`,
          detail: `SQL ${sqlCol.sqlType} (${expectedCat}) vs TS ${tsCol.typeText} (${parsed.category})`,
        });
      }

      const expectedInsertOpt = !sqlCol.notNull || sqlCol.hasDefault;
      const actualInsertOpt = tsTable.insertOptional.get(cName);
      if (actualInsertOpt === undefined || actualInsertOpt !== expectedInsertOpt) {
        issues.push({
          kind: 'insert-requiredness',
          where: `${tName}.${cName}`,
          detail: `Insert ${tName}.${cName} expected optional=${expectedInsertOpt} (notNull=${sqlCol.notNull}, hasDefault=${sqlCol.hasDefault}), found optional=${String(actualInsertOpt)}`,
        });
      }
    }

    const rowKeyList = [...tsTable.row.keys()].sort();
    const updateKeyList = [...tsTable.updateKeys].sort();
    if (
      rowKeyList.length !== updateKeyList.length ||
      rowKeyList.some((k, idx) => k !== updateKeyList[idx])
    ) {
      issues.push({
        kind: 'update-keys',
        where: tName,
        detail: `Update keys [${updateKeyList.join(', ')}] do not match optional Row keys [${rowKeyList.join(', ')}]`,
      });
    }
  }

  for (const [fnName, tsFn] of tsModel.functions) {
    const sqlFn = sql.functions.get(fnName);
    if (!sqlFn) {
      issues.push({
        kind: 'function-missing-in-sql',
        where: `rpc:${fnName}`,
        detail: `RPC ${fnName} is in database.types.ts Functions but not in public SQL`,
      });
      continue;
    }
    if (tsFn.tag === null) {
      issues.push({
        kind: 'tag-missing',
        where: `rpc:${fnName}`,
        detail: `expected // @source ${sqlFn.source} above RPC ${fnName}`,
      });
    } else if (tsFn.tag !== sqlFn.source) {
      issues.push({
        kind: 'function-tag',
        where: `rpc:${fnName}`,
        detail: `RPC ${fnName}: expected ${sqlFn.source}, found ${tsFn.tag}`,
      });
    }
  }

  return issues;
}

function formatIssues(issues: readonly DriftIssue[]): string[] {
  return issues.map((i) => `[${i.kind}] ${i.where}: ${i.detail}`);
}

describe('sqlSchemaParser', () => {
  it('P1: parses pg_dump CREATE TABLE columns and skips table CONSTRAINT items', () => {
    const model = buildSchemaModel([
      {
        label: 'live',
        file: 'synthetic.sql',
        text: 'CREATE TABLE IF NOT EXISTS "public"."t" ("id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL, "n" integer, CONSTRAINT "c" CHECK (("n" > 0)));',
      },
    ]);
    const t = model.tables.get('t')!;
    expect(t).toBeDefined();
    expect([...t.columns.keys()]).toEqual(['id', 'n']);
    expect(t.columns.get('id')).toEqual({
      name: 'id',
      sqlType: 'uuid',
      notNull: true,
      hasDefault: true,
      source: 'live',
    });
    expect(t.columns.get('n')).toEqual({
      name: 'n',
      sqlType: 'integer',
      notNull: false,
      hasDefault: false,
      source: 'live',
    });
  });

  it('P2: does not confuse column names starting with check/unique with table constraints', () => {
    const c1 = parseColumnDefinition('checked_at timestamptz NOT NULL DEFAULT now()');
    const c2 = parseColumnDefinition('unique_key text');
    expect(c1).toEqual({ name: 'checked_at', sqlType: 'timestamptz', notNull: true, hasDefault: true });
    expect(c2).toEqual({ name: 'unique_key', sqlType: 'text', notNull: false, hasDefault: false });
  });

  it('P3: models ADD COLUMN IF NOT EXISTS with migration provenance and idempotency', () => {
    const model = buildSchemaModel([
      { label: 'live', file: 'live.sql', text: 'CREATE TABLE public.habit_logs (id uuid NOT NULL);' },
      { label: 'migration:033', file: '033.sql', text: 'ALTER TABLE public.habit_logs ADD COLUMN IF NOT EXISTS tz text;' },
      { label: 'migration:034', file: '034.sql', text: 'ALTER TABLE public.habit_logs ADD COLUMN IF NOT EXISTS tz text;' },
    ]);
    const cols = model.tables.get('habit_logs')!.columns;
    expect([...cols.keys()]).toEqual(['id', 'tz']);
    expect(cols.get('tz')).toEqual({
      name: 'tz',
      sqlType: 'text',
      notNull: false,
      hasDefault: false,
      source: 'migration:033',
    });
  });

  it('P4: removes tables moved out of public with SET SCHEMA or dropped with DROP TABLE', () => {
    const model = buildSchemaModel([
      {
        label: 'live',
        file: 'live.sql',
        text: 'CREATE TABLE public.t1 (id uuid NOT NULL); CREATE TABLE public.t2 (id uuid NOT NULL);',
      },
      {
        label: 'migration:040',
        file: '040.sql',
        text: 'ALTER TABLE public.t1 SET SCHEMA archive_f13; DROP TABLE IF EXISTS public.t2;',
      },
    ]);
    expect(model.tables.has('t1')).toBe(false);
    expect(model.tables.has('t2')).toBe(false);
    expect(model.movedOut.get('t1')).toBe('archive_f13');
  });

  it('P5: accepts multi-action DROP/ADD CONSTRAINT and rejects unmodeled ALTER TABLE actions', () => {
    const model = buildSchemaModel([
      { label: 'live', file: 'live.sql', text: 'CREATE TABLE public.tasks (id uuid NOT NULL, parent_task_id uuid);' },
      {
        label: 'migration:041',
        file: '041.sql',
        text: 'ALTER TABLE public.tasks DROP CONSTRAINT x, ADD CONSTRAINT x FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;',
      },
    ]);
    expect(model.tables.get('tasks')!.columns.size).toBe(2);
    expect(() =>
      applyStatement(model, 'ALTER TABLE public.tasks SET UNLOGGED;', 'migration:042', '042.sql'),
    ).toThrow(/unsupported DDL on tasks/);
  });

  it('P6: keeps dollar-quoted function bodies intact and records only public functions', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION "public"."f"() RETURNS void LANGUAGE plpgsql AS $function$ BEGIN PERFORM 1; END $function$;',
      'CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid(); $$;',
    ].join('\n');
    expect(splitStatements(sql)).toHaveLength(2);
    const model = buildSchemaModel([{ label: 'live', file: 'live.sql', text: sql }]);
    expect([...model.functions.keys()]).toEqual(['f']);
  });

  it('P7: ignores DDL hidden inside line comments, block comments, and string literals', () => {
    const model = buildSchemaModel([
      {
        label: 'live',
        file: 'live.sql',
        text: [
          'CREATE TABLE public.t (id uuid NOT NULL);',
          '-- CREATE TABLE public.hayalet (id uuid);',
          '/* CREATE TABLE public.hayalet2 (id uuid); */',
          "SELECT '; DROP TABLE public.t;';",
        ].join('\n'),
      },
    ]);
    expect([...model.tables.keys()]).toEqual(['t']);
  });

  it('P8: does not split on commas inside numeric(12,2)', () => {
    const items = splitTopLevel('price numeric(12,2) NOT NULL, label text');
    expect(items).toHaveLength(2);
    expect(parseColumnDefinition(items[0])).toEqual({
      name: 'price',
      sqlType: 'numeric(12,2)',
      notNull: true,
      hasDefault: false,
    });
    expect(parseColumnDefinition(items[1])).toEqual({
      name: 'label',
      sqlType: 'text',
      notNull: false,
      hasDefault: false,
    });
  });

  it('P9: marks composite PRIMARY KEY columns notNull while leaving FOREIGN KEY / UNIQUE nullable', () => {
    const model = buildSchemaModel([
      {
        label: 'live',
        file: 'live.sql',
        text: [
          'CREATE TABLE public.t (a uuid, b integer, c uuid, d text);',
          'ALTER TABLE ONLY public.t ADD CONSTRAINT t_pkey PRIMARY KEY (a, b);',
          'ALTER TABLE ONLY public.t ADD CONSTRAINT t_uk UNIQUE (d);',
          'ALTER TABLE ONLY public.t ADD CONSTRAINT t_fk FOREIGN KEY (c) REFERENCES public.t(a);',
        ].join('\n'),
      },
    ]);
    const t = model.tables.get('t')!;
    expect(t.columns.get('a')!.notNull).toBe(true);
    expect(t.columns.get('b')!.notNull).toBe(true);
    expect(t.columns.get('c')!.notNull).toBe(false);
    expect(t.columns.get('d')!.notNull).toBe(false);
  });

  it('P10: maps known SQL types to TS categories and throws on unknown SQL types', () => {
    expect(tsCategoryOfSqlType('uuid')).toBe('string');
    expect(tsCategoryOfSqlType('numeric(12,2)')).toBe('number');
    expect(tsCategoryOfSqlType('timestamp with time zone')).toBe('string');
    expect(tsCategoryOfSqlType('jsonb')).toBe('Json');
    expect(tsCategoryOfSqlType('text[]')).toBe('string[]');
    expect(tsCategoryOfSqlType('integer[]')).toBe('number[]');
    expect(tsCategoryOfSqlType('boolean')).toBe('boolean');
    expect(() => tsCategoryOfSqlType('geometry')).toThrow(/unknown SQL type geometry/);
  });

  it('P11: renders a ready-to-paste Row/Insert/Update block with exact optionality', () => {
    const table: SqlTable = {
      name: 'sample_items',
      source: 'migration:099',
      columns: new Map([
        ['id', { name: 'id', sqlType: 'uuid', notNull: true, hasDefault: true, source: 'migration:099' }],
        ['title', { name: 'title', sqlType: 'text', notNull: true, hasDefault: false, source: 'migration:099' }],
        ['note', { name: 'note', sqlType: 'text', notNull: false, hasDefault: false, source: 'migration:099' }],
      ]),
    };
    expect(renderTableBlock(table, 'migration:099')).toBe(
      [
        '      // @source migration:099',
        '      sample_items: {',
        '        Row: {',
        '          id: string;',
        '          title: string;',
        '          note: string | null;',
        '        };',
        '        Insert: {',
        '          id?: string;',
        '          title: string;',
        '          note?: string | null;',
        '        };',
        '        Update: {',
        '          id?: string;',
        '          title?: string;',
        '          note?: string | null;',
        '        };',
        '        Relationships: [];',
        '      };',
      ].join('\n'),
    );
  });

  it('P12: produces identical models for CRLF and LF inputs and loads migrations >= 028 ascending', () => {
    const lf = 'CREATE TABLE public.t (\n  id uuid NOT NULL,\n  label text\n);\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(buildSchemaModel([{ label: 'live', file: 'lf.sql', text: lf }])).toEqual(
      buildSchemaModel([{ label: 'live', file: 'crlf.sql', text: crlf }]),
    );

    const migs = migrationSources(REPO_ROOT);
    expect(migs.length).toBeGreaterThanOrEqual(14);
    expect(migs[0].label).toBe('migration:028');
    const nums = migs.map((m) => Number(m.label.split(':')[1]));
    expect(nums.every((n) => n >= 28)).toBe(true);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });

  it('P13: flags table/column DDL inside DO blocks while allowing policy/index DO blocks', () => {
    const bad = buildSchemaModel([
      { label: 'migration:099', file: '099.sql', text: 'DO $$ BEGIN ALTER TABLE public.t ADD COLUMN x int; END $$;' },
    ]);
    expect(bad.dynamicDdl).toHaveLength(1);
    expect(bad.dynamicDdl[0].file).toBe('099.sql');

    const benign = buildSchemaModel([
      {
        label: 'migration:041',
        file: '041.sql',
        text: "DO $f10$ BEGIN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_t ON public.t (id)'; EXECUTE 'ALTER POLICY p ON public.t USING (true)'; END $f10$;",
      },
    ]);
    expect(benign.dynamicDdl).toEqual([]);
  });

  it('P14: honours square brackets in ARRAY[...] defaults when splitting columns', () => {
    const cols = splitTopLevel(
      `"event_types" "text"[] DEFAULT ARRAY['a'::"text", 'b'::"text"] NOT NULL, "x" integer`,
    );
    expect(cols).toHaveLength(2);
    expect(parseColumnDefinition(cols[0])).toEqual({
      name: 'event_types',
      sqlType: 'text[]',
      notNull: true,
      hasDefault: true,
    });
  });

  it('P15: marks pg_dump late ALTER COLUMN SET DEFAULT nextval(...) as hasDefault=true', () => {
    const model = buildSchemaModel([
      {
        label: 'live',
        file: 'live.sql',
        text: [
          'CREATE TABLE IF NOT EXISTS "public"."skills" ("id" integer NOT NULL);',
          `ALTER TABLE ONLY "public"."skills" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."skills_id_seq"'::"regclass");`,
        ].join('\n'),
      },
    ]);
    expect(model.tables.get('skills')!.columns.get('id')).toEqual({
      name: 'id',
      sqlType: 'integer',
      notNull: true,
      hasDefault: true,
      source: 'live',
    });
  });
});

describe('database.types.ts ↔ SQL', () => {
  const sqlModel = buildSchemaModel([liveSchemaSource(REPO_ROOT), ...migrationSources(REPO_ROOT)]);
  const dbTypesRaw = readFileSync(DB_TYPES_PATH, 'utf8');
  const tsModel = readDatabaseTypes(dbTypesRaw);
  const allIssues = diffSchemas(sqlModel, tsModel, INTENTIONAL_TYPE_OMISSIONS);

  it('D1: scan is non-blind (finds >= 50 live tables, >= 10 pending tables, >= 60 typed tables, >= 10 RPCs)', () => {
    const liveTables = [...sqlModel.tables.values()].filter((t) => t.source === 'live');
    const pendingTables = [...sqlModel.tables.values()].filter((t) => t.source !== 'live');
    expect(liveTables.length).toBeGreaterThanOrEqual(50);
    expect(pendingTables.length).toBeGreaterThanOrEqual(10);
    expect(tsModel.tables.size).toBeGreaterThanOrEqual(60);
    expect(tsModel.functions.size).toBeGreaterThanOrEqual(10);
  });

  it('D2: public SQL tables and typed tables match in both directions (modulo INTENTIONAL_TYPE_OMISSIONS)', () => {
    const relevant = allIssues.filter(
      (i) => i.kind === 'table-missing-in-types' || i.kind === 'table-missing-in-sql',
    );
    expect(formatIssues(relevant)).toEqual([]);
  });

  it('D3: every table and RPC carries a single accurate @source tag', () => {
    const relevant = allIssues.filter(
      (i) => i.kind === 'tag-missing' || i.kind === 'tag-wrong' || i.kind === 'function-tag',
    );
    expect(formatIssues(relevant)).toEqual([]);
  });

  it('D4: Row column sets match SQL and late ADD COLUMN entries carry explicit @source tags', () => {
    const relevant = allIssues.filter(
      (i) =>
        i.kind === 'column-missing-in-types' ||
        i.kind === 'column-missing-in-sql' ||
        i.kind === 'column-tag',
    );
    expect(formatIssues(relevant)).toEqual([]);
  });

  it('D5: column nullability matches SQL NOT NULL constraints', () => {
    expect(formatIssues(allIssues.filter((i) => i.kind === 'nullability'))).toEqual([]);
  });

  it('D6: column TS type categories match SQL types', () => {
    expect(formatIssues(allIssues.filter((i) => i.kind === 'type-category'))).toEqual([]);
  });

  it('D7: Insert optionality and Update keys match SQL defaults and Row keys', () => {
    const relevant = allIssues.filter((i) => i.kind === 'insert-requiredness' || i.kind === 'update-keys');
    expect(formatIssues(relevant)).toEqual([]);
  });

  it('D8: every typed RPC exists in public SQL with the right @source tag', () => {
    const relevant = allIssues.filter(
      (i) =>
        i.kind === 'function-missing-in-sql' ||
        i.kind === 'function-tag' ||
        (i.kind === 'tag-missing' && i.where.startsWith('rpc:')),
    );
    expect(formatIssues(relevant)).toEqual([]);
    expect(tsModel.functions.get('get_today_bootstrap')?.tag).toBe('migration:037');
  });

  it('D9: INTENTIONAL_TYPE_OMISSIONS is honest and backed by its enforcing guard test', () => {
    expect(formatIssues(allIssues.filter((i) => i.kind === 'omission-stale'))).toEqual([]);
  });

  it('D10: no unmodeled dynamic table/column DDL hides inside DO blocks', () => {
    expect(formatIssues(allIssues.filter((i) => i.kind === 'dynamic-ddl'))).toEqual([]);
  });
});

describe('negative drift controls (in-memory mutations)', () => {
  const baseSources = [liveSchemaSource(REPO_ROOT), ...migrationSources(REPO_ROOT)];
  const baseSql = buildSchemaModel(baseSources);
  const baseText = readFileSync(DB_TYPES_PATH, 'utf8');

  it('N1: deleting habits.name from types triggers column-missing-in-types', () => {
    const mutated = baseText.replace(
      /(^\s{6}habits:\s*\{\s*Row:\s*\{[\s\S]*?)^\s{10}name:\s*string;\r?\n/m,
      '$1',
    );
    const issues = diffSchemas(baseSql, readDatabaseTypes(mutated), INTENTIONAL_TYPE_OMISSIONS);
    expect(issues.some((i) => i.kind === 'column-missing-in-types' && i.where === 'habits.name')).toBe(true);
  });

  it('N2: adding a ghost_table to types triggers table-missing-in-sql', () => {
    const ghost = [
      '      // @source live',
      '      ghost_table: {',
      '        Row: { id: string };',
      '        Insert: { id?: string };',
      '        Update: { id?: string };',
      '        Relationships: [];',
      '      };',
    ].join('\n');
    const mutated = baseText.replace('    Tables: {\n', `    Tables: {\n${ghost}\n`);
    const issues = diffSchemas(baseSql, readDatabaseTypes(mutated), INTENTIONAL_TYPE_OMISSIONS);
    expect(issues.some((i) => i.kind === 'table-missing-in-sql' && i.where === 'ghost_table')).toBe(true);
  });

  it('N3: changing a live table tag to migration:029 triggers tag-wrong', () => {
    const mutated = baseText.replace(
      /\/\/ @source live\r?\n(\s{6}habits:\s*\{)/,
      '// @source migration:029\n$1',
    );
    const issues = diffSchemas(baseSql, readDatabaseTypes(mutated), INTENTIONAL_TYPE_OMISSIONS);
    expect(issues.some((i) => i.kind === 'tag-wrong' && i.where === 'habits')).toBe(true);
  });

  it('N4: removing a table @source comment triggers tag-missing', () => {
    const mutated = baseText.replace(/\s{6}\/\/ @source live\r?\n(\s{6}habits:\s*\{)/, '\n$1');
    const issues = diffSchemas(baseSql, readDatabaseTypes(mutated), INTENTIONAL_TYPE_OMISSIONS);
    expect(issues.some((i) => i.kind === 'tag-missing' && i.where === 'habits')).toBe(true);
  });

  it('N5: adding | null to a NOT NULL column triggers nullability', () => {
    const mutated = baseText.replace(
      /(willpower_state:\s*\{\s*Row:\s*\{\s*user_id:\s*)string;/,
      '$1string | null;',
    );
    const issues = diffSchemas(baseSql, readDatabaseTypes(mutated), INTENTIONAL_TYPE_OMISSIONS);
    expect(issues.some((i) => i.kind === 'nullability' && i.where === 'willpower_state.user_id')).toBe(true);
  });

  it('N6: changing a number column to string triggers type-category', () => {
    const mutated = baseText.replace(
      /(willpower_state:\s*\{\s*Row:\s*\{[\s\S]*?daily_budget:\s*)number;/,
      '$1string;',
    );
    const issues = diffSchemas(baseSql, readDatabaseTypes(mutated), INTENTIONAL_TYPE_OMISSIONS);
    expect(issues.some((i) => i.kind === 'type-category' && i.where === 'willpower_state.daily_budget')).toBe(true);
  });

  it('N7: adding daily_capacity to types triggers omission-stale', () => {
    const block = [
      '      // @source live',
      '      daily_capacity: {',
      '        Row: { user_id: string };',
      '        Insert: { user_id: string };',
      '        Update: { user_id?: string };',
      '        Relationships: [];',
      '      };',
    ].join('\n');
    const mutated = baseText.replace('    Tables: {\n', `    Tables: {\n${block}\n`);
    const issues = diffSchemas(baseSql, readDatabaseTypes(mutated), INTENTIONAL_TYPE_OMISSIONS);
    expect(issues.some((i) => i.kind === 'omission-stale' && i.where === 'daily_capacity')).toBe(true);
  });

  it('N8: adding a synthetic ADD COLUMN migration without updating types triggers column-missing-in-types', () => {
    const sqlWithExtra = buildSchemaModel([
      ...baseSources,
      {
        label: 'migration:999',
        file: '999_synthetic.sql',
        text: 'ALTER TABLE public.habits ADD COLUMN IF NOT EXISTS synthetic_flag boolean;',
      },
    ]);
    const issues = diffSchemas(sqlWithExtra, readDatabaseTypes(baseText), INTENTIONAL_TYPE_OMISSIONS);
    expect(issues.some((i) => i.kind === 'column-missing-in-types' && i.where === 'habits.synthetic_flag')).toBe(true);
  });
});
