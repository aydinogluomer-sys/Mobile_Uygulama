/**
 * `components/ui/*` erişilebilirlik sözleşmesi — plan §24 Phase 4.
 *
 * NEDEN RENDER TESTİ, KAYNAK TARAMASI DEĞİL. Bu depo yüzeysel-eşleşme
 * tuzağına ALTI kez düştü (bir yorum satırına eşleşme; aynı dosyadaki BAŞKA
 * bir bileşenin karşıladığı dosya kapsamlı iddia; yanlış offset'ten kesilmiş
 * gövde dilimi; `indexOf` -1 döndürdüğü için sıralama iddiasının yokluğu
 * geçirmesi). Burada iddia edilen şey tam olarak bir grep'in GÖREMEYECEĞİ
 * şey: bileşenin erişilebilirlik ağacına ne YAYDIĞI. `accessibilityRole`
 * kelimesinin dosyada geçmesi hiçbir şey kanıtlamaz — yanlış dala, yanlış
 * öğeye ya da çağıranın değerini EZECEK sırada yazılmış olabilir. Bu yüzden
 * her iddia gerçek çıktı ağacından okunur.
 *
 * İKİ TUZAK, ikisi de burada bilinçle ele alındı:
 *
 *  1. `root.findAllByType(...)` test ÖRNEKLERİ döndürür, dize değil; metin
 *     iddiaları sessizce `''` üzerinde çalışır ve her negatif iddia boşuna
 *     geçer. Bu yüzden `textOf`/`nodes` serileştirilmiş ağacı (`toJSON`)
 *     dolaşır — `__tests__/lib/errorBoundary.test.tsx` ile aynı gerekçe.
 *  2. `@expo/vector-icons` font yüklenene kadar PROP'SUZ bir `<Text />`
 *     yer tutucusu döndürür. O ara durumda "ikon gizli" iddiası, üretimde
 *     gizleme tamamen silinse bile geçerdi — çünkü props zaten boştur.
 *     `render()` bu yüzden ASENKRON `act` kullanır ve AC-U00'ın ikinci testi
 *     ikon düğümünün gerçekten gözlenebilir olduğunu doğrular; olmasaydı o
 *     test `length 0` ile patlar, sessizce geçmezdi.
 *
 * Her negatif iddianın yanında onu anlamlı kılan pozitif eşi var: "gizli
 * değil" iddiaları "gizli" örneğiyle, "metin yok" iddiaları "metin var"
 * örneğiyle birlikte duruyor. Yoksa boş bir ağaç tüm dosyayı yeşile boyardı.
 *
 * AC-U00  yardımcılar gerçekten içerik görüyor (boş ağaçla sahte yeşil olmaz)
 * AC-U01  Button: varsayılan rol/etiket + sahip olunan durum (disabled/busy)
 * AC-U02  Chip: dokunulabilirde `button` rolü + `selected` durumu
 * AC-U03  Card / StatTile: `onPress` varsa `button`, `selected` duyurulur
 * AC-U04  Çağıranın verdiği rol/etiket varsayılanı EZER (tersi değil)
 * AC-U05  Süsleme öğeleri ağaçtan gizli kalır (IconCircle, ProgressBar, yay, dot)
 * AC-U06  Progress bileşenleri etiketlendiğinde `progressbar` + değer yayar
 * AC-U07  WillpowerBand tek parça olarak, sayılarıyla duyurulur
 * AC-U08  SyncStatusBadge etiketi atıl değil (gruplanmış öğe)
 */
import { Platform, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Chip from '../../components/ui/Chip';
import EmptyState from '../../components/ui/EmptyState';
import IconCircle from '../../components/ui/IconCircle';
import ProgressBar from '../../components/ui/ProgressBar';
import ProgressRing from '../../components/ui/ProgressRing';
import SectionHeader from '../../components/ui/SectionHeader';
import Skeleton from '../../components/ui/Skeleton';
import StatTile from '../../components/ui/StatTile';
import SyncStatusBadge, { syncBadgeA11yLabel } from '../../components/ui/SyncStatusBadge';
import WillpowerBand from '../../components/ui/WillpowerBand';

type Json = TestRenderer.ReactTestRendererJSON;

/**
 * 30 s per test, not jest's default 5 s.
 *
 * This suite mounts 38 components, and the FIRST mount also pays for
 * `@expo/vector-icons` resolving its font promise. On an idle machine the
 * whole file finishes in about two seconds, so the default never bites. Under
 * the full suite it competes with 97 others for a worker, and roughly one run
 * in ten it lost — the file took 45 s and the first two tests failed with
 * `Exceeded timeout of 5000 ms`, always the two that mount first. Reproduced
 * on demand with `npx jest --maxWorkers=16`, which fails them every time.
 *
 * That is a scheduling artefact, not a defect being caught, and a gate that
 * goes red at random is the same disease as one that is green for the wrong
 * reason: both teach people to press the button again. CI runs on a smaller,
 * busier machine than this one, so it is the more exposed of the two.
 *
 * 30 s is chosen as a real hang threshold — a synchronous mount that has not
 * finished in thirty seconds is genuinely stuck, and the timeout still catches
 * that. It is not `Infinity`, which would be giving up on the check.
 */
jest.setTimeout(30_000);

/**
 * Ağacı ASENKRON bir `act` içinde oluşturur — bu bir stil tercihi değil,
 * iddiaların anlamlı olmasının koşulu.
 *
 * `@expo/vector-icons`'un `createIconSet`'i font yüklenene kadar PROP'SUZ bir
 * `<Text />` yer tutucusu döndürür. Senkron `act(() => create(...))` ile ağaç
 * tam olarak o ara durumda dondurulur: ikona verilen erişilebilirlik
 * prop'ları çıktıda HİÇ görünmez, dolayısıyla "süsleme ikon gizli" iddiası
 * üretim kodundan gizleme tamamen silinse bile geçerdi — sessiz bir sahte
 * yeşil. Asenkron `act` font promise'inin çözülmesine izin verir.
 *
 * Bu iddia ÖLÇÜLDÜ, tahmin edilmedi. `await act(async …)` → `act(() => …)`
 * mutasyonu, ikon içeren ilk render süreçte tek başına koştuğunda AC-U00'ın
 * ikinci testini kırmızıya çeviriyor (`Received length: 0` — ikon düğümü
 * ağaçta yok). Aynı mutasyon DOSYANIN TAMAMI koşarken 38 testi de yeşil
 * bırakıyor, çünkü font ilk testte bir kez yüklendikten sonra `createIconSet`
 * onu senkron görüyor. Yani asenkron `act` bu dosyanın sıralamasına bağlı
 * kalmamak için var — ve AC-U00'ın ikinci testi, ikon düğümü gerçekten
 * gözlenebilir DEĞİLSE sessizce geçmek yerine gürültüyle patlayan bekçi.
 * Ardından ayrıca bir `setTimeout(0)` tick'i beklemek GEREKMİYOR: denendi,
 * hiçbir testi değiştirmedi, bu yüzden yok.
 */
async function render(el: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(el);
  });
  return tree;
}

/** Serileştirilmiş ağaçtaki TÜM host düğümleri, kök dahil, düz liste. */
function nodes(tree: TestRenderer.ReactTestRenderer): Json[] {
  const out: Json[] = [];
  const walk = (n: Json | string | null): void => {
    if (n == null || typeof n === 'string') return;
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out;
}

/** Kök host düğüm — bileşenin dış kabı. */
function root(tree: TestRenderer.ReactTestRenderer): Json {
  const all = nodes(tree);
  if (all.length === 0) throw new Error('boş ağaç — iddialar anlamsız olurdu');
  return all[0];
}

/** Görünen tüm metin, düzleştirilmiş (bkz. errorBoundary.test.tsx'teki gerekçe). */
function textOf(tree: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: Json | string | null): void => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    (n.children ?? []).forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out.join(' ');
}

/** iOS + Android'in ikisinde birden ağaçtan çıkarılmış mı? */
function isHidden(n: Json): boolean {
  return (
    n.props.accessibilityElementsHidden === true &&
    n.props.importantForAccessibility === 'no-hide-descendants'
  );
}

// ---------------------------------------------------------------------------
// AC-U00 — yardımcıların kendisi
// ---------------------------------------------------------------------------

describe('AC-U00 — yardımcılar gerçekten içerik görüyor', () => {
  it('nodes() birden fazla host düğüm, textOf() gerçek metin döndürür', async () => {
    const tree = await render(<Chip label="Sabah" icon="sunny" />);
    // Boş bir liste / boş dize dönseydi bu dosyadaki her negatif iddia
    // (toHaveLength(0), not.toContain) sahte yeşile dönerdi.
    expect(nodes(tree).length).toBeGreaterThan(1);
    expect(textOf(tree)).toContain('Sabah');
  });

  it('ikon fontu beklendiği için ikonun prop\'ları ağaçta GÖRÜNÜR', async () => {
    // Bu bekleyiş olmasaydı ikon prop'suz bir <Text /> olurdu ve AC-U05'in
    // ikon iddiaları hiçbir şey ölçmezdi.
    const tree = await render(<Chip label="Sabah" icon="sunny" />);
    const iconish = nodes(tree).filter((n) => n.type === 'Text' && n.props.allowFontScaling === false);
    expect(iconish).toHaveLength(1);
    expect(isHidden(iconish[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-U01 — Button
// ---------------------------------------------------------------------------

describe('AC-U01 — Button varsayılan rolü, etiketi ve sahip olduğu durumu yayar', () => {
  it('rolsüz bir dokunulabilir olmaktan çıktı: role=button', async () => {
    const tree = await render(<Button label="Telafi Et" onPress={() => {}} />);
    expect(root(tree).props.accessibilityRole).toBe('button');
  });

  it('etiket prop\'u erişilebilirlik etiketi olur', async () => {
    const tree = await render(<Button label="Telafi Et" onPress={() => {}} />);
    expect(root(tree).props.accessibilityLabel).toBe('Telafi Et');
    // Pozitif eş: normalde metin de ağaçta var.
    expect(textOf(tree)).toContain('Telafi Et');
  });

  it('loading iken buton SESSİZLEŞMEZ — metin gider, etiket kalır', async () => {
    // Asıl kazanç bu: `loading` görünen `<Text>`i ActivityIndicator ile
    // değiştiriyor. Varsayılan etiket olmasaydı ekran okuyucu için buton
    // tamamen isimsiz kalırdı.
    const tree = await render(<Button label="Kaydet" loading onPress={() => {}} />);
    expect(textOf(tree)).not.toContain('Kaydet');
    expect(root(tree).props.accessibilityLabel).toBe('Kaydet');
  });

  it('disabled ve busy durumları duyurulur', async () => {
    const idle = await render(<Button label="Kaydet" onPress={() => {}} />);
    expect(root(idle).props.accessibilityState).toMatchObject({ disabled: false, busy: false });

    const busy = await render(<Button label="Kaydet" loading onPress={() => {}} />);
    expect(root(busy).props.accessibilityState).toMatchObject({ disabled: true, busy: true });

    const off = await render(<Button label="Kaydet" disabled onPress={() => {}} />);
    expect(root(off).props.accessibilityState).toMatchObject({ disabled: true, busy: false });
  });
});

// ---------------------------------------------------------------------------
// AC-U02 — Chip
// ---------------------------------------------------------------------------

describe('AC-U02 — Chip seçim durumunu duyurur', () => {
  it('dokunulabilir chip button rolü alır', async () => {
    const tree = await render(<Chip label="Bugün" selected onPress={() => {}} />);
    expect(root(tree).props.accessibilityRole).toBe('button');
  });

  it('selected true/false ayrı ayrı duyurulur', async () => {
    const on = await render(<Chip label="Bugün" selected onPress={() => {}} />);
    expect(root(on).props.accessibilityState).toEqual({ selected: true });

    const offTree = await render(<Chip label="Bugün" selected={false} onPress={() => {}} />);
    expect(root(offTree).props.accessibilityState).toEqual({ selected: false });
  });

  it('selected verilmemiş chip "seçili değil" diye YALAN söylemez', async () => {
    const tree = await render(<Chip label="Etiket" />);
    expect(root(tree).props.accessibilityState).toBeUndefined();
    // Pozitif eş: aynı bileşen selected verilince durumu gerçekten yayıyor.
    const withState = await render(<Chip label="Etiket" selected />);
    expect(root(withState).props.accessibilityState).toEqual({ selected: true });
  });

  it('dokunulamayan chip button rolü UYDURMAZ', async () => {
    const tree = await render(<Chip label="Etiket" />);
    expect(root(tree).props.accessibilityRole).toBeUndefined();
    // Pozitif eş: onPress verilince rol geliyor.
    const pressable = await render(<Chip label="Etiket" onPress={() => {}} />);
    expect(pressable && root(pressable).props.accessibilityRole).toBe('button');
  });
});

// ---------------------------------------------------------------------------
// AC-U03 — Card / StatTile
// ---------------------------------------------------------------------------

describe('AC-U03 — Card ve StatTile', () => {
  it('onPress verilen Card button rolü alır, verilmeyen almaz', async () => {
    const pressable = await render(<Card onPress={() => {}}><Text>içerik</Text></Card>);
    expect(root(pressable).props.accessibilityRole).toBe('button');

    const staticCard = await render(<Card><Text>içerik</Text></Card>);
    expect(root(staticCard).props.accessibilityRole).toBeUndefined();
    // Negatif iddianın boşuna geçmediğini gösteren pozitif eş:
    expect(textOf(staticCard)).toContain('içerik');
  });

  it('Card selected durumunu duyurur; verilmediğinde durum uydurmaz', async () => {
    const sel = await render(<Card selected onPress={() => {}}><Text>x</Text></Card>);
    expect(root(sel).props.accessibilityState).toEqual({ selected: true });

    // Dokunulabilir dalda RN'in kendi Pressability katmanı her zaman bir
    // `accessibilityState` iskeleti (`{selected: undefined, ...}`) üretir, bu
    // yüzden burada nesnenin YOKLUĞU değil, `selected` anahtarının
    // duyurulmaması iddia ediliyor.
    const plain = await render(<Card onPress={() => {}}><Text>x</Text></Card>);
    expect(root(plain).props.accessibilityState?.selected).toBeUndefined();

    // Dokunulamayan dalda düz bir View var; orada nesnenin kendisi hiç oluşmaz.
    const staticCard = await render(<Card><Text>x</Text></Card>);
    expect(root(staticCard).props.accessibilityState).toBeUndefined();
    const staticSelected = await render(<Card selected={false}><Text>x</Text></Card>);
    expect(root(staticSelected).props.accessibilityState).toEqual({ selected: false });
  });

  it('Card çocuk metnini bir etiketle EZMEZ', async () => {
    // Kart içeriği zaten metin; uydurulmuş bir etiket o metnin yerine geçer ve
    // bilgi kaybettirirdi.
    const tree = await render(<Card onPress={() => {}}><Text>Seri 12 gün</Text></Card>);
    expect(root(tree).props.accessibilityLabel).toBeUndefined();
    expect(textOf(tree)).toContain('Seri 12 gün');
  });

  it('StatTile erişilebilirlik prop\'larını Card\'a geçirir', async () => {
    const tree = await render(
      <StatTile value={12} label="Seri" onPress={() => {}} accessibilityLabel="Seri: 12 gün" />,
    );
    expect(root(tree).props.accessibilityRole).toBe('button');
    expect(root(tree).props.accessibilityLabel).toBe('Seri: 12 gün');
  });

  it('StatTile içindeki ilerleme çubuğu süslemedir ve gizlidir', async () => {
    const tree = await render(<StatTile value={12} label="Seri" progress={0.5} />);
    const hidden = nodes(tree).filter(isHidden);
    expect(hidden.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-U04 — çağıran varsayılanı ezer
// ---------------------------------------------------------------------------

describe('AC-U04 — çağıranın verdiği değer varsayılanı EZER', () => {
  it('Button: çağıranın etiketi ve rolü kazanır', async () => {
    const tree = await render(
      <Button
        label="Sil"
        onPress={() => {}}
        accessibilityLabel="Sabah koşusunu sil"
        accessibilityRole="link"
        accessibilityHint="Alışkanlık kalıcı olarak silinir"
      />,
    );
    const p = root(tree).props;
    expect(p.accessibilityLabel).toBe('Sabah koşusunu sil');
    expect(p.accessibilityRole).toBe('link');
    expect(p.accessibilityHint).toBe('Alışkanlık kalıcı olarak silinir');
    // Ama görünen metin hâlâ "Sil" — etiket metnin yerine geçmiyor, üstüne biniyor.
    expect(textOf(tree)).toContain('Sil');
  });

  it('Button: çağıranın durumu sahip olunan durumla BİRLEŞİR ve çakışmada kazanır', async () => {
    const tree = await render(
      <Button label="Kaydet" loading onPress={() => {}} accessibilityState={{ busy: false, selected: true }} />,
    );
    // `disabled` bileşenin bildiği gerçek olarak kalır; `busy` çağıran
    // tarafından ezilir; `selected` eklenir.
    expect(root(tree).props.accessibilityState).toEqual({ disabled: true, busy: false, selected: true });
  });

  it('Chip: çağıranın rolü/etiketi kazanır, durumu birleşir', async () => {
    const tree = await render(
      <Chip
        label="Bugün"
        selected
        onPress={() => {}}
        accessibilityRole="tab"
        accessibilityLabel="Bugünü göster"
        accessibilityState={{ expanded: true }}
      />,
    );
    const p = root(tree).props;
    expect(p.accessibilityRole).toBe('tab');
    expect(p.accessibilityLabel).toBe('Bugünü göster');
    expect(p.accessibilityState).toEqual({ selected: true, expanded: true });
  });

  it('Card: çağıranın rolü kazanır', async () => {
    const tree = await render(
      <Card onPress={() => {}} accessibilityRole="radio" selected><Text>x</Text></Card>,
    );
    expect(root(tree).props.accessibilityRole).toBe('radio');
    expect(root(tree).props.accessibilityState).toEqual({ selected: true });
  });

  it('SectionHeader: aksiyon etiketi geçersiz kılınabilir', async () => {
    const fallback = await render(<SectionHeader title="Alışkanlıklar" actionLabel="Tümü →" onAction={() => {}} />);
    const fallbackBtn = nodes(fallback).filter((n) => n.props.accessibilityRole === 'button');
    expect(fallbackBtn).toHaveLength(1);
    expect(fallbackBtn[0].props.accessibilityLabel).toBe('Tümü →');

    const explicit = await render(
      <SectionHeader
        title="Alışkanlıklar"
        actionLabel="Tümü →"
        onAction={() => {}}
        actionAccessibilityLabel="Tüm alışkanlıkları gör"
        actionAccessibilityHint="Alışkanlık listesini açar"
      />,
    );
    const btn = nodes(explicit).filter((n) => n.props.accessibilityRole === 'button');
    expect(btn).toHaveLength(1);
    expect(btn[0].props.accessibilityLabel).toBe('Tüm alışkanlıkları gör');
    expect(btn[0].props.accessibilityHint).toBe('Alışkanlık listesini açar');
  });

  it('IconCircle: etiket verilince gizlenmez, image rolü alır', async () => {
    const tree = await render(<IconCircle icon="flame" accessibilityLabel="Seri ateşi" />);
    expect(isHidden(root(tree))).toBe(false);
    expect(root(tree).props.accessibilityRole).toBe('image');
    expect(root(tree).props.accessibilityLabel).toBe('Seri ateşi');
  });
});

// ---------------------------------------------------------------------------
// AC-U05 — süslemeler gizli
// ---------------------------------------------------------------------------

describe('AC-U05 — süsleme öğeleri erişilebilirlik ağacında yer tutmaz', () => {
  it('etiketsiz IconCircle gizlidir', async () => {
    const tree = await render(<IconCircle icon="flame" />);
    expect(isHidden(root(tree))).toBe(true);
  });

  it('etiketsiz ProgressBar gizlidir ve progressbar rolü UYDURMAZ', async () => {
    const tree = await render(<ProgressBar progress={0.4} />);
    expect(isHidden(root(tree))).toBe(true);
    expect(root(tree).props.accessibilityRole).toBeUndefined();
  });

  it('ProgressRing\'in SVG yayı her zaman gizlidir, ÇOCUKLARI değil', async () => {
    const tree = await render(
      <ProgressRing progress={0.4}>
        <Text>12:30</Text>
      </ProgressRing>,
    );
    const svg = nodes(tree).filter((n) => typeof n.type === 'string' && n.type.startsWith('RNSVG'));
    expect(svg.length).toBeGreaterThan(0);
    expect(isHidden(svg[0])).toBe(true);
    // Halkanın ortasındaki metin bu bileşenin tek anlamlı çıktısı — gizlenmemeli.
    expect(textOf(tree)).toContain('12:30');
  });

  it('ProgressRing web platformunda SVG\'ye DOM hatası üreten RN prop\'ları yerine aria-hidden geçirir', async () => {
    const prevOS = Platform.OS;
    Platform.OS = 'web';
    try {
      const tree = await render(<ProgressRing progress={0.4} />);
      const svg = nodes(tree).filter((n) => typeof n.type === 'string' && n.type.startsWith('RNSVG'));
      expect(svg.length).toBeGreaterThan(0);
      expect(svg[0].props['aria-hidden']).toBe(true);
      expect(svg[0].props.accessibilityElementsHidden).toBeUndefined();
      expect(svg[0].props.importantForAccessibility).toBeUndefined();
    } finally {
      Platform.OS = prevOS;
    }
  });

  it('Chip\'in nokta ve ikon süslemeleri gizlidir, etiketi değildir', async () => {
    const tree = await render(<Chip label="Yüksek" dot icon="flash" />);
    const hidden = nodes(tree).filter(isHidden);
    expect(hidden).toHaveLength(2); // nokta + ikon
    expect(textOf(tree)).toContain('Yüksek');
  });

  it('Badge ikonu gizli, metni okunur; çağıran etiket geçebilir', async () => {
    const tree = await render(<Badge label="5 dk" icon="time-outline" accessibilityLabel="5 dakika" />);
    expect(nodes(tree).filter(isHidden)).toHaveLength(1);
    expect(root(tree).props.accessibilityLabel).toBe('5 dakika');
    expect(textOf(tree)).toContain('5 dk');
  });

  it('SectionHeader başlık ikonu gizlidir', async () => {
    const tree = await render(<SectionHeader title="Bugün" icon="today-outline" />);
    expect(nodes(tree).filter(isHidden)).toHaveLength(1);
    expect(textOf(tree)).toContain('Bugün');
  });

  it('EmptyState ikonu gizli, CTA butonu rollü', async () => {
    const tree = await render(
      <EmptyState icon="leaf-outline" title="Henüz yok" hint="Ekle" ctaLabel="Alışkanlık ekle" onCta={() => {}} />,
    );
    expect(nodes(tree).filter(isHidden).length).toBeGreaterThanOrEqual(1);
    const buttons = nodes(tree).filter((n) => n.props.accessibilityRole === 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.accessibilityLabel).toBe('Alışkanlık ekle');
  });

  it('Skeleton gizli kalmaya devam eder (gerileme koruması)', async () => {
    // Skeleton bilerek gizli; bu test o davranışı DEĞİŞTİRMİYOR, kilitliyor.
    const tree = await render(<Skeleton width={100} height={12} />);
    expect(isHidden(root(tree))).toBe(true);
    act(() => tree.unmount());
  });
});

// ---------------------------------------------------------------------------
// AC-U06 — progressbar rolü ve değeri
// ---------------------------------------------------------------------------

describe('AC-U06 — etiketlenen ilerleme bileşenleri progressbar olur', () => {
  it('ProgressBar etiketlenince rol ve yüzde değeri kazanır', async () => {
    const tree = await render(<ProgressBar progress={0.42} accessibilityLabel="Aylık ilerleme" />);
    const p = root(tree).props;
    expect(p.accessibilityRole).toBe('progressbar');
    expect(p.accessibilityLabel).toBe('Aylık ilerleme');
    expect(p.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
    expect(isHidden(root(tree))).toBe(false);
  });

  it('ProgressBar değeri 0–100 arasına kırpılır', async () => {
    const over = await render(<ProgressBar progress={1.8} accessibilityLabel="x" />);
    expect(root(over).props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });

    const under = await render(<ProgressBar progress={-3} accessibilityLabel="x" />);
    expect(root(under).props.accessibilityValue).toEqual({ min: 0, max: 100, now: 0 });
  });

  it('ProgressBar: çağıranın değeri varsayılanı ezer', async () => {
    const tree = await render(
      <ProgressBar progress={0.42} accessibilityLabel="x" accessibilityValue={{ min: 0, max: 7, now: 3 }} />,
    );
    expect(root(tree).props.accessibilityValue).toEqual({ min: 0, max: 7, now: 3 });
  });

  it('ProgressRing etiketlenince rol ve değer kazanır, etiketsizken almaz', async () => {
    const labelled = await render(<ProgressRing progress={0.75} accessibilityLabel="Odak turu" />);
    expect(root(labelled).props.accessibilityRole).toBe('progressbar');
    expect(root(labelled).props.accessibilityValue).toEqual({ min: 0, max: 100, now: 75 });

    const bare = await render(<ProgressRing progress={0.75}><Text>75%</Text></ProgressRing>);
    expect(root(bare).props.accessibilityRole).toBeUndefined();
    expect(textOf(bare)).toContain('75%');
  });
});

// ---------------------------------------------------------------------------
// AC-U07 — WillpowerBand
// ---------------------------------------------------------------------------

describe('AC-U07 — WillpowerBand tek parça olarak duyurulur', () => {
  const wp = { used: 3, daily_budget: 5, focus_capacity: 4, active_count: 2 };

  it('gruplanır ve dört sayıyı da söyler', async () => {
    const tree = await render(<WillpowerBand wp={wp} />);
    const p = root(tree).props;
    expect(p.accessible).toBe(true);
    expect(p.accessibilityLabel).toContain('3');
    expect(p.accessibilityLabel).toContain('5');
    expect(p.accessibilityLabel).toContain('2');
    expect(p.accessibilityLabel).toContain('4');
    expect(p.accessibilityLabel).toContain('İrade');
  });

  it('dokunulamazken progressbar, dokunulabilirken button rolü alır', async () => {
    const staticBand = await render(<WillpowerBand wp={wp} />);
    expect(root(staticBand).props.accessibilityRole).toBe('progressbar');

    const pressable = await render(<WillpowerBand wp={wp} onPress={() => {}} />);
    expect(root(pressable).props.accessibilityRole).toBe('button');
  });

  it('sayısal değer bütçeye göre yayılır', async () => {
    const tree = await render(<WillpowerBand wp={wp} />);
    expect(root(tree).props.accessibilityValue).toEqual({ min: 0, max: 5, now: 3 });
  });

  it('çağıranın etiketi kazanır', async () => {
    const tree = await render(<WillpowerBand wp={wp} accessibilityLabel="İrade bandı" />);
    expect(root(tree).props.accessibilityLabel).toBe('İrade bandı');
  });
});

// ---------------------------------------------------------------------------
// AC-U08 — SyncStatusBadge
// ---------------------------------------------------------------------------

describe('AC-U08 — SyncStatusBadge etiketi atıl değil', () => {
  it('gruplanmış tek öğe olarak kurtarma cümlesini duyurur', async () => {
    const tree = await render(<SyncStatusBadge pending={3} dead={1} />);
    const p = root(tree).props;
    // `accessible` olmadan bu etiket okunmaz; içerideki iki pill metni ayrı
    // ayrı okunur ve "tekrar dokun" tavsiyesi hiç duyulmazdı.
    expect(p.accessible).toBe(true);
    expect(p.accessibilityLabel).toBe(syncBadgeA11yLabel(3, 1));
    expect(p.accessibilityLabel).toContain('tekrar dokun');
  });
});
