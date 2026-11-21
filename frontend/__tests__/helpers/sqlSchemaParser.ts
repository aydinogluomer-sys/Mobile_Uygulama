import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export type SourceLabel = 'live' | `migration:${string}`;
export type SqlSource = { label: SourceLabel; file: string; text: string };

export type SqlColumn = {
  name: string;
  /** Lower-case, quote-free type as written: 'uuid', 'numeric(12,2)', 'timestamp with time zone', 'text[]'. */
  sqlType: string;
  notNull: boolean;
  hasDefault: boolean;
  source: SourceLabel;
};
export type SqlTable = { name: string; source: SourceLabel; columns: Map<string, SqlColumn> };
export type SqlFunction = { name: string; source: SourceLabel };
export type DynamicDdl = { file: string; snippet: string };

export type SqlModel = {
  tables: Map<string, SqlTable>;
  functions: Map<string, SqlFunction>;
  movedOut: Map<string, string>;
  dynamicDdl: DynamicDdl[];
};

export type TsCategory = 'string' | 'number' | 'boolean' | 'Json' | 'string[]' | 'number[]';

const DOLLAR_TAG_RE = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

function matchDollarTag(text: string, pos: number): string | null {
  if (text[pos] !== '$') return null;
  const m = text.slice(pos).match(DOLLAR_TAG_RE);
  return m ? m[0] : null;
}

/** CRLF -> LF, drops -- and block comments, unquotes "identifiers"; string literals and dollar-quoted bodies are left intact. */
export function normalizeSql(text: string): string {
  const src = text.replace(/\r\n?/g, '\n');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i = i < src.length ? i + 2 : src.length;
      out += ' ';
      continue;
    }

    if (ch === "'") {
      let end = i + 1;
      while (end < src.length) {
        if (src[end] === "'" && src[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (src[end] === "'") {
          end += 1;
          break;
        }
        end += 1;
      }
      out += src.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '$') {
      const tag = matchDollarTag(src, i);
      if (tag) {
        const closeIdx = src.indexOf(tag, i + tag.length);
        if (closeIdx === -1) {
          out += src.slice(i);
          break;
        }
        out += src.slice(i, closeIdx + tag.length);
        i = closeIdx + tag.length;
        continue;
      }
    }

    if (ch === '"') {
      let ident = '';
      let end = i + 1;
      while (end < src.length) {
        if (src[end] === '"' && src[end + 1] === '"') {
          ident += '"';
          end += 2;
          continue;
        }
        if (src[end] === '"') {
          end += 1;
          break;
        }
        ident += src[end];
        end += 1;
      }
      out += ident;
      i = end;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

/** Splits on top-level `;`, honouring single-quoted strings, dollar-quoted bodies, comments and parentheses. */
export function splitStatements(text: string): string[] {
  const src = text.replace(/\r\n?/g, '\n');
  const statements: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i = i < src.length ? i + 2 : src.length;
      continue;
    }
    if (ch === "'") {
      i += 1;
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (src[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      i += 1;
      while (i < src.length) {
        if (src[i] === '"' && src[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '$') {
      const tag = matchDollarTag(src, i);
      if (tag) {
        const closeIdx = src.indexOf(tag, i + tag.length);
        i = closeIdx === -1 ? src.length : closeIdx + tag.length;
        continue;
      }
    }

    if (ch === '(') parenDepth += 1;
    else if (ch === ')' && parenDepth > 0) parenDepth -= 1;
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']' && bracketDepth > 0) bracketDepth -= 1;
    else if (ch === ';' && parenDepth === 0 && bracketDepth === 0) {
      const piece = normalizeSql(src.slice(start, i)).trim();
      if (piece.length > 0) statements.push(piece);
      start = i + 1;
    }
    i += 1;
  }

  const tail = normalizeSql(src.slice(start)).trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

/** Splits on top-level commas (depth 0), honouring strings, parentheses and square brackets. */
export function splitTopLevel(text: string): string[] {
  const items: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i = i < text.length ? i + 2 : text.length;
      continue;
    }
    if (ch === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (text[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      i += 1;
      while (i < text.length) {
        if (text[i] === '"' && text[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '$') {
      const tag = matchDollarTag(text, i);
      if (tag) {
        const closeIdx = text.indexOf(tag, i + tag.length);
        i = closeIdx === -1 ? text.length : closeIdx + tag.length;
        continue;
      }
    }

    if (ch === '(') parenDepth += 1;
    else if (ch === ')' && parenDepth > 0) parenDepth -= 1;
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']' && bracketDepth > 0) bracketDepth -= 1;
    else if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      const piece = text.slice(start, i).trim();
      if (piece.length > 0) items.push(piece);
      start = i + 1;
    }
    i += 1;
  }

  const tail = text.slice(start).trim();
  if (tail.length > 0) items.push(tail);
  return items;
}

function canonicalizeSqlType(rawType: string): string {
  return rawType
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\[\s*\]/g, '[]')
    .trim();
}

/** Replaces nested (...), [...], '...' and $tag$...$tag$ spans so top-level keywords can be inspected safely. */
function topLevelSkeleton(text: string): string {
  let out = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (text[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      if (parenDepth === 0 && bracketDepth === 0) out += " '' ";
      continue;
    }
    if (ch === '$') {
      const tag = matchDollarTag(text, i);
      if (tag) {
        const closeIdx = text.indexOf(tag, i + tag.length);
        i = closeIdx === -1 ? text.length : closeIdx + tag.length;
        if (parenDepth === 0 && bracketDepth === 0) out += ' $$ ';
        continue;
      }
    }
    if (ch === '(') {
      if (parenDepth === 0 && bracketDepth === 0) out += '(';
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      if (parenDepth > 0) parenDepth -= 1;
      if (parenDepth === 0 && bracketDepth === 0) out += ')';
      i += 1;
      continue;
    }
    if (ch === '[') {
      if (parenDepth === 0 && bracketDepth === 0) out += '[';
      bracketDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ']') {
      if (bracketDepth > 0) bracketDepth -= 1;
      if (parenDepth === 0 && bracketDepth === 0) out += ']';
      i += 1;
      continue;
    }
    if (parenDepth === 0 && bracketDepth === 0) out += ch;
    i += 1;
  }
  return out;
}

const COLUMN_MODIFIER_HEAD_RE =
  /^(?:NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|CONSTRAINT|GENERATED|COLLATE)\b/i;

/** One CREATE TABLE / ADD COLUMN item. Returns null for table constraints (CONSTRAINT, UNIQUE, PRIMARY KEY, CHECK, FOREIGN KEY, EXCLUDE, LIKE). */
export function parseColumnDefinition(item: string): Omit<SqlColumn, 'source'> | null {
  const norm = normalizeSql(item).trim();
  if (!norm) return null;

  if (/^(?:CONSTRAINT|UNIQUE|PRIMARY\s+KEY|CHECK|FOREIGN\s+KEY|EXCLUDE|LIKE)(?:\s|\()/i.test(norm)) {
    return null;
  }

  const head = norm.match(/^([A-Za-z_][A-Za-z0-9_$]*)\s+([\s\S]+)$/);
  if (!head) {
    throw new Error(`invalid column definition: ${item}`);
  }
  const name = head[1].toLowerCase();
  const rest = head[2].trim();

  let modStart = rest.length;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i];
    if (ch === "'") {
      i += 1;
      while (i < rest.length) {
        if (rest[i] === "'" && rest[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (rest[i] === "'") break;
        i += 1;
      }
      continue;
    }
    if (ch === '(') {
      parenDepth += 1;
      continue;
    }
    if (ch === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (ch === '[') {
      bracketDepth += 1;
      continue;
    }
    if (ch === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (i > 0 && parenDepth === 0 && bracketDepth === 0 && /[\s)\]]/.test(rest[i - 1])) {
      if (COLUMN_MODIFIER_HEAD_RE.test(rest.slice(i))) {
        modStart = i;
        break;
      }
    }
  }

  const sqlType = canonicalizeSqlType(rest.slice(0, modStart));
  const modSkeleton = topLevelSkeleton(rest.slice(modStart));
  const isSerial = sqlType === 'serial' || sqlType === 'bigserial' || sqlType === 'smallserial';
  const isIdentity = /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i.test(modSkeleton);

  const notNull =
    isSerial ||
    isIdentity ||
    /\bNOT\s+NULL\b/i.test(modSkeleton) ||
    /\bPRIMARY\s+KEY\b/i.test(modSkeleton);

  const hasDefault =
    isSerial ||
    isIdentity ||
    /\bDEFAULT\b/i.test(modSkeleton);

  return { name, sqlType, notNull, hasDefault };
}

function findMatchingCloseParen(text: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (text[i] === "'") break;
        i += 1;
      }
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const DYNAMIC_DDL_RE =
  /\b(?:CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE|DROP\s+TABLE|ADD\s+COLUMN|DROP\s+COLUMN|ALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE|SET\s+SCHEMA|RENAME\s+(?:TO|COLUMN))\b/i;

function applyDoBlock(model: SqlModel, rawBody: string, file: string): void {
  let body = normalizeSql(rawBody);

  // Modeled 040 pattern: FOREACH <v> IN ARRAY ARRAY['t1', ...] LOOP ... EXECUTE format('ALTER TABLE public.%I SET SCHEMA <s>', <v>); END LOOP;
  const foreachRe =
    /\bFOREACH\s+([A-Za-z_][A-Za-z0-9_]*)\s+IN\s+ARRAY\s+ARRAY\s*\[([\s\S]*?)\]\s*LOOP([\s\S]*?)END\s+LOOP\s*;/gi;

  body = body.replace(foreachRe, (full, loopVar: string, arrayBody: string, loopBody: string) => {
    const execFormatRe = new RegExp(
      `EXECUTE\\s+format\\(\\s*'ALTER\\s+TABLE\\s+public\\.%I\\s+SET\\s+SCHEMA\\s+([A-Za-z_][A-Za-z0-9_]*)'\\s*,\\s*${loopVar}\\s*\\)`,
      'i',
    );
    const execMatch = loopBody.match(execFormatRe);
    if (!execMatch) return full;

    const restOfLoop = loopBody.replace(execFormatRe, '');
    if (DYNAMIC_DDL_RE.test(restOfLoop)) return full;

    const literalParts = arrayBody
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (literalParts.length === 0 || !literalParts.every((p) => /^'[A-Za-z_][A-Za-z0-9_]*'$/.test(p))) {
      return full;
    }

    const targetSchema = execMatch[1].toLowerCase();
    for (const lit of literalParts) {
      const tbl = lit.slice(1, -1).toLowerCase();
      if (targetSchema !== 'public') {
        model.tables.delete(tbl);
        model.movedOut.set(tbl, targetSchema);
      }
    }
    return '';
  });

  const hit = body.match(DYNAMIC_DDL_RE);
  if (hit && hit.index !== undefined) {
    const start = Math.max(0, hit.index - 20);
    const snippet = body.slice(start, hit.index + 80).replace(/\s+/g, ' ').trim();
    model.dynamicDdl.push({ file, snippet });
  }
}

/** Mutates `model`. Throws `Error('unsupported DDL on <table>: <statement head>')` for an ALTER TABLE action it does not model. */
export function applyStatement(model: SqlModel, statement: string, source: SourceLabel, file: string): void {
  const stmt = normalizeSql(statement).trim().replace(/;+\s*$/, '').trim();
  if (!stmt) return;

  if (/^(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i.test(stmt)) return;

  const doMatch = stmt.match(
    /^DO\s+(?:LANGUAGE\s+\w+\s+)?(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*)\1(?:\s+LANGUAGE\s+\w+)?$/i,
  );
  if (doMatch) {
    applyDoBlock(model, doMatch[2], file);
    return;
  }

  if (/^CREATE\s+(?:TEMP|TEMPORARY)\s+TABLE\b/i.test(stmt)) return;

  const createTableMatch = stmt.match(
    /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*([\s\S]*)$/i,
  );
  if (createTableMatch) {
    const ifNotExists = Boolean(createTableMatch[1]);
    const schema = (createTableMatch[2] ?? 'public').toLowerCase();
    const tableName = createTableMatch[3].toLowerCase();
    const tail = createTableMatch[4].trim();
    if (schema !== 'public') return;

    if (!tail.startsWith('(') || /^(?:AS|PARTITION\s+OF)\b/i.test(tail)) {
      throw new Error(`unsupported DDL on ${tableName}: ${stmt.slice(0, 80)}`);
    }
    const closeIdx = findMatchingCloseParen(tail, 0);
    if (closeIdx === -1) {
      throw new Error(`unsupported DDL on ${tableName}: ${stmt.slice(0, 80)}`);
    }
    const afterParen = tail.slice(closeIdx + 1).trim();
    if (/^\bPARTITION\s+OF\b/i.test(afterParen)) {
      throw new Error(`unsupported DDL on ${tableName}: ${stmt.slice(0, 80)}`);
    }

    if (ifNotExists && model.tables.has(tableName)) return;

    const body = tail.slice(1, closeIdx);
    const items = splitTopLevel(body);
    const columns = new Map<string, SqlColumn>();
    const pkCols: string[] = [];

    for (const item of items) {
      if (/^LIKE(?:\s|\()/i.test(item.trim())) {
        throw new Error(`unsupported DDL on ${tableName}: ${stmt.slice(0, 80)}`);
      }
      const pkMatch = item.match(/^(?:CONSTRAINT\s+[A-Za-z_][A-Za-z0-9_]*\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pkMatch) {
        for (const c of pkMatch[1].split(',')) {
          const trimmed = c.trim().toLowerCase();
          if (trimmed) pkCols.push(trimmed);
        }
      }
      const parsed = parseColumnDefinition(item);
      if (parsed) {
        columns.set(parsed.name, { ...parsed, source });
      }
    }

    for (const pk of pkCols) {
      const col = columns.get(pk);
      if (col) col.notNull = true;
    }

    model.movedOut.delete(tableName);
    model.tables.set(tableName, { name: tableName, source, columns });
    return;
  }

  const dropTableMatch = stmt.match(
    /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\b/i,
  );
  if (dropTableMatch) {
    const schema = (dropTableMatch[1] ?? 'public').toLowerCase();
    const tableName = dropTableMatch[2].toLowerCase();
    if (schema === 'public') {
      model.tables.delete(tableName);
    }
    return;
  }

  const alterTableMatch = stmt.match(
    /^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s+([\s\S]+)$/i,
  );
  if (alterTableMatch) {
    const schema = (alterTableMatch[1] ?? 'public').toLowerCase();
    let tableName = alterTableMatch[2].toLowerCase();
    if (schema !== 'public') return;

    const actions = splitTopLevel(alterTableMatch[3]);
    for (const rawAction of actions) {
      const action = rawAction.trim();

      const setSchemaMatch = action.match(/^SET\s+SCHEMA\s+([A-Za-z_][A-Za-z0-9_]*)$/i);
      if (setSchemaMatch) {
        const targetSchema = setSchemaMatch[1].toLowerCase();
        if (targetSchema !== 'public') {
          model.tables.delete(tableName);
          model.movedOut.set(tableName, targetSchema);
        }
        continue;
      }

      const renameTableMatch = action.match(/^RENAME\s+TO\s+([A-Za-z_][A-Za-z0-9_]*)$/i);
      if (renameTableMatch) {
        const nextName = renameTableMatch[1].toLowerCase();
        const tbl = model.tables.get(tableName);
        if (tbl) {
          model.tables.delete(tableName);
          tbl.name = nextName;
          model.tables.set(nextName, tbl);
        }
        tableName = nextName;
        continue;
      }

      const renameColMatch = action.match(
        /^RENAME\s+(?:COLUMN\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+TO\s+([A-Za-z_][A-Za-z0-9_]*)$/i,
      );
      if (renameColMatch) {
        const fromCol = renameColMatch[1].toLowerCase();
        const toCol = renameColMatch[2].toLowerCase();
        const tbl = model.tables.get(tableName);
        if (tbl && tbl.columns.has(fromCol)) {
          const nextCols = new Map<string, SqlColumn>();
          for (const [k, v] of tbl.columns) {
            if (k === fromCol) nextCols.set(toCol, { ...v, name: toCol });
            else nextCols.set(k, v);
          }
          tbl.columns = nextCols;
        }
        continue;
      }

      const pkConstraintMatch = action.match(
        /^ADD\s+(?:CONSTRAINT\s+[A-Za-z_][A-Za-z0-9_]*\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i,
      );
      if (pkConstraintMatch) {
        const tbl = model.tables.get(tableName);
        if (tbl) {
          for (const part of pkConstraintMatch[1].split(',')) {
            const col = tbl.columns.get(part.trim().toLowerCase());
            if (col) col.notNull = true;
          }
        }
        continue;
      }

      if (/^ADD\s+(?:CONSTRAINT\s+[A-Za-z_][A-Za-z0-9_]*\s+)?(?:FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE)\b/i.test(action)) {
        continue;
      }

      if (
        /^(?:DROP\s+CONSTRAINT|VALIDATE\s+CONSTRAINT|(?:ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY|OWNER\s+TO|(?:ENABLE|DISABLE)\s+TRIGGER|REPLICA\s+IDENTITY)\b/i.test(
          action,
        )
      ) {
        continue;
      }

      const dropColMatch = action.match(
        /^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:CASCADE|RESTRICT))?$/i,
      );
      if (dropColMatch) {
        model.tables.get(tableName)?.columns.delete(dropColMatch[1].toLowerCase());
        continue;
      }

      const addColMatch = action.match(/^ADD\s+(?:COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i);
      if (addColMatch) {
        const ifNotExists = Boolean(addColMatch[1]);
        const parsed = parseColumnDefinition(addColMatch[2]);
        const tbl = model.tables.get(tableName);
        if (tbl && parsed) {
          if (!(ifNotExists && tbl.columns.has(parsed.name))) {
            tbl.columns.set(parsed.name, { ...parsed, source });
          }
        }
        continue;
      }

      const alterColSetNotNull = action.match(/^ALTER\s+(?:COLUMN\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+SET\s+NOT\s+NULL$/i);
      if (alterColSetNotNull) {
        const col = model.tables.get(tableName)?.columns.get(alterColSetNotNull[1].toLowerCase());
        if (col) col.notNull = true;
        continue;
      }

      const alterColDropNotNull = action.match(/^ALTER\s+(?:COLUMN\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+DROP\s+NOT\s+NULL$/i);
      if (alterColDropNotNull) {
        const col = model.tables.get(tableName)?.columns.get(alterColDropNotNull[1].toLowerCase());
        if (col) col.notNull = false;
        continue;
      }

      const alterColSetDefault = action.match(
        /^ALTER\s+(?:COLUMN\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+SET\s+DEFAULT\s+[\s\S]+$/i,
      );
      if (alterColSetDefault) {
        const col = model.tables.get(tableName)?.columns.get(alterColSetDefault[1].toLowerCase());
        if (col) col.hasDefault = true;
        continue;
      }

      const alterColDropDefault = action.match(/^ALTER\s+(?:COLUMN\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+DROP\s+DEFAULT$/i);
      if (alterColDropDefault) {
        const col = model.tables.get(tableName)?.columns.get(alterColDropDefault[1].toLowerCase());
        if (col) col.hasDefault = false;
        continue;
      }

      const alterColType = action.match(
        /^ALTER\s+(?:COLUMN\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+(?:SET\s+DATA\s+)?TYPE\s+([\s\S]+)$/i,
      );
      if (alterColType) {
        const col = model.tables.get(tableName)?.columns.get(alterColType[1].toLowerCase());
        if (col) {
          const withoutUsing = alterColType[2].replace(/\s+USING\s+[\s\S]+$/i, '');
          col.sqlType = canonicalizeSqlType(withoutUsing);
        }
        continue;
      }

      throw new Error(`unsupported DDL on ${tableName}: ${stmt.slice(0, 80)}`);
    }
    return;
  }

  const createFnMatch = stmt.match(
    /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/i,
  );
  if (createFnMatch) {
    const schema = (createFnMatch[1] ?? 'public').toLowerCase();
    const fnName = createFnMatch[2].toLowerCase();
    if (schema === 'public' && !model.functions.has(fnName)) {
      model.functions.set(fnName, { name: fnName, source });
    }
    return;
  }

  const dropFnMatch = stmt.match(
    /^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|$)/i,
  );
  if (dropFnMatch) {
    const schema = (dropFnMatch[1] ?? 'public').toLowerCase();
    const fnName = dropFnMatch[2].toLowerCase();
    if (schema === 'public') {
      model.functions.delete(fnName);
    }
    return;
  }
}

export function buildSchemaModel(sources: readonly SqlSource[]): SqlModel {
  const model: SqlModel = {
    tables: new Map(),
    functions: new Map(),
    movedOut: new Map(),
    dynamicDdl: [],
  };
  for (const src of sources) {
    for (const stmt of splitStatements(src.text)) {
      applyStatement(model, stmt, src.label, src.file);
    }
  }
  return model;
}

const STRING_SQL_TYPES = new Set([
  'uuid',
  'text',
  'varchar',
  'character varying',
  'character',
  'char',
  'citext',
  'date',
  'time',
  'time without time zone',
  'time with time zone',
  'timestamp',
  'timestamp without time zone',
  'timestamp with time zone',
  'timestamptz',
  'interval',
  'bytea',
  'inet',
]);

const NUMBER_SQL_TYPES = new Set([
  'integer',
  'int',
  'int2',
  'int4',
  'int8',
  'smallint',
  'bigint',
  'serial',
  'smallserial',
  'bigserial',
  'numeric',
  'decimal',
  'real',
  'double precision',
  'float4',
  'float8',
]);

const BOOLEAN_SQL_TYPES = new Set(['boolean', 'bool']);
const JSON_SQL_TYPES = new Set(['json', 'jsonb']);

export function tsCategoryOfSqlType(sqlType: string): TsCategory {
  const norm = canonicalizeSqlType(sqlType);
  if (norm.endsWith('[]')) {
    const elem = tsCategoryOfSqlType(norm.slice(0, -2));
    if (elem === 'string') return 'string[]';
    if (elem === 'number') return 'number[]';
    throw new Error(`unknown SQL type ${sqlType}`);
  }

  const stripped = norm.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (STRING_SQL_TYPES.has(stripped)) return 'string';
  if (NUMBER_SQL_TYPES.has(stripped)) return 'number';
  if (BOOLEAN_SQL_TYPES.has(stripped)) return 'boolean';
  if (JSON_SQL_TYPES.has(stripped)) return 'Json';

  throw new Error(`unknown SQL type ${sqlType}`);
}

export function renderTableBlock(table: SqlTable, tag: string): string {
  const rowLines: string[] = [];
  const insertLines: string[] = [];
  const updateLines: string[] = [];

  for (const col of table.columns.values()) {
    const cat = tsCategoryOfSqlType(col.sqlType);
    const tsType = col.notNull ? cat : `${cat} | null`;
    const colTag = col.source !== table.source ? `          // @source ${col.source}\n` : '';
    const insertOpt = !col.notNull || col.hasDefault ? '?' : '';
    rowLines.push(`${colTag}          ${col.name}: ${tsType};`);
    insertLines.push(`${colTag}          ${col.name}${insertOpt}: ${tsType};`);
    updateLines.push(`${colTag}          ${col.name}?: ${tsType};`);
  }

  return [
    `      // @source ${tag}`,
    `      ${table.name}: {`,
    `        Row: {`,
    ...rowLines,
    `        };`,
    `        Insert: {`,
    ...insertLines,
    `        };`,
    `        Update: {`,
    ...updateLines,
    `        };`,
    `        Relationships: [];`,
    `      };`,
  ].join('\n');
}

export function liveSchemaSource(repoRoot: string): SqlSource {
  const rel = 'supabase/live_schema.sql';
  return {
    label: 'live',
    file: rel,
    text: readFileSync(join(repoRoot, 'supabase', 'live_schema.sql'), 'utf8'),
  };
}

export function migrationSources(repoRoot: string, firstNumber = 28): SqlSource[] {
  const dir = join(repoRoot, 'supabase', 'migrations');
  const entries = readdirSync(dir)
    .map((name) => {
      const m = name.match(/^(\d{3})_.*\.sql$/);
      return m ? { name, num: Number(m[1]), digits: m[1] } : null;
    })
    .filter((x): x is { name: string; num: number; digits: string } => x !== null && x.num >= firstNumber)
    .sort((a, b) => a.num - b.num || a.name.localeCompare(b.name));

  return entries.map((e) => ({
    label: `migration:${e.digits}`,
    file: `supabase/migrations/${e.name}`,
    text: readFileSync(join(dir, e.name), 'utf8'),
  }));
}
