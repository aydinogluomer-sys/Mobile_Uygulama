import { EXPLORE_ATOMIC_HABITS, type ExploreAtomicHabit } from './exploreCatalog';
import { colors } from './tokens';

const FLOW_HUE = {
  all: '#8b5cf6',
  procrastination: '#ec4899',
  focus: '#14b8a6',
  morning_sleep: '#f59e0b',
  dopamine: '#6366f1',
  saved: '#10b981',
} as const;

export type FocusFlowCategoryKey =
  | 'for_you'
  | 'all'
  | 'procrastination'
  | 'focus'
  | 'morning_sleep'
  | 'dopamine'
  | 'saved';

export type FocusContentCategory =
  | 'procrastination'
  | 'focus'
  | 'morning_sleep'
  | 'dopamine';

export const FOCUS_FLOW_CATEGORIES: {
  key: FocusFlowCategoryKey;
  label: string;
  icon: string;
  color: string;
}[] = [
  { key: 'for_you', label: 'Sizin İçin', icon: 'flame', color: colors.primary },
  { key: 'all', label: 'Tümü', icon: 'sparkles', color: FLOW_HUE.all },
  { key: 'procrastination', label: 'Erteleme & DEHB', icon: 'flash', color: FLOW_HUE.procrastination },
  { key: 'focus', label: 'Derin Odak', icon: 'hourglass', color: FLOW_HUE.focus },
  { key: 'morning_sleep', label: 'Sabah & Uyku', icon: 'sunny', color: FLOW_HUE.morning_sleep },
  { key: 'dopamine', label: 'Dopamin Detoksu', icon: 'shield-checkmark', color: FLOW_HUE.dopamine },
  { key: 'saved', label: 'Kaydedilenler', icon: 'bookmark', color: FLOW_HUE.saved },
];

export type KineticSlide = {
  eyebrow: string;
  text: string;
  highlight: string;
  durationMs: number;
};

export type InteractivePromptOption = {
  id: string;
  emoji: string;
  label: string;
  coachingReply: string;
};

export type FocusFeedCta = {
  label: string;
  actionType:
    | 'add_atomic_habit'
    | 'start_small_focus'
    | 'open_urge_shield'
    | 'open_explore_pack'
    | 'open_routine_runner';
  atomicHabitId?: string;
  focusMinutes?: number;
  focusTitle?: string;
};

export type FocusFeedItem = {
  id: string;
  kind: 'video' | 'inflow_interactive';
  category: FocusContentCategory;
  badge: string;
  accentColor: string;
  icon: string;
  hookTitle: string;
  subtitle: string;
  creatorOrSource: string;
  languageBadge: 'TR' | 'EN · TR Özetli';
  durationSec: number;
  videoSource?: {
    provider: 'youtube_shorts';
    videoId: string;
    startSec?: number;
  };
  kineticSlides: KineticSlide[];
  interactivePrompt?: {
    question: string;
    options: InteractivePromptOption[];
  };
  keyTakeaways: string[];
  cta: FocusFeedCta;
};

export type FocusFeedEntry =
  | { entryKind: 'item'; key: string; item: FocusFeedItem; contentIndex: number }
  | { entryKind: 'checkpoint'; key: string; watchedCount: number };

export const FOCUS_FLOW_ITEMS: FocusFeedItem[] = [
  // 1 — INFLOW INTERACTIVE: Task Paralysis & Procrastination
  {
    id: 'inflow-task-paralysis',
    kind: 'inflow_interactive',
    category: 'procrastination',
    badge: 'INFLOW CBT MİKRO-DERS',
    accentColor: FLOW_HUE.procrastination,
    icon: 'git-branch-outline',
    hookTitle: 'Görev Felci (Task Paralysis): Beynin Neden Donuyor?',
    subtitle: 'Tembel değilsin; beynin belirsizliği fiziksel tehdit olarak kodluyor.',
    creatorOrSource: 'Aderyth · Inflow BDT Protokolü',
    languageBadge: 'TR',
    durationSec: 45,
    kineticSlides: [
      {
        eyebrow: '1 / 4 · NÖROBİLİM TESPİTİ',
        text: 'Yapılacaklar listene bakıp hiçbir şeye başlayamadığın o an tembellik değildir.',
        highlight: 'Amigdala "büyük ve belirsiz" görevi tehdit sanıp fren basar.',
        durationMs: 4800,
      },
      {
        eyebrow: '2 / 4 · TUZAK',
        text: 'Beyin bu gerilimden kaçmak için anında ucuz dopamin arar: Instagram veya TikTok açılır.',
        highlight: 'Kaçtığın şey işin kendisi değil, işin yarattığı belirsizlik duygusudur.',
        durationMs: 5000,
      },
      {
        eyebrow: '3 / 4 · INFLOW ÇÖZÜMÜ',
        text: 'Hedefi küçültme, sadece "giriş eşiğini" gülünç derecede küçült.',
        highlight: '"Raporu bitir" değil → "Sadece dosyayı aç ve 1 bozuk cümle yaz."',
        durationMs: 5000,
      },
      {
        eyebrow: '4 / 4 · ŞİMDİ UYGULA',
        text: 'Hareket motivasyondan önce gelir. İlk 120 saniye başladığında beyin tehdidi kapatır.',
        highlight: 'Aşağıdan teşhisini seç veya hemen 5 dakikalık mikro odak başlat.',
        durationMs: 5200,
      },
    ],
    interactivePrompt: {
      question: 'Şu an ertelediğin iş sana en çok ne hissettiriyor?',
      options: [
        {
          id: 'too-big',
          emoji: '🏔',
          label: 'Çok büyük ve nereden başlayacağımı bilmiyorum',
          coachingReply:
            'Çözüm: Sonucu unut. Sadece ilk fiziksel hareketi seç (dosyayı açmak, başlığı yazmak) ve 5 dakika sonra durma izni ver.',
        },
        {
          id: 'perfectionism',
          emoji: '😰',
          label: 'Kötü yapmaktan / hata yapmaktan çekiniyorum',
          coachingReply:
            'Çözüm: Beynine "Bilerek berbat bir ilk taslak çıkaracağım" de. Mükemmeliyetçilik baskısı kalktığında çalışma belleğin açılır.',
        },
        {
          id: 'low-battery',
          emoji: '🔋',
          label: 'Zihinsel enerjim sıfır, kolumu kaldıracak halim yok',
          coachingReply:
            'Çözüm: İrade harcama. Sadece 2 dakikalık en kolay adımı yap; olmazsa Bugün ekranında "Düşük Enerji Modu"nu aç.',
        },
      ],
    },
    keyTakeaways: [
      'Erteleme bir zaman yönetimi değil, duygu düzenleme sorunudur.',
      'Belirsiz görevler amigdalayı tetikler; somut 2 dakikalık ilk adım prefrontal korteksi devreye sokar.',
      'Motivasyon gelmesini bekleme: eylem → ivme → motivasyon sırasıyla çalışır.',
    ],
    cta: {
      label: '⚡ 5 Dk Küçük Başla (Odak Sayacı)',
      actionType: 'start_small_focus',
      focusMinutes: 5,
      focusTitle: 'Sadece ilk küçük adımı başlat (5 dk)',
    },
  },

  // 2 — VERIFIED VIDEO (TR): Barış Özcan — Parçala, Böl, Yönet
  {
    id: 'video-baris-parcala',
    kind: 'video',
    category: 'procrastination',
    badge: 'TÜRKÇE KISA VİDEO',
    accentColor: colors.primary,
    icon: 'cut',
    hookTitle: 'Parçala, Böl, Yönet: Büyük Hedeflerin Altında Ezilme',
    subtitle: 'Dev bir hedefi beynin yutabileceği mikro dilimlere ayırma sanatı.',
    creatorOrSource: 'Barış Özcan · Kısa Klip',
    languageBadge: 'TR',
    durationSec: 55,
    videoSource: {
      provider: 'youtube_shorts',
      videoId: 'ftrTQx9xTgs',
    },
    kineticSlides: [
      {
        eyebrow: 'VİDEO ÖZETİ · 1 / 3',
        text: 'Zihin devasa bir projeye tek parça halinde baktığında kilitlenir.',
        highlight: 'Parçala, Böl ve Yönet: Her büyük iş sadece küçük adımların toplamıdır.',
        durationMs: 4500,
      },
      {
        eyebrow: 'VİDEO ÖZETİ · 2 / 3',
        text: 'Günün başında 20 maddelik karmaşık bir liste yerine sadece 3 net çıktı belirle.',
        highlight: 'Karar yorgunluğunu sabah ilk 5 dakikada bitir.',
        durationMs: 4500,
      },
      {
        eyebrow: 'VİDEO ÖZETİ · 3 / 3',
        text: 'Her tamamlanan mikro parça beynin ödül devresini besler ve sıradaki adımı kolaylaştırır.',
        highlight: 'Şimdi bu prensibi kalıcı bir sabah alışkanlığına dönüştür.',
        durationMs: 4500,
      },
    ],
    keyTakeaways: [
      'Büyük projeleri "bugün 15 dakikada bitebilecek" alt parçalara ayır.',
      'Her sabah en fazla 3 ana öncelik yazmak gün içi dağılmayı %60 azaltır.',
      'Tamamlanan her küçük parça, bir sonraki adım için doğal dopamin yakıtı üretir.',
    ],
    cta: {
      label: '+ "Günün 3 önceliğini yaz" Alışkanlığını Ekle',
      actionType: 'add_atomic_habit',
      atomicHabitId: 'atomic-top3-priorities',
    },
  },

  // 3 — INFLOW INTERACTIVE: Dopamine Menu vs. Instagram Scroll Trap
  {
    id: 'inflow-dopamine-menu',
    kind: 'inflow_interactive',
    category: 'dopamine',
    badge: 'DOPAMİN MİMARİSİ',
    accentColor: FLOW_HUE.dopamine,
    icon: 'shield-checkmark',
    hookTitle: 'Instagram Tuzağı Yerine "Dopamin Menüsü" Kur',
    subtitle: '5 dakikalık mola diye girdiğin sosyal medya neden 45 dakikanı çalıyor?',
    creatorOrSource: 'Aderyth · Nöro-Odak Akışı',
    languageBadge: 'TR',
    durationSec: 50,
    kineticSlides: [
      {
        eyebrow: '1 / 4 · ALGORİTMA KANCASI',
        text: 'Çalışma arasında "5 dakika kafa dağıtayım" diye Instagram açtığında beynin dinlenmez.',
        highlight: 'Sonsuz kaydırma, çalışma belleğini yüzlerce alakasız uyaranla doldurur.',
        durationMs: 4800,
      },
      {
        eyebrow: '2 / 4 · UCUZ vs. TEMİZ DOPAMİN',
        text: 'Kısa komedi/gündem videoları ani dopamin piki yapar; kapattığın an bazal dopaminin düşer.',
        highlight: 'Sonuç: Masadaki işin sana eskisinden 3 kat daha sıkıcı görünür!',
        durationMs: 5000,
      },
      {
        eyebrow: '3 / 4 · DOPAMİN MENÜSÜ TEKNİĞİ',
        text: 'Acıktığında abur cubura saldırmamak için menünü önceden seçmelisin.',
        highlight: 'Başlangıç: 1 bardak su · Ara sıcak: 5 dk nefes / esneme · Tatlı: Akşam sevdiğin dizi.',
        durationMs: 5200,
      },
      {
        eyebrow: '4 / 4 · DÜRTÜ SÖRFÜ',
        text: 'Sosyal medya açma dürtüsü bir dalga gibidir; 60 saniye beklersen zirve yapar ve söner.',
        highlight: 'Dürtü geldiğinde kaçma, 60 saniyelik Dürtü Kalkanını aç.',
        durationMs: 4800,
      },
    ],
    interactivePrompt: {
      question: 'Çalışırken sıkıldığında elin otomatik olarak ilk nereye gidiyor?',
      options: [
        {
          id: 'reels',
          emoji: '📱',
          label: 'Instagram / TikTok / X akışına',
          coachingReply:
            'Kural: Çalışma bloğu bitene kadar telefonu görüş alanından çıkar (başka odaya veya çantaya). Görsel tetikleyici kalkınca dürtü %70 azalır.',
        },
        {
          id: 'snack',
          emoji: '☕',
          label: 'Sürekli kahve veya atıştırmalık almaya',
          coachingReply:
            'Kural: Beynin yorgunluğu değil sıkılmayı yemekle yatıştırıyor. Masana büyük bir bardak su koy ve 3 derin fizyolojik iç çekiş yap.',
        },
        {
          id: 'tab-hop',
          emoji: '💻',
          label: 'Tarayıcıda yeni sekmeler / haber siteleri açmaya',
          coachingReply:
            'Kural: Tek ekran, tek sekme. Aklına gelen arama fikrini kenardaki bir kağıda "sonra bak" diye karala ve işe dön.',
        },
      ],
    },
    keyTakeaways: [
      'Mola sırasında sosyal medya kaydırmak beyni dinlendirmez, bilişsel yükü artırır.',
      'Ani dopamin sıçramaları sonrasında gerçek işlere odaklanmak nörokimyasal olarak zorlaşır.',
      '60 saniyelik "Dürtü Sörfü" otomatik telefon açma refleksini kırmak için yeterlidir.',
    ],
    cta: {
      label: '🛡 Dürtü Kalkanı & Alışkanlık Takibini Aç',
      actionType: 'open_urge_shield',
    },
  },

  // 4 — VERIFIED VIDEO: Andrew Huberman — Morning Light & Cortisol
  {
    id: 'video-huberman-sunlight',
    kind: 'video',
    category: 'morning_sleep',
    badge: 'STANFORD NÖROBİLİM · KLİP',
    accentColor: FLOW_HUE.morning_sleep,
    icon: 'sunny',
    hookTitle: 'Sabah İlk 30 Dakika: Doğal Gün Işığının Odak ve Kortizol Etkisi',
    subtitle: 'Sabah uyanınca telefona değil gökyüzüne bakmak tüm günkü uyanıklığı kilitler.',
    creatorOrSource: 'Dr. Andrew Huberman · Huberman Lab',
    languageBadge: 'EN · TR Özetli',
    durationSec: 60,
    videoSource: {
      provider: 'youtube_shorts',
      videoId: 'bmFw2kQ9pRs',
    },
    kineticSlides: [
      {
        eyebrow: 'TÜRKÇE ÖZET · 1 / 3',
        text: 'Uyandıktan sonraki ilk 30-60 dakika içinde açık havada doğal gün ışığı almak gözdeki özel nöronları uyarır.',
        highlight: 'Sağlıklı sabah kortizol zirvesi tetiklenir: beyin sisi dağılır.',
        durationMs: 4600,
      },
      {
        eyebrow: 'TÜRKÇE ÖZET · 2 / 3',
        text: 'Pencere camı arkasından veya telefon ekranından gelen ışık bu biyolojik sinyali 50 kat zayıflatır.',
        highlight: 'Bulutlu bir günde bile dışarıda 10-15 dakika yürümek yeterlidir.',
        durationMs: 4600,
      },
      {
        eyebrow: 'TÜRKÇE ÖZET · 3 / 3',
        text: 'Sabah aldığın bu ışık sinyali, 14-16 saat sonra gece melatonin salgılanacak saati de kurar.',
        highlight: 'Hem gündüz odaklanman hem gece derin uykun tek alışkanlıkla düzelir.',
        durationMs: 4600,
      },
    ],
    keyTakeaways: [
      'Sabah doğal gün ışığı kortizol uyanış tepkisini (CAR) doğru saate çeker, odaklanmayı artırır.',
      'Cam arkası yerine balkon veya açık havada 10-15 dakika ışık maruziyeti gerekir.',
      'Sabah ışık çapası, gece uykuya dalma süresini doğrudan kısaltır.',
    ],
    cta: {
      label: '+ "Gün ışığında kısa yürüyüş" Alışkanlığını Ekle',
      actionType: 'add_atomic_habit',
      atomicHabitId: 'atomic-sunlight-walk',
    },
  },

  // 5 — VERIFIED VIDEO (TR): Beyhan Budak — Erteleme ile Başa Çıkma
  {
    id: 'video-beyhan-erteleme',
    kind: 'video',
    category: 'procrastination',
    badge: 'PSİKOLOJİ · TÜRKÇE',
    accentColor: FLOW_HUE.procrastination,
    icon: 'bulb',
    hookTitle: '"Üşeniyorum Öyleyse Yarın": Erteleme Döngüsünden Çıkış',
    subtitle: 'Mükemmel anı beklemeyi bırakıp kusurlu ama gerçek adımlarla ilerlemek.',
    creatorOrSource: 'Uzm. Psk. Beyhan Budak',
    languageBadge: 'TR',
    durationSec: 60,
    videoSource: {
      provider: 'youtube_shorts',
      videoId: '__MSthuk65k',
    },
    kineticSlides: [
      {
        eyebrow: 'PSİKOLOJİ ÖZETİ · 1 / 3',
        text: '"Yarın daha enerjik olurum, yarın tam odaklanırım" düşüncesi beynin en sevdiği illüzyondur.',
        highlight: 'Gelecekteki sen mucizevi bir süper kahraman olmayacak; bugünkü senle aynı hissedecek.',
        durationMs: 4600,
      },
      {
        eyebrow: 'PSİKOLOJİ ÖZETİ · 2 / 3',
        text: 'İstek gelmesini beklersen yıllar geçer. Psikolojide davranışsal aktivasyon kuralı geçerlidir.',
        highlight: 'Önce küçük davranış başlar, istek ve özgüven davranışın arkasından gelir.',
        durationMs: 4600,
      },
      {
        eyebrow: 'PSİKOLOJİ ÖZETİ · 3 / 3',
        text: 'Kendini suçlamak iradeyi tüketir; öz-şefkat gösterip "şimdi sadece 5 dakika" demek kilidi açar.',
        highlight: 'Yarını bekleme, bugün 5 dakikalık kusurlu bir başlangıç yap.',
        durationMs: 4600,
      },
    ],
    keyTakeaways: [
      'Gelecekteki benliğine borç yazmayı bırak: "Yarın yaparım" sadece anlık kaygıyı uyuşturur.',
      'Kendini acımasızca eleştirmek ertelemeyi azaltmaz, tam tersine suçluluk kaynaklı kaçışı büyütür.',
      'Davranışsal aktivasyon: İstek yokken yapılan 5 dakikalık eylem zihinsel ataleti kırar.',
    ],
    cta: {
      label: '⚡ Şimdi 5 Dk Kusurlu Başlangıç Yap',
      actionType: 'start_small_focus',
      focusMinutes: 5,
      focusTitle: 'Ertelemeyi kır: 5 dakikalık kusurlu başlangıç',
    },
  },

  // 6 — INFLOW INTERACTIVE: 120-Second Friction Removal
  {
    id: 'inflow-2min-friction',
    kind: 'inflow_interactive',
    category: 'focus',
    badge: 'ODAK MÜHENDİSLİĞİ',
    accentColor: FLOW_HUE.focus,
    icon: 'flash',
    hookTitle: 'İradeye Güvenme: Başlama Sürtünmesini 120 Saniyede Sıfırla',
    subtitle: 'Yüksek verimli insanlar daha iradeli değil, çevrelerini daha akıllı tasarlıyor.',
    creatorOrSource: 'Aderyth · Inflow Odak Protokolü',
    languageBadge: 'TR',
    durationSec: 45,
    kineticSlides: [
      {
        eyebrow: '1 / 4 · SÜRTÜNME YASASI',
        text: 'İnsan beyni her zaman "en az enerji gerektiren" davranışı seçmeye programlıdır.',
        highlight: 'Telefon elindeyse ona bakarsın; çalışma masan dağınıksa çalışmaktan kaçarsın.',
        durationMs: 4600,
      },
      {
        eyebrow: '2 / 4 · +20 SANİYE KURALI',
        text: 'Kötü alışkanlıkla arana 20 saniyelik fiziksel engel koy (telefonu başka odaya bırak).',
        highlight: 'İyi alışkanlıktan 20 saniyelik engeli kaldır (kitabı yastığının üstüne koy).',
        durationMs: 4800,
      },
      {
        eyebrow: '3 / 4 · GÖRSEL SESSİZLİK',
        text: 'Masandaki her kağıt, açık kalan her sekme beyninin arka planında RAM tüketir.',
        highlight: '25 dakikalık tek bir bildirimsiz sprint, 3 saatlik bölünmüş çalışmaya bedeldir.',
        durationMs: 4800,
      },
      {
        eyebrow: '4 / 4 · TEK HAMLE',
        text: 'Şimdi ortamındaki tek bir sürtünmeyi seç ve bildirimsiz odak alışkanlığını sistemine ekle.',
        highlight: 'İradeni koru, sistemini çalıştır.',
        durationMs: 4600,
      },
    ],
    interactivePrompt: {
      question: 'Şu an odaklanmanı kolaylaştırmak için hangi 10 saniyelik hamleyi yapabilirsin?',
      options: [
        {
          id: 'phone-away',
          emoji: '🔕',
          label: 'Telefonu ters çevirip kol mesafesinin dışına koymak',
          coachingReply:
            'Harika seçim! Araştırmalar telefon sadece görüş alanı dışına çıktığında bile bilişsel kapasitenin %12 arttığını gösteriyor.',
        },
        {
          id: 'close-tabs',
          emoji: '🧹',
          label: 'İşle ilgisiz tüm açık sekmeleri kapatmak',
          coachingReply:
            'Süper! Görsel karmaşa kalktığında beynin bağlam değiştirme (context-switching) maliyeti sıfırlanır.',
        },
        {
          id: 'water-glass',
          emoji: '💧',
          label: 'Masaya bir bardak su koyup kulaklığı takmak',
          coachingReply:
            'Mükemmel bir fiziksel çapa! Kulaklığı takmak beynine "şimdi odak modundayız" şartlı refleksini öğretir.',
        },
      ],
    },
    keyTakeaways: [
      'İrade sınırlı bir pildir; çevre tasarımı ise 7/24 bedava çalışır.',
      'Dikkat dağıtıcılarla arana 20 saniye mesafe koy, odak araçlarını 1 tık uzağına getir.',
      'Günde tek bir 25 dakikalık bildirimsiz odak seansı yüksek çıktı için temel çapadır.',
    ],
    cta: {
      label: '+ "Bildirimsiz odak seansı" Alışkanlığını Ekle',
      actionType: 'add_atomic_habit',
      atomicHabitId: 'atomic-no-notif-sprint',
    },
  },

  // 7 — VERIFIED VIDEO: Ali Abdaal — The 5-Minute Rule
  {
    id: 'video-ali-5min-rule',
    kind: 'video',
    category: 'procrastination',
    badge: 'VERİMLİLİK · KISA KLİP',
    accentColor: FLOW_HUE.saved,
    icon: 'timer',
    hookTitle: 'Ertelemeyi Bitiren "Sadece 5 Dakika" Anlaşması',
    subtitle: 'Kendinle pazarlık yap: 5 dakika çalış, devam etmek istemezsen bırakma hakkın var!',
    creatorOrSource: 'Ali Abdaal · Productivity Lab',
    languageBadge: 'EN · TR Özetli',
    durationSec: 50,
    videoSource: {
      provider: 'youtube_shorts',
      videoId: '1YN-9Uj6ey0',
    },
    kineticSlides: [
      {
        eyebrow: 'TÜRKÇE ÖZET · 1 / 3',
        text: 'Bir işe başlamak, o işi sürdürmekten 10 kat daha fazla aktivasyon enerjisi ister.',
        highlight: 'Beynine "2 saat çalışacağım" dersen direnç gösterir; "Sadece 5 dakika" dersen kabul eder.',
        durationMs: 4600,
      },
      {
        eyebrow: 'TÜRKÇE ÖZET · 2 / 3',
        text: 'Kurallar net: 5 dakika dolduğunda gerçekten bırakmak istiyorsan suçluluk duymadan bırakabilirsin.',
        highlight: 'Ama vakaların %80’inde fizikteki eylemsizlik yasası devreye girer ve devam edersin!',
        durationMs: 4800,
      },
      {
        eyebrow: 'TÜRKÇE ÖZET · 3 / 3',
        text: 'Bıraksan bile 0 dakika yerine 5 dakika ilerlemiş olursun — sıfır gün olmaktan kurtulursun.',
        highlight: 'Aşağıdaki butonla hemen 5 dakikalık sayacını başlat.',
        durationMs: 4500,
      },
    ],
    keyTakeaways: [
      'En yüksek sürtünme her zaman ilk 2 dakikadadır (aktivasyon enerjisi).',
      '5 dakika sonunda bırakma özgürlüğü vermek, beynin "kapana kısılma" direncini çözer.',
      '%80 olasılıkla 5. dakikadan sonra akışa girip çalışmaya devam edersin.',
    ],
    cta: {
      label: '⚡ 5 Dakika Kuralını Şimdi Başlat',
      actionType: 'start_small_focus',
      focusMinutes: 5,
      focusTitle: '5 Dakika Kuralı: Sadece başla',
    },
  },

  // 8 — INFLOW INTERACTIVE: Attention Residue (Cal Newport Principle)
  {
    id: 'inflow-attention-residue',
    kind: 'inflow_interactive',
    category: 'dopamine',
    badge: 'DERİN ÇALIŞMA BİLİMİ',
    accentColor: colors.info,
    icon: 'eye-off',
    hookTitle: 'Dikkat Kalıntısı: "Sadece 30 Saniye Mesaja Baktım" Yalanı',
    subtitle: '30 saniyelik bir bildirim kontrolü gerçekte 23 dakikalık derin odağa mal olur.',
    creatorOrSource: 'Aderyth · Bilişsel Performans',
    languageBadge: 'TR',
    durationSec: 45,
    kineticSlides: [
      {
        eyebrow: '1 / 4 · GİZLİ MALİYET',
        text: 'Çalışırken gelen bir mesaja 15 saniye bakıp ekranı kapattığında odağının hemen döndüğünü sanırsın.',
        highlight: 'Oysa beyninin bir kısmı hâlâ o mesajın bağlamında asılı kalır (Attention Residue).',
        durationMs: 4800,
      },
      {
        eyebrow: '2 / 4 · 23 DAKİKA GERÇEĞİ',
        text: 'Bilişsel araştırmalar, bölünen bir zihnin aynı derinlik seviyesine tam dönüşünün 20+ dakika sürdüğünü gösteriyor.',
        highlight: 'Saatte 3 kez telefona bakmak = Tüm günü yüzeysel zihinle geçirmek.',
        durationMs: 5000,
      },
      {
        eyebrow: '3 / 4 · TEK GÖREV GÜCÜ',
        text: 'Multitasking bir yetenek değil, görevler arasında çok hızlı ve yorucu bir zıplamadır.',
        highlight: '50 dakikalık tek bir derin çalışma bloğu günün en değerli çıktısını üretir.',
        durationMs: 4800,
      },
      {
        eyebrow: '4 / 4 · KORUMA KALKANI',
        text: 'Günün en verimli saatini mesajlara değil, en önemli üretim bloğuna kilitle.',
        highlight: 'Derin çalışma alışkanlığını tek dokunuşla günlük sistemine ekle.',
        durationMs: 4600,
      },
    ],
    interactivePrompt: {
      question: 'Gün içinde odağını en sık hangisi bölüyor?',
      options: [
        {
          id: 'whatsapp',
          emoji: '💬',
          label: 'Anlık mesajlaşma ve bildirim sesleri',
          coachingReply:
            'Öneri: 50 dakikalık blok boyunca telefonu "Odak / Rahatsız Etme" moduna al. Hiçbir mesaj 50 dakika içinde dünyayı yıkmaz.',
        },
        {
          id: 'own-thoughts',
          emoji: '🧠',
          label: 'Kendi aklıma aniden gelen "şunu da unutmadan yapayım" fikirleri',
          coachingReply:
            'Öneri: Yanında bir "Dikkat Çöp Kutusu" not defteri tut. Fikri 3 kelimeyle yaz, beynin unutma kaygısı bitsin ve işe dön!',
        },
        {
          id: 'fatigue',
          emoji: '🥱',
          label: '20. dakikadan sonra başlayan zihinsel kopma',
          coachingReply:
            'Öneri: 50 dakika fazla geliyorsa 25 dk odak + 5 dk yürüyüş (ekransız mola) ritmiyle başla; odak kası kademeli büyür.',
        },
      ],
    },
    keyTakeaways: [
      'Dikkat kalıntısı (Attention Residue), kısa telefon kontrollerinin asıl gizli faturasıdır.',
      'Bölünmüş 4 saatlik çalışma, kesintisiz 50 dakikalık tek bir bloktan daha az değer üretir.',
      'Aklına gelen yan işleri yapma; bir kenara not al ve odak bloğu bitince topluca hallet.',
    ],
    cta: {
      label: '+ "Kesintisiz derin çalışma bloğu" Ekle',
      actionType: 'add_atomic_habit',
      atomicHabitId: 'atomic-deep-work-50',
    },
  },

  // 9 — VERIFIED VIDEO: James Clear — The 2-Minute Rule for Habits
  {
    id: 'video-james-clear-2min',
    kind: 'video',
    category: 'focus',
    badge: 'ATOMİK ALIŞKANLIKLAR',
    accentColor: FLOW_HUE.all,
    icon: 'sparkles',
    hookTitle: 'Atomik Alışkanlıklar: Yeni Rutin Kurarken "2 Dakika Kuralı"',
    subtitle: 'Bir alışkanlığı mükemmelleştirmeden önce onu standartlaştırmalısın.',
    creatorOrSource: 'James Clear · Atomic Habits',
    languageBadge: 'EN · TR Özetli',
    durationSec: 55,
    videoSource: {
      provider: 'youtube_shorts',
      videoId: 'kqQLQZ7vTcI',
    },
    kineticSlides: [
      {
        eyebrow: 'ATOMİK ÖZET · 1 / 3',
        text: 'Yeni bir alışkanlık başlatırken yapılan en büyük hata hedefi ilk günden çok büyük seçmektir.',
        highlight: '"Her gece 1 saat kitap okuyacağım" → "Her gece 1 sayfa okuyacağım."',
        durationMs: 4600,
      },
      {
        eyebrow: 'ATOMİK ÖZET · 2 / 3',
        text: 'Ol olmayan bir alışkanlığı optimize edemezsin. Önce her gün tekrarlanan 2 dakikalık bir kimlik kur.',
        highlight: 'Spor salonuna gitmek, antrenman yapmaktan daha önemli olan temel alışkanlıktır.',
        durationMs: 4800,
      },
      {
        eyebrow: 'ATOMİK ÖZET · 3 / 3',
        text: 'Zinciri kırmamak için en yoğun gününde bile 2 dakikada yapabileceğin bir versiyonun olsun.',
        highlight: 'Günde 10 dakikalık mikro okuma alışkanlığını hemen ekle.',
        durationMs: 4500,
      },
    ],
    keyTakeaways: [
      'Her yeni alışkanlık ilk başta 2 dakikadan kısa sürecek bir "giriş kapısına" indirgenmelidir.',
      'Önce sürekliliği (standardı) kur, süreyi ve yoğunluğu haftalar sonra artır.',
      'Günde sadece 10 dakika kitap okumak yılda ~15 kitap bitirmeni sağlar.',
    ],
    cta: {
      label: '+ "10 dakika okuma" Alışkanlığını Ekle',
      actionType: 'add_atomic_habit',
      atomicHabitId: 'atomic-reading-10min',
    },
  },

  // 10 — INFLOW INTERACTIVE: Evening Zeigarnik Effect & Sleep Hygiene
  {
    id: 'inflow-evening-zeigarnik',
    kind: 'inflow_interactive',
    category: 'morning_sleep',
    badge: 'UYKU & AKŞAM KAPANIŞI',
    accentColor: FLOW_HUE.dopamine,
    icon: 'moon',
    hookTitle: 'Yastığa Başını Koyduğunda Zihnin Neden Susmuyor?',
    subtitle: 'Açık kalan görev döngülerini (Zeigarnik Etkisi) uyumadan önce kapatma tekniği.',
    creatorOrSource: 'Aderyth · Gece Regülasyonu',
    languageBadge: 'TR',
    durationSec: 45,
    kineticSlides: [
      {
        eyebrow: '1 / 4 · ZEIGARNIK ETKİSİ',
        text: 'Beynin tamamlanmamış işleri tıpkı bilgisayarda açık kalmış arka plan uygulamaları gibi bellekte tutar.',
        highlight: 'Gece yatağa girdiğinde "yarın şunu unutmayayım" diye dönüp durmasının sebebi budur.',
        durationMs: 4800,
      },
      {
        eyebrow: '2 / 4 · MAVİ IŞIK + DOPAMİN',
        text: 'Zihni susturmak için yatakta telefon kaydırmak melatonini baskılar ve beyni "gündüz" modunda tutar.',
        highlight: 'Bedenin yorgun düşse bile derin uyku (REM/SWS) kaliten yarıya iner.',
        durationMs: 4800,
      },
      {
        eyebrow: '3 / 4 · ZİHİN BOŞALTMA (SHUTDOWN)',
        text: 'Uyumadan 1 saat önce yarınki 3 adımı sisteme yazıp "Bugünlük mesai kapandı" demek beyni serbest bırakır.',
        highlight: 'Kağıda/sisteme aktarılan görev artık çalışma belleğini meşgul etmez.',
        durationMs: 5000,
      },
      {
        eyebrow: '4 / 4 · GECE KALKANI',
        text: 'Yatmadan 1 saat önce ekranları kapatıp loş ışığa geçerek yarınki enerjini bugünden garantiye al.',
        highlight: 'Gece ekran detoksu alışkanlığını tek dokunuşla ekle.',
        durationMs: 4500,
      },
    ],
    interactivePrompt: {
      question: 'Gece uykuya geçişini en çok hangisi zorlaştırıyor?',
      options: [
        {
          id: 'bed-scroll',
          emoji: '📱',
          label: 'Yatakta son bir kez sosyal medyaya / videolara bakmak',
          coachingReply:
            'Çözüm: Şarj aletini yatak odasının dışına veya yatağın erişemeyeceği bir köşeye taşı. Yatakta telefon yok kuralı uykuyu 7 günde dönüştürür.',
        },
        {
          id: 'overthinking',
          emoji: '🌀',
          label: 'Yarınki işleri ve yetişmeyenleri düşünmek',
          coachingReply:
            'Çözüm: Bugün ekranındaki "Günü Kapat" ritüelini kullan. Açık görevleri yarına devrettiğini görmek amigdalayı sakinleştirir.',
        },
        {
          id: 'late-caffeine',
          emoji: '☕',
          label: 'Akşam saatlerinde bile fiziksel olarak tetikte hissetmek',
          coachingReply:
            'Çözüm: Kafeinin yarılanma ömrü 6 saattir. Saat 14:00’ten sonra kahveyi bitki çayıyla değiştirmek derin uykuyu %20 artırır.',
        },
      ],
    },
    keyTakeaways: [
      'Tamamlanmamış ve yazıya dökülmemiş her iş gece boyunca beynin arka planında enerji harcar.',
      'Akşam 5 dakikalık "Gün Sonu Kapanışı" yapmak uykuya dalma süresini belirgin biçimde kısaltır.',
      'Yatmadan 60 dakika önce ekranı bırakmak, ertesi sabahki irade bütçenin en büyük yatırımıdır.',
    ],
    cta: {
      label: '+ "Yatmadan 1 saat önce ekran yok" Ekle',
      actionType: 'add_atomic_habit',
      atomicHabitId: 'atomic-no-screen-bedtime',
    },
  },

  // 11 — VERIFIED VIDEO: Cal Newport — Deep Work & Quick Phone Checks
  {
    id: 'video-cal-newport-phone',
    kind: 'video',
    category: 'dopamine',
    badge: 'DEEP WORK · NÖRO-ODAK',
    accentColor: FLOW_HUE.focus,
    icon: 'phone-portrait',
    hookTitle: '"Hızlıca Telefona Göz Atmak" Beynini Nasıl Sabote Ediyor?',
    subtitle: 'Cal Newport: Sıkılma kasını kaybettiğimizde derin düşünme yeteneğimizi de kaybederiz.',
    creatorOrSource: 'Prof. Cal Newport · Deep Work',
    languageBadge: 'EN · TR Özetli',
    durationSec: 55,
    videoSource: {
      provider: 'youtube_shorts',
      videoId: '0tLJerF7DO0',
    },
    kineticSlides: [
      {
        eyebrow: 'DEEP WORK ÖZETİ · 1 / 3',
        text: 'Asansörde, sırada beklerken bile 10 saniye sıkılmaya tahammül edemeyip telefona sarılıyoruz.',
        highlight: 'Beyin "en ufak zorlukta anında yeni uyaran gelecek" diye şartlanıyor.',
        durationMs: 4600,
      },
      {
        eyebrow: 'DEEP WORK ÖZETİ · 2 / 3',
        text: 'Sonra masaya oturup zor bir probleme odaklanmak istediğinde beyin aynı anlık kaçışı talep ediyor.',
        highlight: 'Odaklanma sadece çalışma anında değil, gün boyu sıkılmaya izin vererek inşa edilir.',
        durationMs: 4800,
      },
      {
        eyebrow: 'DEEP WORK ÖZETİ · 3 / 3',
        text: 'Şimdi dikkat dağıtıcıları kapat ve beynine tek bir görevde kalma antrenmanı yaptır.',
        highlight: 'Hazır rutin koleksiyonlarıyla kendi Derin Çalışma sistemini kur.',
        durationMs: 4500,
      },
    ],
    keyTakeaways: [
      'Sürekli telefon kontrolü beyni "yüksek uyaran bağımlısı" haline getirir.',
      'Gün içindeki küçük bekleme anlarında telefona bakmamak odaklanma kasını güçlendirir.',
      'Derin çalışma nadirleştiği için modern dünyadaki en büyük rekabet avantajıdır.',
    ],
    cta: {
      label: '📦 Derin Çalışma Rutin Paketlerini İncele',
      actionType: 'open_explore_pack',
    },
  },

  // 12 — VERIFIED VIDEO (TR): Barış Özcan — Odağını Kaybetmeden Çalışmak
  {
    id: 'video-baris-odak',
    kind: 'video',
    category: 'focus',
    badge: 'TÜRKÇE REHBER · ODAK',
    accentColor: colors.info,
    icon: 'play-circle',
    hookTitle: 'Odağını Kaybetmeden Saatlerce Nasıl Çalışabilirsin?',
    subtitle: 'Zaman blokları, ritim ve mola disipliniyle tükenmeden üretken kalmak.',
    creatorOrSource: 'Barış Özcan',
    languageBadge: 'TR',
    durationSec: 60,
    videoSource: {
      provider: 'youtube_shorts',
      videoId: 'qji-iQHeaRA',
    },
    kineticSlides: [
      {
        eyebrow: 'VİDEO ÖZETİ · 1 / 3',
        text: 'Saatlerce aralıksız çalışmaya çalışmak odaklanmayı değil tükenmişliği getirir.',
        highlight: 'Sır: Net tanımlanmış odak blokları ve gerçek (ekransız) kısa molalardır.',
        durationMs: 4600,
      },
      {
        eyebrow: 'VİDEO ÖZETİ · 2 / 3',
        text: 'Çalışmaya başlamadan önce ortamını hazırla ve adımlarını sıraya diz (ritüelleştir).',
        highlight: 'Rutin Yürütücü ile her adımı düşünmeden otomatik pilotta koştur.',
        durationMs: 4600,
      },
      {
        eyebrow: 'VİDEO ÖZETİ · 3 / 3',
        text: 'Zamanlayıcı çalıştığında tek kural var: Sadece önündeki tek adımla ilgilen.',
        highlight: 'Şimdi Rutin Yürütücüyü açarak adımlarını sesli rehberle başlat.',
        durationMs: 4600,
      },
    ],
    keyTakeaways: [
      'Uzun süreli odaklanma bir maraton değil, planlı sprint ve dinlenme döngüsüdür.',
      'Başlangıç ritüeli kurmak beyni saniyeler içinde çalışma moduna sokar.',
      'Adım adım zamanlı rutin yürütmek karar yorgunluğunu tamamen ortadan kaldırır.',
    ],
    cta: {
      label: '▶ Sesli Rutin Yürütücüyü Başlat',
      actionType: 'open_routine_runner',
    },
  },
];

export type UserFocusContext = {
  hour: number;
  overdueCount: number;
  lowEnergy: boolean;
  activeHabitCount: number;
  focusSessionsToday: number;
  startItemId?: string | null;
};

export function findAtomicHabitById(id?: string): ExploreAtomicHabit | undefined {
  if (!id) return undefined;
  return EXPLORE_ATOMIC_HABITS.find((h) => h.id === id);
}

/**
 * Picks the single highest-relevance 45–60s "Daily Spark" reel for the top of
 * TodayScreen so the app hooks the user immediately with zero noise.
 */
export function pickDailySparkItem(ctx: UserFocusContext): {
  item: FocusFeedItem;
  reasonTag: string;
} {
  if (ctx.overdueCount >= 2) {
    const found = FOCUS_FLOW_ITEMS.find((i) => i.id === 'inflow-task-paralysis');
    if (found) {
      return {
        item: found,
        reasonTag: `${ctx.overdueCount} gecikmiş adım var · Görev felcini 45 sn'de çöz`,
      };
    }
  }
  if (ctx.lowEnergy) {
    const found = FOCUS_FLOW_ITEMS.find((i) => i.id === 'video-ali-5min-rule');
    if (found) {
      return {
        item: found,
        reasonTag: 'Düşük enerji modu · Sadece 5 dakika anlaşması',
      };
    }
  }
  if (ctx.hour >= 5 && ctx.hour < 11) {
    const found = FOCUS_FLOW_ITEMS.find((i) => i.id === 'video-huberman-sunlight');
    if (found) {
      return {
        item: found,
        reasonTag: 'Sabah Kıvılcımı · İlk 30 dakikada odak & kortizol kilidi',
      };
    }
  }
  if (ctx.hour >= 21 || ctx.hour < 5) {
    const found = FOCUS_FLOW_ITEMS.find((i) => i.id === 'inflow-evening-zeigarnik');
    if (found) {
      return {
        item: found,
        reasonTag: 'Gece Sakinliği · Zihnindeki açık döngüleri kapat',
      };
    }
  }
  if (ctx.focusSessionsToday === 0) {
    const found = FOCUS_FLOW_ITEMS.find((i) => i.id === 'inflow-2min-friction');
    if (found) {
      return {
        item: found,
        reasonTag: 'Günün İlk Odağı · Başlama sürtünmesini 120 sn’de sıfırla',
      };
    }
  }
  const fallback = FOCUS_FLOW_ITEMS.find((i) => i.id === 'inflow-dopamine-menu') ?? FOCUS_FLOW_ITEMS[0];
  return {
    item: fallback,
    reasonTag: 'Odak Koruma · Sosyal medya tuzağı yerine dopamin menüsü',
  };
}

/**
 * Ranks the catalog dynamically for the "🔥 Sizin İçin" feed based on time of day,
 * overdue load, energy level, and optional deep-linked `startItemId`.
 */
export function rankFocusFlowForUser(ctx: UserFocusContext): FocusFeedItem[] {
  const scored = FOCUS_FLOW_ITEMS.map((item, idx) => {
    let score = 0;

    if (ctx.startItemId && item.id === ctx.startItemId) {
      score += 1000;
    }

    if (ctx.overdueCount > 0 && item.category === 'procrastination') {
      score += 40;
    }
    if (ctx.lowEnergy && (item.id === 'video-ali-5min-rule' || item.id === 'inflow-task-paralysis')) {
      score += 35;
    }
    if (ctx.hour >= 5 && ctx.hour < 11 && item.category === 'morning_sleep' && item.id.includes('sunlight')) {
      score += 45;
    }
    if ((ctx.hour >= 21 || ctx.hour < 5) && item.id === 'inflow-evening-zeigarnik') {
      score += 50;
    }
    if (ctx.hour >= 11 && ctx.hour < 18 && (item.category === 'focus' || item.category === 'dopamine')) {
      score += 25;
    }
    if (ctx.activeHabitCount === 0 && item.cta.actionType === 'add_atomic_habit') {
      score += 20;
    }
    // Slight preference to interleave interactive CBT + real video
    score += (FOCUS_FLOW_ITEMS.length - idx) * 0.5;

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

/**
 * Inserts an Anti-Doomscroll Action Checkpoint every `checkpointInterval` reels
 * (Inflow's 5-minute rule: prevent productivity content from turning into passive scrolling).
 */
export function buildFeedEntries(
  items: FocusFeedItem[],
  checkpointInterval = 5,
): FocusFeedEntry[] {
  const out: FocusFeedEntry[] = [];
  items.forEach((item, index) => {
    out.push({
      entryKind: 'item',
      key: `reel-${item.id}`,
      item,
      contentIndex: index,
    });
    if ((index + 1) % checkpointInterval === 0 && index < items.length - 1) {
      out.push({
        entryKind: 'checkpoint',
        key: `checkpoint-after-${index + 1}`,
        watchedCount: index + 1,
      });
    }
  });
  return out;
}
