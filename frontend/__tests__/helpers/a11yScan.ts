import { readdirSync, readFileSync } from 'fs';
import { isAbsolute, join, relative, sep } from 'path';

const ROOT = join(__dirname, '..', '..');

/** Erişilebilirlik ağacında kendi başına odaklanabilir olan RN bileşenleri. */
export const INTERACTIVE: readonly string[] = [
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'Pressable',
];

type Ctx = { kind: 'quote'; q: string } | { kind: 'expr'; depth: number };

/**
 * Yorum gövdelerini ve dize içeriklerini boşlukla değiştirir; uzunluk ve satır
 * sonları korunur, böylece dönen dizenin indisleri ham kaynakla birebir örtüşür.
 *
 * `balanced`, dosya sonunda hiçbir dize/şablon bağlamının açık kalmadığını
 * söyler. Kapanmamış bir bağlam tarayıcının kafasının karıştığı anlamına gelir
 * — bu durumda testler sessizce geçmek yerine yüksek sesle patlamalı.
 */
export function blankNonCode(src: string): { blanked: string; balanced: boolean } {
  const out = src.split('');
  const n = src.length;
  const stack: Ctx[] = [];
  const blankAt = (k: number) => {
    if (k < n && out[k] !== '\n') out[k] = ' ';
  };

  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];

    // --- dize / şablon literal içi ---
    if (top && top.kind === 'quote') {
      if (c === '\\') {
        blankAt(i);
        blankAt(i + 1);
        i += 2;
        continue;
      }
      if (c === top.q) {
        stack.pop(); // kapanış tırnağı koddur, olduğu gibi kalır
        i++;
        continue;
      }
      // Şablon ifadesi: `${...}` içi gerçek koddur.
      if (top.q === '`' && c === '$' && src[i + 1] === '{') {
        stack.push({ kind: 'expr', depth: 0 });
        i += 2;
        continue;
      }
      blankAt(i);
      i++;
      continue;
    }

    // --- kod ---
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') {
        blankAt(i);
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      while (i < stop) {
        blankAt(i);
        i++;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      stack.push({ kind: 'quote', q: c });
      i++;
      continue;
    }
    if (top && top.kind === 'expr') {
      if (c === '{') top.depth++;
      else if (c === '}') {
        if (top.depth === 0) stack.pop(); // `${...}` kapandı, şablona dönüyoruz
        else top.depth--;
      }
    }
    i++;
  }

  return { blanked: out.join(''), balanced: stack.length === 0 };
}

export type Tag = { line: number; attrs: string; rawAttrs: string };

function findTagEnd(blanked: string, from: number): number {
  let depth = 0;
  let j = from;
  while (j < blanked.length) {
    const ch = blanked[j];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) break;
    j++;
  }
  return j;
}

/**
 * Verilen bileşenin AÇILIŞ ETİKETLERİNİ bulur ve her biri için SADECE kendi
 * öznitelik aralığını döndürür. Dosya kapsamı yok: bir etiketin iddiası
 * aynı dosyadaki başka bir etiket tarafından karşılanamaz.
 */
export function openingTags(raw: string, blanked: string, component: string): Tag[] {
  const re = new RegExp(`<${component}(?![A-Za-z0-9_$])`, 'g');
  const tags: Tag[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(blanked)) !== null) {
    const from = m.index + m[0].length;
    const j = findTagEnd(blanked, from);
    tags.push({
      line: blanked.slice(0, m.index).split('\n').length,
      attrs: blanked.slice(from, j),
      rawAttrs: raw.slice(from, j),
    });
  }
  return tags;
}

type ElementBlock = {
  line: number;
  endLine: number;
  attrs: string;
  rawAttrs: string;
  inner: string;
  innerBlanked: string;
};

function elementBlocks(
  raw: string,
  blanked: string,
  component: string,
  stripNested = true,
): ElementBlock[] {
  const tokenRe = new RegExp(`</${component}\\s*>|<${component}(?![A-Za-z0-9_$])`, 'g');
  const out: ElementBlock[] = [];
  const stack: {
    slot: number;
    line: number;
    attrs: string;
    rawAttrs: string;
    innerStart: number;
    nestedRanges: [number, number][];
  }[] = [];

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(blanked)) !== null) {
    if (m[0].startsWith('</')) {
      const top = stack.pop();
      if (!top) continue;
      const closeEnd = m.index + m[0].length;
      const endLine = blanked.slice(0, closeEnd).split('\n').length;
      let ownRaw = raw.slice(top.innerStart, m.index);
      let ownBlanked = blanked.slice(top.innerStart, m.index);
      if (stripNested && top.nestedRanges.length > 0) {
        const rawChars = ownRaw.split('');
        const blankChars = ownBlanked.split('');
        for (const [ns, ne] of top.nestedRanges) {
          const rs = Math.max(0, ns - top.innerStart);
          const re = Math.min(rawChars.length, ne - top.innerStart);
          for (let k = rs; k < re; k++) {
            if (rawChars[k] !== '\n') rawChars[k] = ' ';
            if (blankChars[k] !== '\n') blankChars[k] = ' ';
          }
        }
        ownRaw = rawChars.join('');
        ownBlanked = blankChars.join('');
      }
      if (stack.length > 0) {
        const openStart = top.innerStart - top.attrs.length - component.length - 2;
        stack[stack.length - 1].nestedRanges.push([Math.max(0, openStart), closeEnd]);
      }
      out[top.slot] = {
        line: top.line,
        endLine,
        attrs: top.attrs,
        rawAttrs: top.rawAttrs,
        inner: ownRaw,
        innerBlanked: ownBlanked,
      };
    } else {
      const openIdx = m.index;
      const from = openIdx + m[0].length;
      const j = findTagEnd(blanked, from);
      const line = blanked.slice(0, openIdx).split('\n').length;
      const attrs = blanked.slice(from, j);
      const rawAttrs = raw.slice(from, j);
      const selfClosing = j > from && blanked[j - 1] === '/';
      tokenRe.lastIndex = Math.min(blanked.length, j + 1);
      if (selfClosing) {
        const endLine = blanked.slice(0, j + 1).split('\n').length;
        if (stack.length > 0) {
          stack[stack.length - 1].nestedRanges.push([openIdx, j + 1]);
        }
        out.push({
          line,
          endLine,
          attrs,
          rawAttrs,
          inner: '',
          innerBlanked: '',
        });
      } else {
        const slot = out.length;
        out.push({
          line,
          endLine: line,
          attrs,
          rawAttrs,
          inner: '',
          innerBlanked: '',
        });
        stack.push({
          slot,
          line,
          attrs,
          rawAttrs,
          innerStart: j + 1,
          nestedRanges: [],
        });
      }
    }
  }

  // Unclosed fallback (malformed synthetic input)
  while (stack.length > 0) {
    const top = stack.pop()!;
    out[top.slot] = {
      line: top.line,
      endLine: blanked.split('\n').length,
      attrs: top.attrs,
      rawAttrs: top.rawAttrs,
      inner: raw.slice(top.innerStart),
      innerBlanked: blanked.slice(top.innerStart),
    };
  }

  return out;
}

export function modalBlocks(
  raw: string,
  blanked: string,
): { line: number; endLine: number; inner: string }[] {
  return elementBlocks(raw, blanked, 'Modal', false).map(({ line, endLine, inner }) => ({
    line,
    endLine,
    inner,
  }));
}

const HAS_LABEL = /\baccessibilityLabel\b/;
const HAS_ROLE = /\baccessibilityRole\b/;
const EMPTY_STRING_LABEL = /\baccessibilityLabel\s*=\s*(["'])\s*\1/;
const OPTED_OUT = /\baccessible\s*=\s*\{\s*false\s*\}/;

export type TouchableScanResult = {
  total: number;
  noRole: number;
  noLabel: number;
  iconOnlyNoLabel: number;
  offenders: Record<string, string[]>;
};

export function scanTouchableSource(file: string, raw: string): TouchableScanResult {
  const { blanked } = blankNonCode(raw);
  let total = 0;
  let noRole = 0;
  let noLabel = 0;
  let iconOnlyNoLabel = 0;
  const rows: { line: number; msg: string }[] = [];

  for (const component of INTERACTIVE) {
    for (const block of elementBlocks(raw, blanked, component)) {
      if (OPTED_OUT.test(block.attrs)) continue;
      total += 1;
      const hasRole = HAS_ROLE.test(block.attrs);
      const hasLabel = HAS_LABEL.test(block.attrs) && !EMPTY_STRING_LABEL.test(block.rawAttrs);
      const iconOnly = /<Ionicons\b/.test(block.innerBlanked) && !/<Text\b/.test(block.innerBlanked);

      if (!hasRole) noRole += 1;
      if (!hasLabel) {
        noLabel += 1;
        if (iconOnly) iconOnlyNoLabel += 1;
      }
      if (!hasRole || !hasLabel) {
        const missing = [!hasRole ? 'role' : null, !hasLabel ? (iconOnly ? 'label(icon-only)' : 'label') : null]
          .filter(Boolean)
          .join('+');
        rows.push({ line: block.line, msg: `${file}:${block.line} <${component}> missing ${missing}` });
      }
    }
  }

  rows.sort((a, b) => a.line - b.line);
  const offenders: Record<string, string[]> = {};
  if (rows.length > 0) {
    offenders[file] = rows.map((r) => r.msg);
  }
  return { total, noRole, noLabel, iconOnlyNoLabel, offenders };
}

function walkTsxFiles(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) {
      continue;
    }
    const full = join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

export function scanTouchables(dirs: string[]): TouchableScanResult {
  let total = 0;
  let noRole = 0;
  let noLabel = 0;
  let iconOnlyNoLabel = 0;
  const offenders: Record<string, string[]> = {};

  const absFiles = dirs
    .flatMap((d) => walkTsxFiles(isAbsolute(d) ? d : join(ROOT, d)))
    .sort();

  for (const full of absFiles) {
    const rel = relative(ROOT, full).split(sep).join('/');
    const res = scanTouchableSource(rel, readFileSync(full, 'utf8'));
    total += res.total;
    noRole += res.noRole;
    noLabel += res.noLabel;
    iconOnlyNoLabel += res.iconOnlyNoLabel;
    if (res.offenders[rel]) {
      offenders[rel] = res.offenders[rel];
    }
  }

  return { total, noRole, noLabel, iconOnlyNoLabel, offenders };
}
