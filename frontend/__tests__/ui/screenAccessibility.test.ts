/**
 * Ekran erişilebilirlik geçidi — plan §24 "accessibility" / "skeleton states".
 *
 * NEDEN GREP DEĞİL, TOKENIZER. Bu depo yüzeysel-eşleşme tuzağına DÖRT kez
 * düştü: bir desen bir *yorum* satırındaki `return;`e eşleşip geçti, dosya
 * kapsamlı bir iddia aynı dosyanın altındaki *başka* bir bileşen tarafından
 * karşılandı. Basit bir `src.includes('accessibilityLabel')` burada tam olarak
 * o hatayı yapardı: bir ekranda tek bir etiketli buton, o dosyadaki diğer 24
 * etiketsiz butonu görünmez kılardı.
 *
 * Bu yüzden kaynak, gerçek bir tarayıcıdan geçirilir:
 *
 *   1. `blankNonCode` yorum gövdelerini ve dize/şablon-literal içeriklerini
 *      boşlukla değiştirir — İNDİSLERİ KORUYARAK, böylece ham kaynaktan aynı
 *      aralığı dilimleyip gerçek etiket metnini de okuyabiliriz. Şablon
 *      literallerinin `${...}` bölümleri KOD sayılır (etiketler çoğu zaman
 *      `` `${ad} sil` `` biçiminde kurulur).
 *   2. `openingTags` her `<TouchableOpacity` / `<Pressable` için SADECE O
 *      ETİKETİN kendi öznitelik aralığını çıkarır — dosyanın tamamını değil.
 *      Küme parantezi derinliği sayıldığı için `onPress={() => x}` içindeki
 *      `>` etiketi erken kapatmaz.
 *
 * Tarayıcının kendisi de test edilir (AC-A05): sentetik bir örnekte yorum ve
 * dize içine gizlenmiş `accessibilityLabel` SAYILMAMALI, gerçek bir ihlal ise
 * yakalanmalı. Tarayıcı bozulursa testler sessizce yeşile dönmez.
 *
 * `react-test-renderer` bilerek kullanılmıyor: jest-expo ile geliyor ama tip
 * bildirimleri kurulu değil, dolayısıyla içe aktarmak `npx tsc --noEmit`
 * çıktısına hata ekler — ağaçta bunun canlı bir örneği zaten var
 * (`__tests__/lib/errorBoundary.test.tsx`). Aynı gerekçe
 * `__tests__/ui/syncStatusBadge.test.ts` içinde de yazılı.
 *
 * AC-A01  hiçbir dokunulabilir öğe etiketsiz/rolsüz kalmaz
 * AC-A02  tarama gerçekten öğe buluyor (boş taramayla sahte yeşil olmaz)
 * AC-A03  accessibilityLabel değerleri boş dize değildir
 * AC-A04  ekranlarda tam-ekran çıplak spinner (`size="large"`) kalmadı
 * AC-A05  tarayıcı yorum/dize içindeki eşleşmelere kanmaz, ihlali yakalar
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { INTERACTIVE, blankNonCode, openingTags } from '../helpers/a11yScan';

const SCREENS_DIR = join(__dirname, '..', '..', 'app', 'screens');

const HAS_LABEL = /\baccessibilityLabel\b/;
const HAS_ROLE = /\baccessibilityRole\b/;
/** `accessible={false}` → geliştirici öğeyi bilerek a11y ağacından çıkarmış. */
const OPTED_OUT = /\baccessible\s*=\s*\{\s*false\s*\}/;

const SCREEN_FILES = readdirSync(SCREENS_DIR)
  .filter((f) => f.endsWith('.tsx'))
  .sort();

const SOURCES = SCREEN_FILES.map((file) => {
  const raw = readFileSync(join(SCREENS_DIR, file), 'utf8');
  return { file, raw, ...blankNonCode(raw) };
});

// ---------------------------------------------------------------------------

describe('app/screens — erişilebilirlik', () => {
  it('tarayıcı her ekranı sonuna kadar dengeli okuyor (sessiz sahte yeşil yok)', () => {
    const confused = SOURCES.filter((s) => !s.balanced).map((s) => s.file);
    expect(confused).toEqual([]);
    expect(SCREEN_FILES.length).toBeGreaterThanOrEqual(25);
  });

  // AC-A01
  it('hiçbir dokunulabilir öğe accessibilityLabel/accessibilityRole olmadan render edilmiyor', () => {
    const offenders: string[] = [];

    for (const { file, raw, blanked } of SOURCES) {
      for (const component of INTERACTIVE) {
        for (const tag of openingTags(raw, blanked, component)) {
          if (OPTED_OUT.test(tag.attrs)) continue;
          if (HAS_LABEL.test(tag.attrs) || HAS_ROLE.test(tag.attrs)) continue;
          offenders.push(`${file}:${tag.line} <${component}>`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  // AC-A02 — taramanın gerçekten iş gördüğünün kanıtı. Tarayıcı bozulup sıfır
  // etiket bulsaydı AC-A01 boş listeyle "geçerdi"; bu iddia onu engeller.
  it('tarama ekranlarda gerçekten çok sayıda dokunulabilir öğe buluyor', () => {
    const total = SOURCES.reduce(
      (sum, { raw, blanked }) =>
        sum + INTERACTIVE.reduce((n, c) => n + openingTags(raw, blanked, c).length, 0),
      0,
    );
    expect(total).toBeGreaterThan(100);
  });

  // AC-A03
  it('accessibilityLabel değerleri boş dize değil', () => {
    const empty: string[] = [];
    for (const { file, raw, blanked } of SOURCES) {
      for (const component of INTERACTIVE) {
        for (const tag of openingTags(raw, blanked, component)) {
          const m = tag.rawAttrs.match(/\baccessibilityLabel\s*=\s*(["'])(.*?)\1/);
          if (m && m[2].trim() === '') empty.push(`${file}:${tag.line}`);
        }
      }
    }
    expect(empty).toEqual([]);
  });

  // AC-A04 — plan §24 "skeleton states". Bu kod tabanında tam-ekran yükleme
  // dalının imzası tam olarak `<ActivityIndicator size="large">` idi; buton
  // içindeki kısa belirsiz eylemler `size="small"` kullanıyor ve dokunulmadı.
  it('ekranlarda tam-ekran çıplak spinner kalmadı', () => {
    const spinners: string[] = [];
    for (const { file, raw, blanked } of SOURCES) {
      for (const tag of openingTags(raw, blanked, 'ActivityIndicator')) {
        if (/\bsize\s*=\s*(["']large["']|\{\s*['"]large['"]\s*\})/.test(tag.rawAttrs)) {
          spinners.push(`${file}:${tag.line}`);
        }
      }
    }
    expect(spinners).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-A05 — tarayıcının kendi testi.
// ---------------------------------------------------------------------------

describe('tarayıcı yüzeysel eşleşmeye kanmıyor', () => {
  const scan = (src: string) => {
    const { blanked } = blankNonCode(src);
    return openingTags(src, blanked, 'TouchableOpacity').map(
      (t) => HAS_LABEL.test(t.attrs) || HAS_ROLE.test(t.attrs),
    );
  };

  it('yorum içindeki accessibilityLabel etiketi karşılamaz', () => {
    expect(
      scan(`
        // accessibilityLabel="Sil"
        /* accessibilityRole="button" */
        <TouchableOpacity onPress={go}>
          {/* accessibilityLabel="Sil" */}
          <Ionicons name="trash" />
        </TouchableOpacity>
      `),
    ).toEqual([false]);
  });

  it('dize içindeki accessibilityLabel etiketi karşılamaz', () => {
    expect(scan(`<TouchableOpacity title="accessibilityLabel" onPress={go} />`)).toEqual([false]);
  });

  it('aynı dosyadaki BAŞKA bir etiketin özniteliği ihlali örtmez', () => {
    expect(
      scan(`
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Kaydet" onPress={a} />
        <TouchableOpacity onPress={b}><Ionicons name="close" /></TouchableOpacity>
      `),
    ).toEqual([true, false]);
  });

  it('ok fonksiyonundaki > açılış etiketini erken kapatmaz', () => {
    expect(
      scan(`<TouchableOpacity onPress={() => setX(a > b)} accessibilityRole="button" accessibilityLabel="Aç" />`),
    ).toEqual([true]);
  });

  it('şablon literaliyle kurulan etiket sayılır, düz metni sayılmaz', () => {
    expect(scan('<TouchableOpacity accessibilityLabel={`${ad} sil`} onPress={go} />')).toEqual([true]);
    expect(scan('<TouchableOpacity onPress={go} title={`accessibilityLabel`} />')).toEqual([false]);
  });

  it('dengesiz bağlamı bildirir', () => {
    expect(blankNonCode('const a = "kapanmamış').balanced).toBe(false);
    expect(blankNonCode('const a = "kapalı";').balanced).toBe(true);
  });
});
