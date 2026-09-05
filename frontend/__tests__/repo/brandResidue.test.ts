/**
 * Eski ad, kullanıcının okuduğu hiçbir yerde kalmadı.
 *
 * ## Bu geçidin ayırdığı şey
 *
 * "Atlas" kelimesinin depoda geçmesi bir hata DEĞİL. Deep-link şeması hâlâ
 * `atlas://` ve öyle kalmak zorunda — o dizeler Notion ve Google konsollarına
 * ve edge allowlist'ine kayıtlı. AsyncStorage anahtarları hâlâ
 * `atlas_sync_queue_v1` ve öyle kalmak zorunda — cihazda henüz sunucuya
 * yazılmamış kullanıcı işlemleri o anahtarın altında duruyor, ad değişirse
 * veri taşınmaz, GİZLENİR. Bunların gerekçesi
 * `docs/RENAME_ATLAS_TO_ADERYTH_AUDIT.md` içinde tek tek yazılı.
 *
 * Hata olan şey, kullanıcının GÖRDÜĞÜ bir yerde durması.
 *
 * Bu yüzden tarama, kaynak metnin tamamına değil, YORUMLARI ATILMIŞ metindeki
 * dize sabitlerine bakar. Yorumda geçen "Atlas" tarihsel bir nottur ve bu
 * geçidi kırmaz; bir `<Text>` içindeki "Atlas" kırar. Ayrım kasıtlı: aksi
 * halde geçidi yeşile boyamanın en kolay yolu, tarihi silmek olurdu.
 *
 * ## Neden dize sabiti, neden render değil
 *
 * Render daha güçlü olurdu ama bu ekranların çoğu store, navigasyon ve
 * Supabase istemcisi kurmadan monte edilemiyor; kırk ekranı ayağa kaldıran
 * bir geçit, kaçırdığı ekran kadar da yavaşlık getirirdi. Auth yüzeyi —
 * yeniden yazılan tek yüzey — gerçekten render edilerek
 * `__tests__/ui/signupConfirmation.test.tsx` içinde doğrulanıyor; burası
 * kalan yüzeyleri ucuza ve tam kapsamayla tarıyor.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const OLD_NAME = 'Atlas';
const NEW_NAME = 'Aderyth';

/** Kullanıcının okuduğu metnin yaşadığı yerler. */
const UI_DIRS = ['app', 'components'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const UI_FILES = UI_DIRS.flatMap((d) => walk(join(ROOT, d)));

/**
 * Yorumsuz kaynaktaki tek/çift tırnaklı ve şablon dizelerin içeriği.
 *
 * Dizelerin İÇİNE bakılıyor, satırın tamamına değil: `const marker = '## Atlas'`
 * yakalanır ama `import … from '../atlas/…'` gibi bir yol da yakalanır, bu
 * yüzden aşağıdaki iddia dizenin kendisini raporlar ve istisnalar açıkça
 * listelenir — sessiz bir "içeriyorsa geç" kuralı yok.
 */
function userFacingStrings(src: string): string[] {
  const code = stripComments(src);
  const found: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) found.push(m[2]);
  return found;
}

/**
 * Dondurulmuş, makine tarafından eşleşen değerler.
 *
 * Bu liste bilerek dar ve bilerek açık. Yeni bir satır eklemek, gerekçesiyle
 * birlikte bir reviewer'ın gördüğü bir diff'tir — geçidi geniş bir regex ile
 * gevşetmek değildir.
 */
const FROZEN = [
  /^atlas$/,                    // app.json scheme/slug — OAuth konsolları + allowlist
  /^atlas:\/\//,                // Linking.createURL ile kurulan callback'ler
  /^atlas_sync_queue_v1/,       // cihazdaki senkron kuyruğu
  /^atlas_notion_login_session/, // cihazdaki Notion oturumu
  /^## \u{1F5D3}\u{FE0F} Atlas$/u, // Obsidian: eski blok başlığı, yalnızca ESKİ notları bulmak için
];

describe('tarama gerçekten dosya görüyor', () => {
  it('UI ağacı okunuyor', () => {
    // Boş bir liste, aşağıdaki iddiayı en kötü gerekçeyle geçirirdi.
    expect(UI_FILES.length).toBeGreaterThan(60);
  });

  it('yeni ad gerçekten yüzeylerde yazıyor', () => {
    // Pozitif kontrol: yalnızca "Atlas yok" demek, her şeyin silinmiş
    // olmasıyla da sağlanırdı.
    const withNewName = UI_FILES.filter((f) => readFileSync(f, 'utf8').includes(NEW_NAME));
    const rel = withNewName.map((f) => relative(ROOT, f).split(sep).join('/'));
    expect(rel).toEqual(expect.arrayContaining([
      'app/(auth)/login.tsx',
      'app/(auth)/register.tsx',
      'app/tabs/settings.tsx',
      'components/Drawer.tsx',
    ]));
  });
});

describe('eski ad kullanıcıya görünen hiçbir dizede yok', () => {
  it('app/ ve components/ altındaki dize sabitleri temiz', () => {
    const hits: string[] = [];
    for (const file of UI_FILES) {
      for (const s of userFacingStrings(readFileSync(file, 'utf8'))) {
        if (!s.includes(OLD_NAME) && !s.includes(OLD_NAME.toUpperCase())) continue;
        if (FROZEN.some((re) => re.test(s))) continue;
        hits.push(`${relative(ROOT, file).split(sep).join('/')}: ${JSON.stringify(s.slice(0, 80))}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('dışa aktarım dosyasının başlığı yeni ad ve dürüst kelime', () => {
    // Kullanıcı bu satırı bir CSV'yi açtığında okur. Ayrıştırılmıyor —
    // etiket, format işareti değil — bu yüzden yeniden adlandırılabildi.
    // "yedek" kelimesi bilerek kalktı: geri yükleme yolu yok, dolayısıyla
    // dosya bir yedek değil (bkz. services/exportService.ts).
    const svc = stripComments(readFileSync(join(ROOT, 'services', 'exportService.ts'), 'utf8'));
    expect(svc).toContain(`# ${NEW_NAME} dışa aktarım`);
    expect(svc).not.toContain(`# ${OLD_NAME} yedek`);
    expect(svc).not.toContain(`# ${NEW_NAME} yedek`);
  });
});

describe('kimlik alanları — ad değişti, makine değerleri değişmedi', () => {
  const expo = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;

  it('görünen ad yeni', () => {
    expect(expo.name).toBe(NEW_NAME);
  });

  it('deep-link şeması ve slug donduruldu', () => {
    // Şemayı değiştirmek, OAuth konsollarındaki redirect URI'lerini ve
    // OAUTH_REDIRECT_ALLOWLIST edge secret'ını aynı anda değiştirmeyi
    // gerektirir; onay verildikten SONRA kırılan bir akış üretir.
    expect(expo.scheme).toBe('atlas');
    expect(expo.slug).toBe('atlas');
  });
});

describe('cihazdaki veriyi tutan anahtarlar yeniden adlandırılmadı', () => {
  it.each([
    ['lib/syncQueue.ts', 'atlas_sync_queue_v1'],
    ['store/notionSessionStore.ts', 'atlas_notion_login_session'],
  ])('%s hâlâ %s altında yazıyor', (file, key) => {
    // Bu anahtarların altında SUNUCUYA YAZILMAMIŞ kullanıcı işlemleri var.
    // Adı değiştirmek veriyi taşımaz, erişilemez kılar.
    expect(stripComments(readFileSync(join(ROOT, file), 'utf8'))).toContain(key);
  });
});
