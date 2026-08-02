// Odak raporu — focus_sessions üzerinden saf hesaplamalar.
// Artifact (POS v2) FocusReport mantığının RN karşılığı. mode='work' = odak seansı.

export type FocusSessionRow = {
  id: string;
  task_id: string | null;
  task_title: string | null;
  mode: string;
  started_at: string;
  ended_at: string | null;
  planned_seconds: number;
  completed_seconds: number;
  completed: boolean;
};

export type ReportRange = 'today' | 'week' | 'month' | 'year';

export const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
// Pazartesi başlangıçlı hafta etiketleri
export const DOW_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function rangeStart(range: ReportRange, now: Date = new Date()): Date {
  if (range === 'today') {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return d;
  }
  if (range === 'week') {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7; // Pzt=0
    d.setDate(d.getDate() - dow);
    return d;
  }
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), 0, 1); // year
}

// Aralıktaki odak (work) seansları
export function inRange(sessions: FocusSessionRow[], range: ReportRange, now: Date = new Date()): FocusSessionRow[] {
  const start = rangeStart(range, now);
  return sessions.filter((sn) => sn.mode === 'work' && new Date(sn.started_at) >= start);
}

export type FocusSummary = {
  totalSeconds: number;
  totalSessions: number;
  daysFocused: number;
  completedCount: number;
  interruptedCount: number;
};

export function summary(sessions: FocusSessionRow[]): FocusSummary {
  const totalSeconds = sessions.reduce((a, s) => a + (s.completed_seconds || 0), 0);
  const days = new Set(sessions.map((s) => s.started_at.slice(0, 10)));
  return {
    totalSeconds,
    totalSessions: sessions.length,
    daysFocused: days.size,
    completedCount: sessions.filter((s) => s.completed).length,
    interruptedCount: sessions.filter((s) => !s.completed).length,
  };
}

export type TaskAgg = { title: string; totalSeconds: number; count: number; completed: number };

export function byTask(sessions: FocusSessionRow[]): TaskAgg[] {
  const map = new Map<string, TaskAgg>();
  for (const s of sessions) {
    const k = s.task_title || '(görevsiz)';
    const cur = map.get(k) || { title: k, totalSeconds: 0, count: 0, completed: 0 };
    cur.totalSeconds += s.completed_seconds || 0;
    cur.count += 1;
    if (s.completed) cur.completed += 1;
    map.set(k, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.totalSeconds - a.totalSeconds);
}

export type Bucket = { label: string; seconds: number; key?: string };

export function buckets(sessions: FocusSessionRow[], range: ReportRange, now: Date = new Date()): Bucket[] {
  if (range === 'year') {
    const arr: Bucket[] = MONTHS_TR.map((m) => ({ label: m, seconds: 0 }));
    sessions.forEach((s) => { arr[new Date(s.started_at).getMonth()].seconds += s.completed_seconds || 0; });
    return arr;
  }
  if (range === 'today') {
    const arr: Bucket[] = Array.from({ length: 24 }, (_, i) => ({ label: String(i).padStart(2, '0'), seconds: 0 }));
    sessions.forEach((s) => { arr[new Date(s.started_at).getHours()].seconds += s.completed_seconds || 0; });
    return arr.slice(6); // 06–23 arası kompakt
  }
  const start = rangeStart(range, now);
  const days = range === 'week' ? 7 : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const arr: Bucket[] = [];
  const today = new Date(now); today.setHours(23, 59, 59, 0);
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    if (d > today) break;
    arr.push({ label: range === 'week' ? DOW_TR[i] : String(d.getDate()), key: ymd(d), seconds: 0 });
  }
  sessions.forEach((s) => {
    const k = s.started_at.slice(0, 10);
    const b = arr.find((x) => x.key === k);
    if (b) b.seconds += s.completed_seconds || 0;
  });
  return arr;
}

export type Ranking = {
  mostFocusedTask: TaskAgg | null;
  mostCompletedTask: TaskAgg | null;
  topDay: { date: string; seconds: number } | null;
  topHour: { hour: number; seconds: number } | null;
  streak: number;
};

export function ranking(sessions: FocusSessionRow[]): Ranking {
  const tasks = byTask(sessions);
  const byDay: Record<string, number> = {};
  sessions.forEach((s) => { const k = s.started_at.slice(0, 10); byDay[k] = (byDay[k] || 0) + (s.completed_seconds || 0); });
  const topDayEntry = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  const byHour: Record<number, number> = {};
  sessions.forEach((s) => { const h = new Date(s.started_at).getHours(); byHour[h] = (byHour[h] || 0) + (s.completed_seconds || 0); });
  const topHourEntry = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0];

  // Streak: ardışık (≥1 tamamlanan seans) günler, bugünden/dünden geri
  const doneDays = new Set(sessions.filter((s) => s.completed).map((s) => s.started_at.slice(0, 10)));
  let streak = 0;
  const cur = new Date(); cur.setHours(0, 0, 0, 0);
  if (!doneDays.has(ymd(cur))) cur.setDate(cur.getDate() - 1);
  while (doneDays.has(ymd(cur))) { streak++; cur.setDate(cur.getDate() - 1); }

  const mostCompleted = [...tasks].sort((a, b) => b.completed - a.completed)[0];
  return {
    mostFocusedTask: tasks[0] || null,
    mostCompletedTask: mostCompleted || null,
    topDay: topDayEntry ? { date: topDayEntry[0], seconds: topDayEntry[1] } : null,
    topHour: topHourEntry ? { hour: Number(topHourEntry[0]), seconds: topHourEntry[1] } : null,
    streak,
  };
}

export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m === 0) return '0d';
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}s ${mm}d` : `${m}d`;
}

export function fmtHours(sec: number): string {
  return (sec / 3600).toFixed(1);
}

// Seansları CSV metnine çevir (dışa aktarma için)
export function toCSV(sessions: FocusSessionRow[]): string {
  const head = ['task_title', 'mode', 'started_at', 'ended_at', 'planned_seconds', 'completed_seconds', 'completed'];
  const esc = (v: unknown) => {
    const str = v == null ? '' : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const rows = sessions.map((s) =>
    [s.task_title, s.mode, s.started_at, s.ended_at, s.planned_seconds, s.completed_seconds, s.completed].map(esc).join(',')
  );
  return head.join(',') + '\n' + rows.join('\n');
}

// ── Excel dışa aktarma (SpreadsheetML 2003 XML) ─────────────────────────────
// Bağımlılıksız: Excel / Google Sheets / LibreOffice bu düz-metin XML'i gerçek
// (çok sayfalı) tablo olarak açar. Gerçek .xlsx ikilisi için kütüphane gerekir.
export type ExcelCell = string | number | boolean | null | undefined;
export type ExcelSheet = { name: string; headers: string[]; rows: ExcelCell[][] };

function xmlEsc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xlCell(v: ExcelCell): string {
  if (typeof v === 'number' && isFinite(v)) return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  const text = typeof v === 'boolean' ? (v ? 'Evet' : 'Hayır') : v;
  return `<Cell><Data ss:Type="String">${xmlEsc(text)}</Data></Cell>`;
}

export function toExcelXML(sheets: ExcelSheet[]): string {
  const sheetXml = (sh: ExcelSheet) => {
    const name = xmlEsc(sh.name.slice(0, 31).replace(/[[\]:*?/\\]/g, ' '));
    const header = `<Row>${sh.headers.map((h) => xlCell(h)).join('')}</Row>`;
    const body = sh.rows.map((r) => `<Row>${r.map(xlCell).join('')}</Row>`).join('');
    return `<Worksheet ss:Name="${name}"><Table>${header}${body}</Table></Worksheet>`;
  };
  return (
    '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"' +
    ' xmlns:o="urn:schemas-microsoft-com:office:office"' +
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"' +
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"' +
    ' xmlns:html="http://www.w3.org/TR/REC-html40">' +
    sheets.map(sheetXml).join('') +
    '</Workbook>'
  );
}

// ── Dışa aktarma biçimi + platform yardımcıları ────────────────────────────
export type ExportFmt = 'json' | 'csv' | 'excel';

export const EXPORT_META: Record<ExportFmt, { ext: string; mime: string }> = {
  json: { ext: 'json', mime: 'application/json' },
  csv: { ext: 'csv', mime: 'text/csv;charset=utf-8' },
  excel: { ext: 'xls', mime: 'application/vnd.ms-excel' },
};

// Web'de gerçek dosya indir (Share API masaüstü tarayıcılarda yok/no-op).
// RN-Web'de document/Blob mevcut; native'de bu kod yolu hiç çağrılmaz.
export function webDownload(filename: string, mime: string, content: string): boolean {
  try {
    const g = globalThis as any;
    if (!g?.document || !g?.Blob || !g?.URL?.createObjectURL) return false;
    const blob = new g.Blob([content], { type: mime });
    const url = g.URL.createObjectURL(blob);
    const a = g.document.createElement('a');
    a.href = url;
    a.download = filename;
    g.document.body.appendChild(a);
    a.click();
    a.remove();
    g.URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

// Oturumları tek bir Excel sayfasına çevir (toCSV ile aynı kolonlar)
export function sessionsSheet(sessions: FocusSessionRow[], name = 'Oturumlar'): ExcelSheet {
  return {
    name,
    headers: ['task_title', 'mode', 'started_at', 'ended_at', 'planned_seconds', 'completed_seconds', 'completed'],
    rows: sessions.map((s) => [
      s.task_title ?? '', s.mode, s.started_at, s.ended_at ?? '',
      s.planned_seconds, s.completed_seconds, s.completed,
    ]),
  };
}
