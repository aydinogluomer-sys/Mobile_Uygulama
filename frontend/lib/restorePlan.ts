/**
 * R08.03 / R08.04 / F20 (SYN-18, SYN-19) — the dry run: what a restore WOULD do,
 * computed without writing anything.
 *
 * Pure.
 */
import { REGISTRY, canonical, specFor, stripAuthority } from './backupFormat';

export type CollectionPlan = {
  name: string;
  inFile: number;
  insert: Record<string, unknown>[];
  present: number;
  conflicts: string[];
  orphans: string[];
  foreign: number;
  stripped: string[];
  blocked: string | null;
};

export type RestorePlan = {
  userId: string;
  collections: CollectionPlan[];
  inserts: number;
  blockedRows: number;
};

/** Fields the server sets on write; ignored when comparing a file row with the account's. */
const VOLATILE = new Set(['updated_at', 'user_id']);

function sameContent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const pick = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => !VOLATILE.has(k)));
  return canonical(pick(stripAuthority(a).row)) === canonical(pick(stripAuthority(b).row));
}

export function planRestore(params: {
  userId: string;
  file: Record<string, readonly Record<string, unknown>[]>;
  /** The account's current rows per collection, by id. */
  existing: Record<string, ReadonlyMap<string, Record<string, unknown>>>;
}): RestorePlan {
  const { userId, file, existing } = params;
  const out: CollectionPlan[] = [];
  const idSets = new Map<string, Set<string>>();
  const ids = (name: string): Set<string> => {
    let s = idSets.get(name);
    if (!s) {
      s = new Set<string>([
        ...((file[name] ?? []).map((r) => String(r.id))),
        ...(existing[name] ? [...existing[name].keys()] : []),
      ]);
      idSets.set(name, s);
    }
    return s;
  };

  for (const spec of [...REGISTRY].sort((a, b) => a.order - b.order)) {
    const rows = file[spec.name] ?? [];
    const plan: CollectionPlan = {
      name: spec.name,
      inFile: rows.length,
      insert: [],
      present: 0,
      conflicts: [],
      orphans: [],
      foreign: 0,
      stripped: [],
      blocked: null,
    };
    if (!spec.restorable) {
      plan.blocked = spec.reason ?? 'Geri yüklenmez.';
      out.push(plan);
      continue;
    }
    const cur = existing[spec.name] ?? new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const id = String(r.id ?? '');
      if (!id) continue;
      if (r.user_id !== undefined && r.user_id !== userId) { plan.foreign += 1; continue; }
      const mine = cur.get(id);
      if (mine) {
        if (sameContent(mine, r)) plan.present += 1; else plan.conflicts.push(id);
        continue;
      }
      if (spec.uniqueBy && [...cur.values()].some((x) => x[spec.uniqueBy!] === r[spec.uniqueBy!])) {
        plan.conflicts.push(id);
        continue;
      }
      const orphan = Object.entries(spec.relations ?? {}).some(([field, target]) => {
        const v = r[field];
        return v !== null && v !== undefined && !ids(target).has(String(v));
      });
      if (orphan) { plan.orphans.push(id); continue; }
      const { row, stripped } = stripAuthority(r);
      for (const f of stripped) if (!plan.stripped.includes(f)) plan.stripped.push(f);
      plan.insert.push(row);
    }
    out.push(plan);
  }
  return {
    userId,
    collections: out,
    inserts: out.reduce((n, c) => n + c.insert.length, 0),
    blockedRows: out.filter((c) => c.blocked).reduce((n, c) => n + c.inFile, 0),
  };
}

/** The dry run in words, one line per collection with something to say. */
export function planSummary(p: RestorePlan): string[] {
  const lines: string[] = [];
  for (const c of p.collections) {
    if (c.inFile === 0) continue;
    if (c.blocked) { lines.push(`${c.name}: ${c.inFile} kayıt geri yüklenmeyecek — ${c.blocked}`); continue; }
    const parts = [`${c.insert.length} eklenecek`];
    if (c.present) parts.push(`${c.present} zaten var`);
    if (c.conflicts.length) parts.push(`${c.conflicts.length} çakışma (mevcut korunur)`);
    if (c.orphans.length) parts.push(`${c.orphans.length} bağlantısı kopuk (eklenmez)`);
    if (c.foreign) parts.push(`${c.foreign} başka hesabın (eklenmez)`);
    if (c.stripped.length) parts.push(`yetki alanları atıldı: ${c.stripped.join(', ')}`);
    lines.push(`${c.name}: ${parts.join(' · ')}`);
  }
  return lines;
}

/** "Bu dosyadan geri yüklenemeyenler": engelli koleksiyonlar, `habit_logs` ilk sırada, kayıt sayısı ve nedenle. */
export function planNotices(p: RestorePlan): string[] {
  const blocked = p.collections.filter((c) => c.blocked && c.inFile > 0);
  const logs = blocked.filter((c) => c.name === 'habit_logs');
  const rest = blocked.filter((c) => c.name !== 'habit_logs' && c.name !== 'device');
  return [
    ...logs.map((c) => `${c.name}: ${c.inFile} kayıt (tarihçen) dosyada duruyor ama bu uygulamada geri yüklenemez. ${c.blocked}`),
    ...rest.map((c) => `${c.name}: ${c.inFile} kayıt geri yüklenmez. ${c.blocked}`),
  ];
}

export { specFor };
