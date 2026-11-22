/**
 * F23 — Kapsam, vaat ve gizlilik beyanı hijyeni (GAP1-05, GAP1-15, NAV-20, EDG-18, GAP2-11).
 * Onaylı Sahip Kararı OD-06 (2026-11-21): hem `GOAL_LABELS.finance` hem de `EXPLORE_ORDER_LABEL`
 * `'Ev & Evrak Düzeni'` olarak sabitlenmiştir (`GOAL_IDS` içindeki `'finance'` anahtarı korunur,
 * `ExploreCategory` içindeki anahtar `'order'` olur).
 *
 * NOTE (GAP1-05): `supabase/functions/generate-routine/index.ts` saklama davranışı değişirse
 * (örneğin ham günlük metni `ai_requests` veya başka bir tabloya yazılırsa), `privacy.tsx`
 * içindeki "Günlük İçgörüsü" bölümü aynı commit'te güncellenmelidir.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import * as exploreCatalog from '../../lib/exploreCatalog';
import {
  EXPLORE_ATOMIC_HABITS,
  EXPLORE_CATEGORIES,
  EXPLORE_COLLECTIONS,
} from '../../lib/exploreCatalog';
import { GOAL_IDS, GOAL_LABELS } from '../../lib/onboarding';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(FRONTEND, ...parts), 'utf8');

const MONEY =
  /(?<![\p{L}])(para|paran|parayı|harcama[\p{L}\p{N}_]*|bütçe[\p{L}\p{N}_]*|fatura[\p{L}\p{N}_]*|tasarruf[\p{L}\p{N}_]*|yatırım[\p{L}\p{N}_]*|borç[\p{L}\p{N}_]*|maaş[\p{L}\p{N}_]*|kredi[\p{L}\p{N}_]*|finans[\p{L}\p{N}_]*)(?![\p{L}])|₺/iu;

const CLINICAL =
  /kortizol|melatonin|parasempatik|sempatik|\bREM\b|NREM|\bCAR\b|hormon|nörotransmitter|dopamin|serotonin|metabolik|Zeigarnik|tedavi|terapi|klinik|teşhis/iu;

const COMPETITOR =
  /\b(Inflow|TikTok|Thefor|Routinery|Habitify|Daylio|Finch|Tiimo|Streaks|Todoist|TickTick|Atomic Habits)\b/i;

const PRODUCTION_DIRS = [
  'app',
  'components',
  'constants',
  'hooks',
  'lib',
  'repositories',
  'services',
  'store',
  'types',
] as const;

function walkProductionTs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.tsx?$/.test(entry)) out.push(relative(root, abs).split(sep).join('/'));
    }
  };
  for (const d of PRODUCTION_DIRS) walk(join(root, d));
  return out;
}

function findMoneyFieldViolations(files: readonly string[], allowlist: ReadonlySet<string>): string[] {
  return files.filter((rel) => !allowlist.has(rel));
}

describe('A. Para / harcama yüzeyi yok ve OD-06 etiketleri sabit (F14 iptal, Thefor F-1)', () => {
  it('negatif kontrol — MONEY tarayıcısı para/harcama dizelerini yakalar, düzen dizelerini yakalamaz', () => {
    expect(MONEY.test('Günlük harcamaları kaydet')).toBe(true);
    expect(MONEY.test('Finans & Düzen')).toBe(true);
    expect(MONEY.test('bütçeni planla')).toBe(true);
    expect(MONEY.test('₺150')).toBe(true);
    expect(MONEY.test('Evrakları tek yere topla')).toBe(false);
    expect(MONEY.test('Ev & Evrak Düzeni')).toBe(false);
    expect(MONEY.test('Düzen & Çapalar')).toBe(false);
  });

  it('Keşfet kategorileri, koleksiyonlar, mikro alışkanlıklar ve GOAL_LABELS içinde para sözcüğü geçmez', () => {
    expect(EXPLORE_CATEGORIES.length).toBeGreaterThanOrEqual(7);
    expect(EXPLORE_COLLECTIONS.length).toBeGreaterThanOrEqual(5);
    expect(EXPLORE_ATOMIC_HABITS.length).toBeGreaterThanOrEqual(16);

    const hits: string[] = [];
    const check = (where: string, value: string) => {
      if (MONEY.test(value)) hits.push(`${where}: ${value}`);
    };

    for (const cat of EXPLORE_CATEGORIES) {
      check(`EXPLORE_CATEGORIES[${cat.key}].label`, cat.label);
    }
    for (const col of EXPLORE_COLLECTIONS) {
      check(`EXPLORE_COLLECTIONS[${col.key}].badge`, col.badge);
      check(`EXPLORE_COLLECTIONS[${col.key}].timeWindowLabel`, col.timeWindowLabel);
      check(`EXPLORE_COLLECTIONS[${col.key}].scientificSummary`, col.scientificSummary);
      check(`EXPLORE_COLLECTIONS[${col.key}].pack.title`, col.pack.title);
      check(`EXPLORE_COLLECTIONS[${col.key}].pack.goal`, col.pack.goal);
      for (const h of col.pack.habits) {
        check(`ROUTINE_PACKS[${col.key}].habit`, h.name);
      }
    }
    for (const item of EXPLORE_ATOMIC_HABITS) {
      check(`EXPLORE_ATOMIC_HABITS[${item.id}].name`, item.name);
      check(`EXPLORE_ATOMIC_HABITS[${item.id}].daypartLabel`, item.daypartLabel);
      check(`EXPLORE_ATOMIC_HABITS[${item.id}].life_area`, item.life_area);
      check(`EXPLORE_ATOMIC_HABITS[${item.id}].whyItWorks`, item.whyItWorks);
    }
    for (const [key, label] of Object.entries(GOAL_LABELS)) {
      check(`GOAL_LABELS.${key}`, label);
    }

    expect(hits).toEqual([]);
  });

  it('OD-06 (2026-11-21) — finance hedef anahtarı korunur ama gösterim etiketleri Ev & Evrak Düzeni olur', () => {
    const keys: string[] = EXPLORE_CATEGORIES.map((c) => c.key);
    expect(keys).toContain('order');
    expect(keys).not.toContain('finance');

    const orderLabel = (exploreCatalog as Record<string, unknown>).EXPLORE_ORDER_LABEL;
    expect(orderLabel).toBe('Ev & Evrak Düzeni');
    expect(EXPLORE_CATEGORIES.find((c) => String(c.key) === 'order')?.label).toBe('Ev & Evrak Düzeni');

    expect(GOAL_IDS).toContain('finance');
    expect(GOAL_LABELS.finance).not.toBe('Finans');
    expect(GOAL_LABELS.finance).toBe('Ev & Evrak Düzeni');
  });
});

describe('B. Kaynaksız klinik ve nörobilim iddiaları yok (F15, Thefor F-2)', () => {
  it('negatif kontrol — CLINICAL tarayıcısı klinik terimleri yakalar, sade olasılık dilini yakalamaz', () => {
    expect(CLINICAL.test('kortizol uyanış tepkisini (CAR)')).toBe(true);
    expect(CLINICAL.test('melatonin baskılanmasını önler')).toBe(true);
    expect(CLINICAL.test('Zeigarnik etkisi')).toBe(true);
    expect(CLINICAL.test('güne daha sakin başlamana yardım edebilir')).toBe(false);
  });

  it('scientificSummary ve whyItWorks metinlerinde klinik terim isabeti sıfırdır', () => {
    expect(EXPLORE_COLLECTIONS.length).toBeGreaterThanOrEqual(5);
    expect(EXPLORE_ATOMIC_HABITS.length).toBeGreaterThanOrEqual(16);

    const hits: string[] = [];
    for (const col of EXPLORE_COLLECTIONS) {
      if (CLINICAL.test(col.scientificSummary)) {
        hits.push(`collection:${col.key}: ${col.scientificSummary}`);
      }
    }
    for (const item of EXPLORE_ATOMIC_HABITS) {
      if (CLINICAL.test(item.whyItWorks)) {
        hits.push(`atomic:${item.id}: ${item.whyItWorks}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('C. Rakip marka adları kullanıcı yüzeyinde yok (PS-04)', () => {
  const targets = [
    'app/tabs/hub.tsx',
    'components/hub/ExploreView.tsx',
    'components/hub/ToolsView.tsx',
    'lib/destinations.ts',
    'lib/exploreCatalog.ts',
    'lib/routinePacks.ts',
    'lib/onboarding.ts',
    'app/(auth)/login.tsx',
  ] as const;

  it('negatif kontrol — COMPETITOR tarayıcısı Inflow adını yakalar ve hedef dosyalar doludur', () => {
    expect(COMPETITOR.test('Inflow akışı')).toBe(true);
    expect(COMPETITOR.test('Atomic Habits rafı')).toBe(true);
    expect(COMPETITOR.test('Odak mikro-dersleri')).toBe(false);
    for (const rel of targets) {
      expect(read(rel).length).toBeGreaterThan(500);
    }
  });

  it('yorumsuz kaynak metinlerde rakip marka isabeti sıfırdır', () => {
    const hits: string[] = [];
    for (const rel of targets) {
      const code = stripComments(read(rel));
      const m = COMPETITOR.exec(code);
      if (m) hits.push(`${rel}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
});

describe('D. Hub alt başlık vaatleri hedef ekranlarla hizalı (CMP1-O06)', () => {
  it('takvim alt başlığı Aylık takvim der, Zaman blokları vaat etmez; akış Odak mikro-dersleri der', () => {
    const hubAll = [
      stripComments(read('app', 'tabs', 'hub.tsx')),
      stripComments(read('components', 'hub', 'ExploreView.tsx')),
      stripComments(read('components', 'hub', 'ToolsView.tsx')),
      stripComments(read('lib', 'destinations.ts')),
    ].join('\n');
    expect(hubAll).toContain("blurb: 'Aylık takvim'");
    expect(hubAll).not.toContain('Zaman blokları');
    expect(hubAll).toContain('Odak mikro-dersleri');
    expect(hubAll).toContain('Kısa odak mikro-dersleri, tek tek');
    expect(hubAll).toContain('Hazır rutin koleksiyonları ve tek dokunuşla mikro alışkanlıklar');
  });
});

describe('E. Routine AI ücretsiz konumlandırma satırı (Thefor F-8, FREE MVP)', () => {
  it('hub yüzeyleri tek cümlelik ücretsiz konumlandırma içerir ve yasaklı abonelik/fiyat belirteçleri içermez', () => {
    const hubSurface = [
      stripComments(read('app', 'tabs', 'hub.tsx')),
      stripComments(read('components', 'hub', 'ExploreView.tsx')),
      stripComments(read('components', 'hub', 'ToolsView.tsx')),
    ].join('\n');
    expect(hubSurface).toContain('AI Rutin ücretsizdir: para istemez, yalnızca Focus Point harcar.');

    for (const banned of ['Abone Ol', 'Test modu', 'EN POPÜLER', 'Üyeliği Yükselt']) {
      expect(hubSurface).not.toContain(banned);
    }
    expect(hubSurface).not.toMatch(/\bpriceLabel\b|\bPERIOD_LABEL\b|\bBillingPeriod\b/);
  });
});

describe('F. Gizlilik beyanı ve Günlük İçgörüsü Anthropic bilgilendirmesi (GAP1-05)', () => {
  it('privacy.tsx Günlük İçgörüsü bölümünde ve sağlayıcı satırında Anthropic akışını açıklar; çelişen RLS cümlesi yoktur', () => {
    const privacy = stripComments(read('app', 'screens', 'privacy.tsx'));
    expect(privacy).not.toContain('Bu verilere yalnızca sen erişebilirsin');
    expect(privacy).toContain('Tek istisna senin başlattığın yapay zekâ özellikleridir');

    const giStart = privacy.indexOf("title: 'Günlük İçgörüsü'");
    const voiceStart = privacy.indexOf("title: 'Sesle yazdırma'");
    expect(giStart).toBeGreaterThan(-1);
    expect(voiceStart).toBeGreaterThan(giStart);

    const giSection = privacy.slice(giStart, voiceStart);
    expect(giSection).toContain('Anthropic');
    expect(giSection).toContain('8000 karakter');
    expect(giSection).toContain('tek yönlü özeti');

    const providersStart = privacy.indexOf("title: 'Hizmet sağlayıcılar'");
    expect(providersStart).toBeGreaterThan(-1);
    const providersSlice = privacy.slice(providersStart, providersStart + 400);
    expect(providersSlice).toContain(
      'Anthropic — AI Koç, AI rutin oluşturma ve Günlük İçgörüsü isteklerinin işlenmesi.',
    );
  });

  it('journal-insights.tsx kaynak kartında bilgi satırını oluşturma düğmesinden ÖNCE gösterir', () => {
    const src = stripComments(read('app', 'screens', 'journal-insights.tsx'));
    const a = src.indexOf('Anthropic’e gönderilir');
    const b = src.indexOf('onPress={generate}');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });
});

describe('G. BadHabitsTracker maliyet alanı kapsam sınırı (GAP1-15)', () => {
  const BAD_HABIT_MONEY_ALLOWLIST = new Set([
    'components/BadHabitsTracker.tsx',
    'lib/database.types.ts',
    'repositories/badHabitRepository.ts',
    'services/badHabitService.ts',
  ]);

  it('BadHabitsTracker.tsx açık kapsam notu taşır', () => {
    const trackerRaw = read('components', 'BadHabitsTracker.tsx');
    expect(trackerRaw).toContain('SCOPE (F23, GAP1-15)');
  });

  it('cost_per_day ve moneySaved alanları yalnız izinli bırakma-motivasyonu dosyalarında bulunur', () => {
    const prodFiles = walkProductionTs(FRONTEND);
    expect(prodFiles.length).toBeGreaterThan(200);

    const matching = prodFiles.filter((rel) => {
      const code = stripComments(read(rel));
      return /\bcost_per_day\b|\bmoneySaved\b/.test(code);
    });
    expect(matching).toEqual(
      expect.arrayContaining([
        'components/BadHabitsTracker.tsx',
        'repositories/badHabitRepository.ts',
        'services/badHabitService.ts',
      ]),
    );
    expect(findMoneyFieldViolations(matching, BAD_HABIT_MONEY_ALLOWLIST)).toEqual([]);
  });

  it('negatif kontrol — izin listesi dışındaki yeni bir dosya ihlal olarak yakalanır', () => {
    const synthetic = ['components/BadHabitsTracker.tsx', 'app/tabs/stats.tsx'];
    expect(findMoneyFieldViolations(synthetic, BAD_HABIT_MONEY_ALLOWLIST)).toEqual([
      'app/tabs/stats.tsx',
    ]);
  });
});

describe('H. Doğrulanamayan vaat ve sahte gönderim metinleri temizlendi (NAV-20, GAP2-11)', () => {
  it('login.tsx izleme SDK vaadi vermez; dışa aktarma ve hesap silme gerçeğini yazar', () => {
    const login = stripComments(read('app', '(auth)', 'login.tsx'));
    expect(login).not.toContain('izleme SDK');
    expect(login).not.toContain('Sıfır reklam');
    expect(login).toContain('Tam Veri Egemenliği');
    expect(login).toContain('Reklam yok. Verilerini dışa aktarabilir, hesabını silebilirsin.');
  });

  it('todayNarrative.ts suçluluk üreten seriyi koru ifadesini içermez', () => {
    const narrative = stripComments(read('lib', 'todayNarrative.ts'));
    expect(narrative).not.toContain('seriyi koru');
    expect(narrative).toContain('seni bekliyor; hazır olduğunda başla.');
  });

  it('IntegrationDetailModal.tsx sahte test olayı gönderildi iddiası veya ağ çağrısı içermez', () => {
    const modal = stripComments(read('components', 'IntegrationDetailModal.tsx'));
    expect(modal).toContain('Adresi kontrol et');
    expect(modal).not.toContain('Test Olayı Gönderildi');
    expect(modal).not.toContain('Test Olayı Tetikle');
    expect(modal).not.toContain('iletildi');
    expect(modal).not.toContain('gönderildi');
    expect(modal).not.toContain('fetch(');
    expect(modal).not.toContain('functions.invoke');
  });
});
