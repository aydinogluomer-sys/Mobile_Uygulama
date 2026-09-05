/**
 * Supabase auth e-posta şablonlarının sözleşmesi.
 *
 * ## Neden bu dosya var
 *
 * Bu iki HTML dosyası depoda duruyor ama ÇALIŞTIĞI yer Supabase'in auth
 * ayarları. Hiçbir build adımı onları derlemiyor, hiçbir import onlara
 * dokunmuyor — yani içlerinde bozulan bir şey, ancak gerçek bir kullanıcı
 * gerçek bir postayı alamayınca fark edilir. Bu, geri bildirim döngüsünün en
 * pahalı olduğu yer.
 *
 * En pahalı hata da tek bir eksik değişken:
 *
 *   · recovery şablonundan `{{ .Token }}` düşerse, `forgot-password.tsx`
 *     kullanıcıdan 6 haneli bir kod ister ve o kod postada HİÇ olmaz.
 *     Kurtarma akışı tamamen ölür, üstelik sessizce.
 *   · confirmation şablonundan `{{ .ConfirmationURL }}` düşerse hesap hiç
 *     etkinleşmez.
 *
 * ## Ters yönlü iddia
 *
 * Confirmation şablonunda `{{ .Token }}` OLMAMALI. Supabase onu doldurmaya
 * hazırdır, ama uygulamada signup için OTP giren bir ekran yok — postaya bir
 * kod koymak, kullanıcıya hiçbir yere giremeyeceği bir kod vermek olurdu.
 * Bunu "unutulmuş" değil, KARAR olarak sabitliyoruz.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const CONFIRM = 'supabase-confirm-signup-template.html';
const RECOVERY = 'supabase-password-recovery-template.html';

const templates: Record<string, string> = {
  [CONFIRM]: read(CONFIRM),
  [RECOVERY]: read(RECOVERY),
};

describe('şablonlar gerçekten okunuyor', () => {
  it.each([CONFIRM, RECOVERY])('%s var ve boş değil', (f) => {
    expect(existsSync(join(ROOT, f))).toBe(true);
    // Boş bir dosya, aşağıdaki her "içermemeli" iddiasını geçirirdi.
    expect(templates[f].length).toBeGreaterThan(2000);
  });
});

describe('Supabase değişkenleri — akışın bağlı olduğu tek şey', () => {
  it('recovery, uygulamanın okuduğu 6 haneli kodu taşır', () => {
    expect(templates[RECOVERY]).toContain('{{ .Token }}');
  });

  it('recovery kodu, bağlantı yedeğiyle birlikte gelir', () => {
    expect(templates[RECOVERY]).toContain('href="{{ .ConfirmationURL }}"');
  });

  it('kurtarma ekranı hâlâ o kodu bekliyor', () => {
    // Şablonun taşıdığı değişken ile istemcinin çağırdığı doğrulama tipini
    // aynı testte tutmak, ikisinden biri değişince diğerinin sessizce
    // yanlış kalmasını engeller.
    const screen = read(join('app', '(auth)', 'forgot-password.tsx'));
    expect(screen).toContain('verifyOtp');
    expect(screen).toMatch(/type:\s*'recovery'/);
  });

  it('confirmation, tıklanabilir bir doğrulama bağlantısı taşır', () => {
    expect(templates[CONFIRM]).toContain('href="{{ .ConfirmationURL }}"');
  });

  it('confirmation, uygulamanın kabul EDEMEYECEĞİ bir kod göstermez', () => {
    // Bkz. dosya başlığı: signup için OTP giren ekran yok.
    expect(templates[CONFIRM]).not.toContain('{{ .Token }}');
  });
});

describe('yorumlar postaya kaçak yük taşımıyor', () => {
  // Supabase şablonun TAMAMINI Go template olarak işler — HTML yorumlarının
  // içi dahil. Bu dosyaların ilk halinde `{{ .Token }}` bir açıklama satırında
  // geçiyordu; öyle kalsaydı Supabase onu gerçek kodla doldurur ve kod, hiçbir
  // yerde görünmeden postanın kaynağına gömülürdü. Geliştiriciye yazılmış bir
  // not, kullanıcıya gönderilen bir değere dönüşmemeli.
  const devComments = (html: string) =>
    (html.match(/<!--[\s\S]*?-->/g) ?? []).filter((c) => !c.includes('[if') && !c.includes('[endif'));

  it.each([CONFIRM, RECOVERY])('%s yorumlarında şablon değişkeni yok', (f) => {
    const offending = devComments(templates[f]).filter((c) => c.includes('{{'));
    expect(offending).toEqual([]);
  });

  it('kontrol: gövdede gerçekten şablon değişkeni var', () => {
    // Yukarıdaki iddia, dosyada hiç değişken kalmasa da geçerdi.
    expect(templates[CONFIRM]).toContain('{{ .ConfirmationURL }}');
    expect(templates[RECOVERY]).toContain('{{ .Token }}');
  });
});

describe('marka', () => {
  it.each([CONFIRM, RECOVERY])('%s Aderyth adını taşır', (f) => {
    expect(templates[f]).toContain('Aderyth');
  });

  it.each([CONFIRM, RECOVERY])('%s eski adı taşımaz', (f) => {
    expect(templates[f]).not.toMatch(/Atlas/i);
  });
});

describe('e-posta istemcilerinde ayakta kalır', () => {
  it.each([CONFIRM, RECOVERY])('%s mobilde daralır', (f) => {
    expect(templates[f]).toContain('name="viewport"');
    expect(templates[f]).toMatch(/@media[^{]*max-width\s*:\s*600px/);
  });

  it.each([CONFIRM, RECOVERY])('%s düzeni table ile kurulmuş', (f) => {
    // Gmail/Outlook'ta flex ve grid çöker; düzen table olmak zorunda.
    expect(templates[f]).toContain('role="presentation"');
    expect(templates[f]).not.toMatch(/display\s*:\s*(flex|grid)/);
  });

  it.each([CONFIRM, RECOVERY])('%s dış kaynak çekmez', (f) => {
    // Hiçbir istemci script çalıştırmaz; çoğu dış stylesheet'i de kırpar.
    expect(templates[f]).not.toMatch(/<script/i);
    expect(templates[f]).not.toMatch(/<link[^>]+stylesheet/i);
    expect(templates[f]).not.toMatch(/<img[^>]+src="http/i);
  });

  it.each([CONFIRM, RECOVERY])('%s gövde stillerini inline taşır', (f) => {
    // <style> yalnızca media query için var; ondan çıkarılan kural sayısı
    // gövdedeki inline style sayısının yanında ihmal edilebilir olmalı.
    const inline = (templates[f].match(/ style="/g) ?? []).length;
    expect(inline).toBeGreaterThan(20);
  });
});

describe('uygulayıcı script şablonlarla aynı şeyi söylüyor', () => {
  const script = read(join('scripts', 'configure-supabase-recovery-template.mjs'));

  it('her iki şablonu da hedefler', () => {
    expect(script).toContain(CONFIRM);
    expect(script).toContain(RECOVERY);
    expect(script).toContain('mailer_templates_confirmation_content');
    expect(script).toContain('mailer_templates_recovery_content');
  });

  it('zorunlu değişken listesi şablonların gerçeğiyle uyuşuyor', () => {
    // Script gönderim öncesi bu listeyi doğruluyor. Liste boşaltılırsa
    // doğrulama sessizce hiçbir şey kontrol etmemeye başlardı.
    expect(script).toContain("required: ['{{ .Token }}', '{{ .ConfirmationURL }}']");
    expect(script).toContain("required: ['{{ .ConfirmationURL }}']");
  });

  it('SMTP alanlarını göndermez', () => {
    // Bu görevin değişmez kuralı: SMTP'ye dokunulmaz. PATCH gövdesi yalnızca
    // mailer_* alanlarından kuruluyor; script ayrıca öncesi/sonrası
    // parmak izini karşılaştırıyor.
    expect(script).not.toMatch(/smtp_\w+\s*:/);
    expect(script).toContain('smtpFingerprint');
  });

  it('varsayılan olarak hiçbir şey uygulamaz', () => {
    expect(script).toContain("--apply");
    expect(script).toContain('DRY RUN');
  });
});
