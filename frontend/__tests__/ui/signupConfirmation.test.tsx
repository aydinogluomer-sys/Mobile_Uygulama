/**
 * Kayıt sonrası "doğrulama bekleniyor" durumu.
 *
 * ## Neden bir test hak ediyor
 *
 * Önceden başarı şuydu:
 *
 *     setInfo('Hesabın oluşturuldu. E-postanı doğrula, sonra giriş yap.')
 *
 * ...ve bu metin, doğrulama hatalarının çıktığı 13 piksellik satırın aynısına
 * yazılıyordu. Formun kendisi altında duruyor, ikinci bir gönderime davet
 * ediyordu. Yani ürünün kullanıcıyı uygulamadan ÇIKARIP geri çağırdığı tek
 * anı, bir hata satırı gibi gösteriyordu.
 *
 * Buradaki iddialar bu yüzden "metin var mı" değil: forma AİT alanların
 * ağaçtan GİTTİĞİNİ ve yerine gelen durumun eyleme dönük olduğunu doğrular.
 * Bir sonraki kişi başarı durumunu tekrar forma gömerse AC-S02 kırmızıya
 * döner.
 *
 * ## Sızıntı iddiası (AC-S05) neden burada
 *
 * Supabase, ZATEN KAYITLI bir adrese yapılan signup'ı yeni kayıttan ayırt
 * edilemeyecek şekilde yanıtlar: oturum yok, `user.identities` boş dizi.
 * Ekran bu farkı okuyup "bu e-posta zaten kayıtlı" diyebilirdi — ve o anda
 * herkese, istediği adres için bir üyelik sorgusu vermiş olurdu. Bu yüzden
 * kod `identities`'e HİÇ bakmaz ve AC-S05 iki cevabın da aynı ekrana
 * düştüğünü kanıtlar. `identities: []` dalında ekranın metni değişirse test
 * kırmızıya döner.
 *
 * AC-S00  ağaç boş değil (negatif iddialar sahte yeşil olamaz)
 * AC-S01  başarılı signup formu kaldırır, bekleme durumunu getirir
 * AC-S02  gönderilen adres ekranda aynen görünür (yazım hatası yakalanabilsin)
 * AC-S03  bekleme durumunda "tekrar gönder" cooldown boyunca kilitli
 * AC-S04  hata, bekleme durumuna geçmeden formda kalır
 * AC-S05  yeni kayıt ile tekrar kayıt aynı ekrana düşer (enumeration yok)
 * AC-S06  signupErrorMessage: eyleme dönük çeviri, bilinmeyen mesaj korunur
 */
import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

// Bu iki fabrika `require` KULLANMIYOR, çünkü kullanmasına gerek yok ve
// kullansaydı lint'i gevşetmek gerekirdi. `jest.mock` fabrikaları import'ların
// üstüne kaldırıldığı için dosyanın kendi import'larına dokunamazlar; kaçış
// yolu genelde fabrika içinde `require` etmektir. Burada gerek kalmıyor:
// react-test-renderer bir dizeyi host bileşen olarak kabul eder, ve `Link`
// yalnızca `asChild` ile tek bir çocuk sardığı için çocuğu doğrudan döndürmek
// yeterli.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-linking', () => ({
  createURL: (p: string) => `atlas:///${p}`,
  useURL: () => null,
}));

const mockSignUp = jest.fn();
const mockResend = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { signUp: (...a: unknown[]) => mockSignUp(...a), resend: (...a: unknown[]) => mockResend(...a) } },
}));

import RegisterScreen, { signupErrorMessage } from '../../app/(auth)/register';
import SignupPending from '../../components/auth/SignupPending';
import { resetResendCooldowns } from '../../hooks/useResendCooldown';

type Json = TestRenderer.ReactTestRendererJSON;

// Aynı gerekçe uiPrimitivesAccessibility.test.tsx'te yazılı: bu dosya da
// @expo/vector-icons'un font promise'ini bekleyen asenkron `act` kullanıyor ve
// yoğun worker altında jest'in 5 sn varsayılanına sığmayabilir.
jest.setTimeout(30_000);

// Cooldown geri sayımı gerçek zamanla ilerlemesin: testler saniye beklemez ve
// hiçbir tik `act()` dışına taşmaz.
jest.useFakeTimers();

/**
 * Monte edilen her ağaç kaydedilir ve test bitiminde sökülür.
 *
 * Bekleme durumu saniyede bir tetiklenen bir `setInterval` kuruyor (cooldown
 * geri sayımı). Sökülmezse o interval testten SONRA ateşlenir, `act()`
 * dışında `setState` çağırır ve react-test-renderer bunu yakalanmamış hata
 * olarak bildirip süreci düşürür — testler yeşilken. Sahte zamanlayıcı
 * kullanmak tek başına yetmez: ağaç ayakta kaldığı sürece bir sonraki
 * dosyanın zamanlayıcı ilerletmesi de onu tetikleyebilir.
 */
const mounted: TestRenderer.ReactTestRenderer[] = [];

async function render(el: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(el); });
  mounted.push(tree);
  return tree;
}

afterEach(async () => {
  await act(async () => { mounted.splice(0).forEach((t) => t.unmount()); });
});

function textOf(tree: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: Json | string | null): void => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    (n.children ?? []).forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out.join(' ');
}

/** Etiketiyle bulunan, basılabilir düğüm. */
function pressable(tree: TestRenderer.ReactTestRenderer, label: string) {
  const hits = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
    { deep: true },
  );
  if (hits.length === 0) throw new Error(`"${label}" etiketli basılabilir düğüm yok`);
  return hits[0];
}

async function fillAndSubmit(tree: TestRenderer.ReactTestRenderer, email: string, password: string) {
  const inputs = tree.root.findAllByType(TextInput);
  expect(inputs.length).toBeGreaterThanOrEqual(2);
  await act(async () => { inputs[0].props.onChangeText(email); });
  await act(async () => { inputs[1].props.onChangeText(password); });
  await act(async () => { pressable(tree, 'Hesabımı oluştur').props.onPress(); });
}

/** Onay bekleyen bir signup — oturum YOK, kullanıcı VAR. */
const PENDING_NEW = { data: { user: { id: 'u-new', identities: [{ id: 'i1' }] }, session: null }, error: null };
/** Aynı adrese ikinci signup — sunucu bunu ayırt edilemez yanıtlar. */
const PENDING_REPEAT = { data: { user: { id: 'u-old', identities: [] }, session: null }, error: null };

beforeEach(() => {
  mockSignUp.mockReset();
  mockResend.mockReset();
  // The wait is shared per address at module level (hooks/useResendCooldown.ts); a wait
  // left over from the previous test must not lock this one's button.
  resetResendCooldowns();
});

describe('AC-S00 ağaç gerçekten içerik görüyor', () => {
  it('kayıt formu boş bir ağaç değil', async () => {
    mockSignUp.mockResolvedValue(PENDING_NEW);
    const tree = await render(<RegisterScreen />);
    expect(textOf(tree)).toContain('Hesabımı oluştur');
    expect(tree.root.findAllByType(TextInput).length).toBeGreaterThanOrEqual(2);
  });
});

describe('AC-S01 başarılı kayıt formu kaldırır', () => {
  it('form alanları ağaçtan gider, bekleme durumu gelir', async () => {
    mockSignUp.mockResolvedValue(PENDING_NEW);
    const tree = await render(<RegisterScreen />);

    await fillAndSubmit(tree, 'yeni@ornek.com', 'sifre123');

    // Formun kendisi gitti — başarı, hata satırının yanına eklenen bir cümle değil.
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    expect(textOf(tree)).not.toContain('Şifre (en az 6 karakter)');

    const shown = textOf(tree);
    expect(shown).toContain('Şimdi e-postanı doğrula');
    expect(shown).toContain('Gelen kutunu aç.');
    expect(shown).toContain('Spam');
  });

  it('signUp çağrısı, adres kırpılmış olarak, tam olarak bir kez yapılır', async () => {
    mockSignUp.mockResolvedValue(PENDING_NEW);
    const tree = await render(<RegisterScreen />);
    await fillAndSubmit(tree, '  yeni@ornek.com  ', 'sifre123');
    expect(mockSignUp).toHaveBeenCalledTimes(1);
    // F22 (NAV-07): the confirmation link is sent back to this app's sign-in screen.
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'yeni@ornek.com',
      password: 'sifre123',
      options: { emailRedirectTo: 'atlas:///login' },
    });
  });
});

describe('AC-S02 gönderilen adres geri gösterilir', () => {
  it('yazılan adres bekleme ekranında aynen yer alır', async () => {
    mockSignUp.mockResolvedValue(PENDING_NEW);
    const tree = await render(<RegisterScreen />);
    await fillAndSubmit(tree, 'yazim.hatasi@gmial.com', 'sifre123');
    // Boş inbox ile yanlış adres aynı görünür; tek ayırt edici bu satır.
    expect(textOf(tree)).toContain('yazim.hatasi@gmial.com');
  });
});

describe('AC-S03 tekrar gönderme cooldown ile kilitli', () => {
  it('cooldown sürerken buton devre dışı ve kalan süreyi söyler', async () => {
    const tree = await render(
      <SignupPending email="a@b.com" onResend={jest.fn()} onChangeEmail={jest.fn()} resendCooldown={42} />,
    );
    const btn = pressable(tree, 'Tekrar gönder (42)');
    expect(btn.props.accessibilityState.disabled).toBe(true);
    expect(textOf(tree)).toContain('42');
  });

  it('cooldown bittiğinde buton açılır ve onResend çağrılır', async () => {
    const onResend = jest.fn();
    const tree = await render(
      <SignupPending email="a@b.com" onResend={onResend} onChangeEmail={jest.fn()} resendCooldown={0} />,
    );
    const btn = pressable(tree, 'Doğrulama postasını tekrar gönder');
    expect(btn.props.accessibilityState.disabled).toBe(false);
    await act(async () => { btn.props.onPress(); });
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it('gönderim sürerken buton meşgul olarak duyurulur', async () => {
    const tree = await render(
      <SignupPending email="a@b.com" onResend={jest.fn()} onChangeEmail={jest.fn()} resendCooldown={0} resending />,
    );
    const btn = pressable(tree, 'Doğrulama postasını tekrar gönder');
    expect(btn.props.accessibilityState.busy).toBe(true);
    expect(btn.props.accessibilityState.disabled).toBe(true);
  });
});

describe('AC-S04 hata bekleme durumunu açmaz', () => {
  it('signUp hata dönerse form yerinde kalır ve mesaj çevrilir', async () => {
    mockSignUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Error sending confirmation email' } });
    const tree = await render(<RegisterScreen />);
    await fillAndSubmit(tree, 'yeni@ornek.com', 'sifre123');

    // Form duruyor: kullanıcının tekrar deneyebilmesi gereken tek durum bu.
    expect(tree.root.findAllByType(TextInput).length).toBeGreaterThanOrEqual(2);
    const shown = textOf(tree);
    expect(shown).not.toContain('Şimdi e-postanı doğrula');
    expect(shown).toContain('Doğrulama e-postası şu anda gönderilemiyor');
  });

  it('geçersiz adres sunucuya hiç gitmez', async () => {
    mockSignUp.mockResolvedValue(PENDING_NEW);
    const tree = await render(<RegisterScreen />);
    await fillAndSubmit(tree, 'nokta-yok@ornek', 'sifre123');
    expect(mockSignUp).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('Geçerli bir e-posta adresi girin.');
  });
});

describe('AC-S05 tekrar kayıt, yeni kayıttan ayırt edilemez', () => {
  it('identities boş gelen yanıt da aynı ekranı ve aynı metni üretir', async () => {
    mockSignUp.mockResolvedValue(PENDING_NEW);
    const fresh = await render(<RegisterScreen />);
    await fillAndSubmit(fresh, 'ayni@ornek.com', 'sifre123');

    mockSignUp.mockResolvedValue(PENDING_REPEAT);
    const repeat = await render(<RegisterScreen />);
    await fillAndSubmit(repeat, 'ayni@ornek.com', 'sifre123');

    // Tek karakterlik bir fark bile üyelik sorgusu olurdu.
    expect(textOf(repeat)).toBe(textOf(fresh));
  });
});

describe('AC-S06 hata çevirisi', () => {
  it.each([
    ['Error sending confirmation email', 'Doğrulama e-postası şu anda gönderilemiyor'],
    ['email rate limit exceeded', 'Çok fazla e-posta gönderildi'],
    ['For security purposes, you can only request this after 51 seconds', 'Çok sık denendi'],
    ['User already registered', 'Bu e-posta zaten kayıtlı'],
    ['Password should be at least 6 characters', 'Şifre en az 6 karakter'],
    ['Unable to validate email address: invalid format', 'geçerli görünmüyor'],
    ['Signups not allowed for this instance', 'Yeni kayıtlar şu anda kapalı'],
    ['TypeError: Failed to fetch', 'Sunucuya ulaşılamadı'],
  ])('%s → eyleme dönük Türkçe', (raw, expected) => {
    expect(signupErrorMessage(raw)).toContain(expected);
  });

  it('tanınmayan mesaj olduğu gibi korunur', () => {
    // Yutulursa geriye hiçbir ipucu kalmaz; bu yüzden passthrough.
    const odd = 'Some brand new GoTrue failure nobody mapped yet';
    expect(signupErrorMessage(odd)).toBe(odd);
  });
});

describe('F22 onay bağlantısı hedefi ve unconfirmed varyantı (NAV-05, NAV-07)', () => {
  it('(+) bekleme ekranındaki yeniden gönderme emailRedirectTo taşır ve bekleme başlar', async () => {
    mockSignUp.mockResolvedValue(PENDING_NEW);
    mockResend.mockResolvedValue({ error: null });
    const tree = await render(<RegisterScreen />);
    await fillAndSubmit(tree, 'yeni@ornek.com', 'sifre123');

    // Kayıt postası az önce gitti: bekleme hemen başlar.
    expect(pressable(tree, 'Tekrar gönder (60)').props.accessibilityState.disabled).toBe(true);

    await act(async () => { jest.advanceTimersByTime(60_000); });
    await act(async () => { pressable(tree, 'Doğrulama postasını tekrar gönder').props.onPress(); });
    expect(mockResend).toHaveBeenCalledTimes(1);
    expect(mockResend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'yeni@ornek.com',
      options: { emailRedirectTo: 'atlas:///login' },
    });
    expect(pressable(tree, 'Tekrar gönder (60)').props.accessibilityState.disabled).toBe(true);
  });

  it('(+) unconfirmed varyantı kendi başlığını gösterir, "zaten kayıtlıysa" cümlesini göstermez', async () => {
    const tree = await render(
      <SignupPending variant="unconfirmed" email="a@b.com" onResend={jest.fn()} onChangeEmail={jest.fn()} resendCooldown={0} />,
    );
    const shown = textOf(tree);
    expect(shown).toContain('E-POSTA DOĞRULANMADI');
    expect(shown).toContain('E-postanı doğrula');
    expect(shown).toContain('Spam');
    expect(shown).not.toContain('zaten kayıtlıysa');
    expect(shown).not.toContain('KAYIT ALINDI');
  });

  it('(-) varsayılan varyant metinleri değişmez ve Düzelt bağlantısı 44 pt yüksekliktedir', async () => {
    const tree = await render(
      <SignupPending email="a@b.com" onResend={jest.fn()} onChangeEmail={jest.fn()} resendCooldown={0} />,
    );
    const shown = textOf(tree);
    expect(shown).toContain('KAYIT ALINDI');
    expect(shown).toContain('Şimdi e-postanı doğrula');
    expect(shown).toContain('zaten kayıtlıysa yeni bir posta gelmez');
    expect(shown).not.toContain('E-POSTA DOĞRULANMADI');

    const change = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.findAll((c) => c.children?.includes?.('Düzelt')).length > 0,
    )[0];
    const style = Object.assign({}, ...[change.props.style].flat(3).filter(Boolean));
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });
});
