/**
 * The privacy policy, readable inside the app.
 *
 * ## Why a screen and not a link
 *
 * Store metadata needs a public HTTPS privacy URL, and Aderyth does not have
 * one yet (see `docs/store/PRIVACY_POLICY_DRAFT.md`). Shipping a link to a
 * domain that does not resolve would be worse than shipping nothing: a
 * reviewer taps it, gets an error, and the submission is rejected for a broken
 * privacy link rather than for a missing one.
 *
 * So the text lives here, where it is guaranteed to open, and the public URL
 * remains an owner action tracked in `docs/store/OWNER_DECISIONS.md`. When
 * that URL exists it should be added ALONGSIDE this screen, not instead of it
 * -- an in-app policy is independently useful and both stores accept it as the
 * in-product disclosure.
 *
 * ## The text is generated from the schema, not from a template
 *
 * Every data category below was read off the actual tables, the actual
 * network calls and the actual dependency list during Step 11B. Where the app
 * does NOT do something people reasonably assume it does -- no ads, no
 * tracking SDK, no push token, no audio recording kept -- it says so, because
 * a policy that only lists what is collected reads as evasive about the rest.
 *
 * DRAFT: the wording is the engineering description of real behaviour. It has
 * not been reviewed by a lawyer, and the owner must do that before it becomes
 * the published policy.
 */
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { alphaHex, colors } from '../../lib/tokens';
import {
  AtmosphericScreenCanvas,
  ChapterDivider,
  EditorialBanner,
  EmbeddedFiligree,
  EmblemMedallion,
} from '../../components/ui';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

/** One heading plus its paragraphs. Keeps the body below readable as prose. */
type Section = { title: string; body: string[] };

const UPDATED = '8 Eylül 2026';

const SECTIONS: Section[] = [
  {
    title: 'Kısaca',
    body: [
      'Aderyth, alışkanlıklarını ve odağını takip etmen için verilerini saklar. Bu verileri satmıyoruz, reklam için kullanmıyoruz ve üçüncü taraf reklam/izleme (tracking) SDK’sı içermiyoruz.',
      'Hesabını ve verilerini uygulama içinden kalıcı olarak silebilirsin: Ayarlar → Hesap → Hesabı Sil.',
    ],
  },
  {
    title: 'Hesap bilgileri',
    body: [
      'Kayıt olurken e-posta adresin ve parolan alınır. Parola, kimlik doğrulama sağlayıcımız Supabase tarafından şifrelenmiş (hash) olarak saklanır; Aderyth parolanı düz metin olarak görmez.',
      'Ayrıca hesabına bağlı bir kullanıcı kimliği (id) ve isteğe bağlı bir kullanıcı adı tutulur.',
    ],
  },
  {
    title: 'Uygulamada oluşturduğun içerik',
    body: [
      'Alışkanlıkların ve tamamlama kayıtların, görevlerin, projelerin, notların, hedeflerin ve OKR’ların, rutinlerin, telafi planların, odak ve derin çalışma seansların, irade/kapasite kayıtların, bıraktığın alışkanlıklar, okuma listen, yaşam alanı kayıtların, takvim etkinliklerin ve haftalık/aylık değerlendirmelerin hesabına bağlı olarak saklanır.',
      'Günlük (journal) kayıtların serbest metindir ve hesabına bağlı saklanır.',
      'Bu verilere yalnızca sen erişebilirsin. Veritabanı satır düzeyinde güvenlik (RLS) ile korunur: her sorgu oturumundaki kimliğe göre sınırlanır.',
    ],
  },
  {
    title: 'AI Koç',
    body: [
      'AI Koç’a yazdığın mesajlar ve koçun yanıtları hesabına bağlı olarak saklanır; böylece sohbetlerin uygulamayı kapatıp açtığında kaybolmaz.',
      'Bir mesaj gönderdiğinde sunucumuz, yalnızca o sohbetin son mesajlarından oluşan sınırlı bir bağlam (en fazla 16 mesaj ve 6000 karakter) ile birlikte mesajını yapay zekâ sağlayıcımız Anthropic’e iletir. Buna ek olarak uygulamanın kendi özeti gönderilir: aktif alışkanlık adların, alışkanlık ve bekleyen görev sayın, günlük irade kullanımın.',
      'Sağlayıcı anahtarı yalnızca sunucudadır; uygulamanın içinde bulunmaz. Bir sohbetin içeriği yalnızca o sohbet için gönderilir, başka bir sohbete taşınmaz.',
      'Anthropic’in bu içeriği kendi tarafında ne kadar süre işlediği/sakladığı, Aderyth’in kontrolünde değildir ve burada bir taahhüt olarak sunulmaz. Aderyth’in kendi tarafında sakladığı sohbetler, hesabını sildiğinde silinir.',
      'Ayrıca her AI isteği için teknik bir kayıt (istek kimliği, mod, durum, harcanan Focus Point) tutulur. Bu kayıt faturalandırma ve tekrar koruması içindir.',
    ],
  },
  {
    title: 'Sesle yazdırma',
    body: [
      'Mikrofon yalnızca sen mikrofon düğmesine bastığında açılır. Sürekli dinleme yoktur.',
      'Konuşmayı yazıya çevirme işini cihazının işletim sistemi yapar (iOS Speech, Android konuşma tanıma). Cihaz ve sistem ayarlarına bağlı olarak bu işlem cihaz üzerinde ya da işletim sistemi sağlayıcısının sunucusunda gerçekleşebilir; bu kısım Aderyth’in kontrolünde değildir.',
      'Aderyth ses kaydı tutmaz ve ses dosyası sunucuya göndermez. Yalnızca ortaya çıkan metin yazı kutusuna gelir; onu gönderip göndermemeye sen karar verirsin. Gönderirsen, sohbet mesajı olarak saklanır.',
    ],
  },
  {
    title: 'Çökme raporları',
    body: [
      'Uygulama beklenmedik şekilde çökerse, teknik bir hata raporu çökme izleme sağlayıcımız Sentry’ye gönderilir. Rapor yalnızca hatanın kendisini içerir: hata türü, hata mesajı ve çağrı yığını ile cihaz modeli, işletim sistemi sürümü ve uygulama sürümü.',
      'Çökme raporunda şunlar bulunmaz: günlük metinlerin, notların ve AI Koç sohbetlerin; alışkanlık, görev ve proje adların; e-posta adresin, kullanıcı adın veya herhangi bir kullanıcı kimliği; oturum jetonların; ağ isteklerinin gövdeleri ve adresleri. Ekran kaydı (session replay) kullanılmaz.',
      'Hata mesajları gönderilmeden önce ayrıca temizlenir: tırnak içindeki değerler, adres satırındaki parametre değerleri, e-posta adresleri ve jeton benzeri diziler kaldırılır ve mesaj uzunluğu sınırlandırılır. Çökme raporları hiçbir hesapla ilişkilendirilmez.',
    ],
  },
  {
    title: 'Abonelik ve Focus Point',
    body: [
      'Plan durumun ve Focus Point bakiyen hesabına bağlı saklanır. Focus Point harcamaların ve iadeleri bir işlem kaydı olarak tutulur.',
      'Aderyth bu sürümde ücretsizdir. Uygulama içi satın alma, abonelik ve reklam yoktur; ödeme bilgisi toplanmaz. Yapay zekâ özellikleri her ay yenilenen ücretsiz Focus Point bakiyesiyle çalışır.',
    ],
  },
  {
    title: 'Bildirimler',
    body: [
      'Hatırlatıcılar cihazında yerel olarak zamanlanır. Aderyth uzaktan bildirim (push) göndermez ve cihazının push jetonunu toplamaz.',
    ],
  },
  {
    title: 'Liderlik tablosu',
    body: [
      'Liderlik tablosuna katıldığında kullanıcı adın, seviyen, toplam XP’in ve sıralaman diğer kullanıcılara görünür. E-posta adresin, içeriklerin ve alışkanlık adların liderlik tablosunda paylaşılmaz.',
    ],
  },
  {
    title: 'Toplamadıklarımız',
    body: [
      'Reklam kimliği toplamıyoruz. Reklam ağı, analitik SDK’sı veya çapraz uygulama izleme (tracking) kullanmıyoruz.',
      'Konum verisi, kişiler, fotoğraflar veya cihaz depolamandaki dosyalar toplanmaz.',
      'Çökme raporlaması yalnızca teknik hata bilgisi gönderir; içeriklerini ya da kimliğini göndermez (bkz. "Çökme raporları").',
    ],
  },
  {
    title: 'Verilerin nerede saklanıyor',
    body: [
      'Veriler Supabase üzerinde barındırılan bir PostgreSQL veritabanında saklanır. Uygulama ile sunucu arasındaki tüm trafik HTTPS/TLS ile şifrelenir.',
      'Cihazında ayrıca oturum bilgin, çevrimdışı kayıt kuyruğun ve bazı tercihlerin yerel olarak saklanır.',
      'Mobilde oturum anahtarın cihazın güvenli deposunda (Keychain / Keystore) saklanır; web’de tarayıcının yerel depolamasında (localStorage) tutulur. Ortak bir bilgisayarda işin bitince Ayarlar > Hesap > Oturumu Kapat’ı kullan.',
      'Oturumu kapattığında bu cihazdaki önbellek temizlenir ve hatırlatıcıların iptal edilir; henüz sunucuya gitmemiş değişikliklerin cihazda güvende kalır ve aynı hesapla tekrar girdiğinde gönderilir.',
    ],
  },
  {
    title: 'Hizmet sağlayıcılar',
    body: [
      'Supabase — barındırma, veritabanı ve kimlik doğrulama.',
      'Anthropic — AI Koç ve AI rutin oluşturma isteklerinin işlenmesi.',
      'Sentry — çökme raporlama.',
    ],
  },
  {
    title: 'Verilerini dışa aktarma',
    body: [
      'Ayarlar → Veri ve Gizlilik bölümünden verilerini JSON, CSV veya Excel biçiminde dışa aktarabilirsin. Dosya tüm alışkanlık kayıtlarını (notlar dahil), hesap kimliğini ve kurulum yanıtlarını içerir ve şifrelenmez. Bu tam bir yedek değildir: JSON dosyasını aynı bölümde doğrulayıp eksik kayıtlarını hesabına ekleyebilirsin; alışkanlık kayıtların (tarihçe), odak oturumların ve webhook’ların geri yüklenemez. Uygulamayı açtığında günde en fazla bir kez, cihazında son 3 yerel yedek kopyası tutulur; hesabını sildiğinde bu kopyalar da silinir.',
      'Obsidian (Markdown) aktarımı seçtiğin içeriği (günlük ve notlar dahil olabilir) düz metin olarak cihazının panosuna kopyalar. Pano diğer uygulamalar ve klavye yöneticileri tarafından okunabilir; Aderyth panoyu 60 saniye sonra, başka bir şey kopyalamadıysan, otomatik temizlemeyi dener.',
    ],
  },
  {
    title: 'Hesabını silme',
    body: [
      'Ayarlar → Hesap → Hesabı Sil ile hesabını kalıcı olarak silebilirsin. Silme işlemi geri alınamaz.',
      'Silme onaylandığında hesabın ve yukarıda sayılan tüm kişisel verilerin veritabanından kaldırılır, cihazındaki yerel veriler temizlenir ve oturumun kapatılır.',
    ],
  },
  {
    title: 'Değişiklikler ve iletişim',
    body: [
      'Bu politika güncellendiğinde bu ekrandaki tarih değişir.',
      'Sorular ve veri talepleri için destek adresimizden bize ulaşabilirsin.',
    ],
  },
];

export default function PrivacyScreen() {
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Gizlilik Politikası' }} />
      <AtmosphericScreenCanvas
        source={CANVASES.treasuryVault}
        textureSource={TEXTURES.linen}
        scrim={0.64}
        tintColor={colors.info}
      />
      <ScrollView contentContainerStyle={s.content}>
        <EditorialBanner
          source={SCREEN_BANNERS.privacyVaultSeal}
          textureSource={TEXTURES.linen}
          eyebrow="VERİ EGEMENLİĞİ"
          title="Gizlilik Taahhüdü"
          subtitle="Reklam yok, izleme SDK’sı yok; verilerin yalnızca senin kontrolünde."
          accentColor={colors.info}
          minHeight={96}
          rightSlot={
            <EmblemMedallion
              source={SCREEN_BANNERS.privacyVaultSeal}
              size={46}
              unlocked
              accentColor={colors.info}
            />
          }
        />
        <Text style={s.updated}>Son güncelleme: {UPDATED}</Text>
        <ChapterDivider source={DECOR.dividerSundial} label="VERİ TAAHHÜTNAMESİ" accentColor={colors.info} />
        {SECTIONS.map((sec) => (
          <View key={sec.title} style={s.section}>
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="bottom-right" opacity={0.11} size={96} />
            <Text style={s.h2}>{sec.title}</Text>
            {sec.body.map((p) => (
              <Text key={p.slice(0, 40)} style={s.p}>{p}</Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 48, gap: 14 },
  updated: { fontSize: 12, color: colors.textFaint },
  section: {
    gap: 8,
    backgroundColor: alphaHex(colors.surface, '90'),
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  h2: { fontSize: 16, fontWeight: '700', color: colors.text },
  p: { fontSize: 14, color: colors.textDim, lineHeight: 21 },
});
