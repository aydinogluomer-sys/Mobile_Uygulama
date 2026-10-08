/**
 * R08.01 / R08.02 / R08.05 — what an export contains, how it is checked,
 * and which parts may ever be read back in.
 *
 * Format 3 adds a MANIFEST to the export: the account it came from, and for
 * every collection its row count and a checksum of its canonical JSON. A
 * file whose counts or checksums do not match its manifest was cut or edited
 * and is refused before anything else looks at it.
 *
 * The checksum is FNV-1a (64-bit, as two 32-bit halves) -- an integrity check
 * against truncation and accidental edits, NOT a signature: anyone who edits
 * a file can recompute it. Ownership is checked separately (the manifest's
 * account must be the signed-in one).
 *
 * ## What may come back in (the registry)
 *
 * A collection is `restorable` only when inserting its rows has no side
 * effect beyond the rows themselves. Two kinds never are:
 *  - rows the SERVER scores: `habit_logs` (an insert re-fires the XP
 *    trigger and inflates total_xp; the trigger is not in this repository,
 *    stop point S11) and `focus_sessions` (session rows feed focus credit);
 *  - registrations exported without their secret: `webhooks` (headers are
 *    stripped on export, so a restored webhook could not authenticate).
 * Authority fields are stripped from every restored row (R08.05): XP, FP,
 * willpower budgets, subscription/tier and anything credential-shaped are
 * never taken from a file -- the server decides them.
 *
 * Pure.
 */

export const BACKUP_FORMAT_VERSION = 3;

export type CollectionSpec = {
  name: string;
  restorable: boolean;
  /** Why not, when not. */
  reason?: string;
  /** Foreign keys checked by the dry run: field -> collection it must exist in. */
  relations?: Record<string, string>;
  /** Restored in this order (lower first), so a parent exists before a child. */
  order: number;
  /** A second natural key the table is unique on (besides id), e.g. one journal entry per date. */
  uniqueBy?: string;
};

export const REGISTRY: readonly CollectionSpec[] = [
  { name: 'projects', restorable: true, order: 1 },
  { name: 'habits', restorable: true, order: 1 },
  { name: 'goals', restorable: true, order: 2 },
  { name: 'tasks', restorable: true, order: 2, relations: { project_id: 'projects' } },
  { name: 'notes', restorable: true, order: 2 },
  { name: 'journal_entries', restorable: true, order: 2, uniqueBy: 'date' },
  { name: 'bad_habits', restorable: true, order: 2 },
  { name: 'habit_logs', restorable: false, order: 3, relations: { habit_id: 'habits' },
    reason: 'Sunucu her kayıt için XP veriyor; geri yüklemek XP\'yi şişirirdi (sunucu yolu yok).' },
  { name: 'focus_sessions', restorable: false, order: 3,
    reason: 'Odak oturumları puan üretir; dosyadan geri yüklenmez.' },
  { name: 'webhooks', restorable: false, order: 3,
    reason: 'Başlıkları (gizli anahtarları) dışa aktarılmadı; geri yüklense çalışmaz.' },
  // R08.01 — the rest of what the account owns.
  { name: 'okrs', restorable: true, order: 1 },
  { name: 'key_results', restorable: true, order: 2, relations: { okr_id: 'okrs' } },
  { name: 'reading_list', restorable: true, order: 1 },
  { name: 'focus_tasks', restorable: true, order: 1 },
  { name: 'recovery_plans', restorable: true, order: 3, relations: { habit_id: 'habits' } },
  { name: 'weekly_reviews', restorable: true, order: 2, uniqueBy: 'week_key' },
  { name: 'monthly_reviews', restorable: true, order: 2, uniqueBy: 'month_key' },
  { name: 'life_area_logs', restorable: false, order: 3,
    reason: 'Yaşam alanı puanını besliyor; sunucu tarafı etkisi bu depoda tanımlı değil (S12) — yalnız dışa aktarılır.' },
  { name: 'deep_work_sessions', restorable: false, order: 3,
    reason: 'Derin çalışma oturumları puan üretebilir; odak oturumları gibi dosyadan geri yüklenmez.' },
  { name: 'ai_conversations', restorable: false, order: 3,
    reason: 'Koç sohbetleri ve onay bekleyen eylemleri yalnız okunmak için dışa aktarılır; geri yükleme eski bir eylemi yeniden çalıştırabilirdi.' },
  { name: 'ai_messages', restorable: false, order: 3, relations: { conversation_id: 'ai_conversations' },
    reason: 'Sohbetle birlikte yalnız dışa aktarılır.' },
  { name: 'ai_conversation_actions', restorable: false, order: 3, relations: { conversation_id: 'ai_conversations' },
    reason: 'Koçun önerdiği eylemler ve onay durumları: yalnız dışa aktarılır, geri yükleme bir eylemi yeniden çalıştırabilirdi.' },
  { name: 'journal_insights', restorable: false, order: 3,
    reason: 'FP ile üretilen AI özetleri: dosyadan geri yüklemek ödenmemiş bir özet yaratırdı (R08.05).' },
  { name: 'routines', restorable: false, order: 3,
    reason: 'AI rutin önerilerinin geçmişi: yalnız dışa aktarılır; geri yükleme yeniden kurulum gibi davranabilirdi.' },
  { name: 'habit_deletions', restorable: false, order: 3,
    reason: 'Silinen alışkanlıkların kaydı: bilgi için dışa aktarılır.' },
  // Migrations 028/029 (NOT APPLIED): until they run these tables do not exist and are skipped, not failed.
  { name: 'habit_pauses', restorable: true, order: 2, relations: { habit_id: 'habits' } },
  { name: 'habit_goal_versions', restorable: true, order: 2, relations: { habit_id: 'habits' } },
  { name: 'habit_checklist_items', restorable: true, order: 2, relations: { habit_id: 'habits' } },
  { name: 'habit_checklist_checks', restorable: true, order: 3, relations: { item_id: 'habit_checklist_items' } },
  { name: 'device', restorable: false, order: 4,
    reason: 'Bu cihazdaki ayarlar ve yerel veriler (duygular, rutinler, hatırlatma ayarları): bilgi için dışa aktarılır, başka cihaza otomatik yazılmaz.' },
];

/**
 * R08.01 — every server collection the export reads, by table. `device` is
 * not a table: it is this device's own settings and local data.
 */
export const SERVER_COLLECTIONS = REGISTRY.map((c) => c.name).filter((n) => n !== 'device');

/**
 * R08.01 — tables the app touches that are deliberately NOT in a backup:
 * the server owns them (scores, budgets, credits, badges, profile counters,
 * install state). Pinned by __tests__/repo/backupRegistryComplete.test.ts:
 * a new table must land in the registry or here, with a reason.
 */
export const NOT_BACKED_UP: Readonly<Record<string, string>> = {
  profiles: 'XP, seviye ve sayaçlar sunucu otoritesidir (R08.05).',
  profile_badges: 'Rozetleri sunucu verir.',
  willpower_state: 'Günlük irade bütçesi sunucu tarafında yeniden kurulur.',
  credit_transactions: 'FP hareketleri sunucu otoritesidir (R08.05).',
  user_onboarding: 'Kurulum kimliği ve durumu cihaz/oturuma bağlıdır.',
};

export const specFor = (name: string) => REGISTRY.find((c) => c.name === name);

/** Fields the server owns; never taken from a file. */
export const AUTHORITY_FIELDS = [
  'xp', 'total_xp', 'level', 'focus_points', 'fp', 'willpower_rank', 'tier', 'subscription',
  'subscription_tier', 'is_premium', 'access_token', 'refresh_token', 'token', 'secret', 'headers', 'api_key',
] as const;

export function stripAuthority<T extends Record<string, unknown>>(row: T): { row: T; stripped: string[] } {
  const stripped: string[] = [];
  const out = { ...row } as Record<string, unknown>;
  for (const f of AUTHORITY_FIELDS) if (f in out) { delete out[f]; stripped.push(f); }
  return { row: out as T, stripped };
}

// ---------------------------------------------------------------------------
// Canonical JSON + checksum
// ---------------------------------------------------------------------------

export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/** FNV-1a over UTF-16 code units, 64-bit as two 32-bit lanes. */
export function checksum(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c * 31) & 0xffff), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export type Manifest = {
  format: number;
  user_id: string;
  created_at: string;
  collections: Record<string, { count: number; checksum: string }>;
  /**
   * R08.02 — the relation map: for each collection, which field points at
   * which collection (from the registry). A restore checks these ids.
   */
  relations?: Record<string, Record<string, string>>;
  /**
   * R08.02 — the consistency window. Collections are read one after another
   * between `started_at` and `finished_at`; a change made during that window
   * may or may not be in the file. The counts and checksums describe EXACTLY
   * what is in the file, so the file is internally consistent; the window
   * says how fresh it is.
   */
  snapshot?: { started_at: string; finished_at: string; rule: string };
};

export const SNAPSHOT_RULE = 'Koleksiyonlar sırayla okundu; bu pencerede yapılan değişiklik dosyada olabilir ya da olmayabilir. Sayım ve sağlamalar dosyadakini birebir tanımlar.';

export function buildManifest(
  userId: string, createdAt: string, data: Record<string, readonly unknown[]>,
  window?: { startedAt: string; finishedAt: string },
): Manifest {
  const collections: Manifest['collections'] = {};
  for (const [name, rows] of Object.entries(data)) collections[name] = { count: rows.length, checksum: checksum(canonical(rows)) };
  const relations: Record<string, Record<string, string>> = {};
  for (const c of REGISTRY) if (c.relations && collections[c.name]) relations[c.name] = { ...c.relations };
  return {
    format: BACKUP_FORMAT_VERSION, user_id: userId, created_at: createdAt, collections, relations,
    ...(window ? { snapshot: { started_at: window.startedAt, finished_at: window.finishedAt, rule: SNAPSHOT_RULE } } : {}),
  };
}

export type BackupFile = { manifest: Manifest; truncated?: string[] } & Record<string, unknown>;

export type FileCheck =
  | { ok: true; file: BackupFile; collections: Record<string, Record<string, unknown>[]> }
  | { ok: false; reason: string };

/** Parse and verify a pasted export. Nothing is trusted before this passes. */
export function verifyBackupText(text: string, signedInUserId: string): FileCheck {
  let o: BackupFile;
  try { o = JSON.parse(text); } catch { return { ok: false, reason: 'Metin bir dışa aktarım dosyası değil (JSON okunamadı).' }; }
  const m = o?.manifest;
  if (!m || typeof m !== 'object') return { ok: false, reason: 'Manifest yok: bu dosya biçim 3\'ten eski ya da düzenlenmiş. Yeniden dışa aktar.' };
  if (m.format !== BACKUP_FORMAT_VERSION) return { ok: false, reason: `Desteklenmeyen biçim (${String(m.format)}).` };
  if (m.user_id !== signedInUserId) return { ok: false, reason: 'Bu dosya başka bir hesaba ait. Hesaplar arası içe aktarma desteklenmiyor.' };
  if (Array.isArray(o.truncated) && o.truncated.length > 0) {
    return { ok: false, reason: `Dosya eksik (kesilmiş koleksiyonlar: ${o.truncated.join(', ')}). Eksik bir dosya geri yüklenmez.` };
  }
  const collections: Record<string, Record<string, unknown>[]> = {};
  for (const [name, meta] of Object.entries(m.collections ?? {})) {
    const rows = o[name];
    if (!Array.isArray(rows)) return { ok: false, reason: `"${name}" koleksiyonu dosyada yok.` };
    if (rows.length !== meta.count) return { ok: false, reason: `"${name}" sayısı tutmuyor (${rows.length} / ${meta.count}): dosya kesilmiş ya da düzenlenmiş.` };
    if (checksum(canonical(rows)) !== meta.checksum) return { ok: false, reason: `"${name}" sağlaması tutmuyor: dosya düzenlenmiş.` };
    collections[name] = rows as Record<string, unknown>[];
  }
  return { ok: true, file: o, collections };
}
