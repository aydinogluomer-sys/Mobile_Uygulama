export type IntegrationStatus = 'available' | 'connected' | 'comingSoon';

export type IntegrationItem = {
  id: string;
  title: string;
  description: string;
  status: IntegrationStatus;
  iconName?: string;
};

export type IntegrationCategoryId =
  | 'knowledge'
  | 'health'
  | 'ai'
  | 'automation'
  | 'social'
  | 'environment';

export type IntegrationCategory = {
  id: IntegrationCategoryId;
  title: string;
  subtitle: string;
  description: string;
  iconName: string;
  accentColor: string;
  items: IntegrationItem[];
};

// Category card badge count = items.length (all integrations in category, any status).
export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  {
    id: 'knowledge',
    title: 'Bilgi & Üretkenlik',
    subtitle: 'Notion ve takvim sistemleriyle senkronlayın.',
    description:
      'Habitlerinizi not alma, bilgi yönetimi, günlük değerlendirme ve takvim sistemlerinize bağlayın.',
    iconName: 'book-outline',
    accentColor: '#6366F1',
    items: [
      {
        id: 'notion',
        title: 'Notion',
        description: "Alışkanlık ve görevleri Notion veritabanına aktarın. Integration Token ile bağlayın.",
        // Not 'available' in this release: the production notion-auth function
        // is the pre-hardening build and its OAuth credentials were never
        // configured, so the flow cannot complete. See lib/featureGates.ts.
        status: 'comingSoon',
        iconName: 'document-text-outline',
      },
      {
        id: 'calendar',
        title: 'Takvim',
        description:
          'Google Calendar hesabınızı bağlayarak takviminize habit blokları ekleyin.',
        // Not 'available' in this release: google-auth is not deployed at all
        // (404 in production). See lib/featureGates.ts.
        status: 'comingSoon',
        iconName: 'calendar-outline',
      },
      {
        id: 'tasks',
        title: 'Görev Uygulamaları',
        description:
          'Habitleri Todoist, TickTick veya Things üzerinde tekrar eden görevlere dönüştürün.',
        status: 'comingSoon',
        iconName: 'checkbox-outline',
      },
    ],
  },
  {
    id: 'health',
    title: 'Sağlık & Wearable',
    subtitle: 'Adım, uyku ve egzersiz verileriyle habitleri otomatik takip edin.',
    description:
      'Sağlık verilerinizle habitleri pasif şekilde takip edin ve uygun habitleri otomatik tamamlayın.',
    iconName: 'fitness-outline',
    accentColor: '#10B981',
    items: [
      {
        id: 'apple-health',
        title: 'Apple Health',
        description: 'Adım, uyku, egzersiz ve mindfulness verilerini okuyun.',
        status: 'comingSoon',
        iconName: 'heart-outline',
      },
      {
        id: 'health-connect',
        title: 'Health Connect',
        description: 'Android sağlık verileriyle habit takibini otomatikleştirin.',
        status: 'comingSoon',
        iconName: 'phone-portrait-outline',
      },
      {
        id: 'fitbit',
        title: 'Fitbit',
        description:
          'Aktivite, uyku ve egzersiz verilerini habit sisteminize bağlayın.',
        status: 'comingSoon',
        iconName: 'watch-outline',
      },
      {
        id: 'garmin',
        title: 'Garmin',
        description: 'Workout, recovery ve performans verilerini takip edin.',
        status: 'comingSoon',
        iconName: 'bicycle-outline',
      },
      {
        id: 'oura',
        title: 'Oura',
        description:
          'Uyku, readiness ve recovery verileriyle habit içgörüleri oluşturun.',
        status: 'comingSoon',
        iconName: 'moon-outline',
      },
    ],
  },
  {
    id: 'ai',
    title: 'AI Coach',
    subtitle: 'Alışkanlıklarınızı analiz eden kişisel koçunuzu yönetin.',
    description:
      'Davranış örüntülerinizi analiz eden, düşüşleri fark eden ve size uygun öneriler üreten AI katmanı.',
    iconName: 'sparkles-outline',
    accentColor: '#8B5CF6',
    items: [
      {
        id: 'ai-coach',
        title: 'AI Habit Coach',
        description:
          'Habit düşüşlerini, güçlü saatleri ve davranış trendlerini analiz edin.',
        status: 'comingSoon',
        iconName: 'analytics-outline',
      },
      {
        id: 'ai-reflection',
        title: 'AI Reflection',
        description:
          'Günlük notlarınızdan duygu, enerji ve habit bağlantıları çıkarın.',
        status: 'comingSoon',
        iconName: 'journal-outline',
      },
      {
        id: 'adaptive-schedule',
        title: 'Adaptive Scheduling',
        description: 'Hatırlatma saatlerini davranış ritminize göre optimize edin.',
        status: 'comingSoon',
        iconName: 'time-outline',
      },
      {
        id: 'ai-plans',
        title: 'AI Plans',
        description:
          '30 günlük odak, spor, uyku veya dopamine detox planları üretin.',
        status: 'comingSoon',
        iconName: 'map-outline',
      },
    ],
  },
  {
    id: 'automation',
    title: 'Otomasyonlar',
    subtitle: 'Webhook, n8n, Zapier ve Make bağlantılarını kurun.',
    description:
      "Habit olaylarını dış sistemlere gönderin ve kendi otomasyon workflow'larınızı oluşturun.",
    iconName: 'git-network-outline',
    accentColor: '#F59E0B',
    items: [
      {
        id: 'webhook',
        title: 'Webhook Yönetimi',
        description: 'Habit olaylarını n8n veya kendi sistemlerinize gönderin.',
        status: 'available',
        iconName: 'link-outline',
      },
      {
        id: 'n8n',
        title: 'n8n',
        description:
          'Habit tamamlandı, streak bozuldu veya hedefe ulaşıldı gibi olaylarla workflow çalıştırın.',
        status: 'comingSoon',
        iconName: 'git-network-outline',
      },
      {
        id: 'zapier',
        title: 'Zapier',
        description:
          "Habit event'lerini yüzlerce uygulamayla kod yazmadan bağlayın.",
        status: 'comingSoon',
        iconName: 'flash-outline',
      },
      {
        id: 'make',
        title: 'Make',
        description:
          'Görsel otomasyon senaryoları ile habit verilerini farklı servislere aktarın.',
        status: 'comingSoon',
        iconName: 'layers-outline',
      },
    ],
  },
  {
    id: 'social',
    title: 'Sosyal Sorumluluk',
    subtitle: 'Telegram, Discord ve accountability bildirimlerini ayarlayın.',
    description:
      "Habitlerinizi arkadaşlar, topluluklar ve accountability partner'larla daha sürdürülebilir hale getirin.",
    iconName: 'people-outline',
    accentColor: '#EC4899',
    items: [
      {
        id: 'telegram',
        title: 'Telegram',
        description:
          'Habit tamamlandı veya kaçırıldı bildirimlerini Telegram üzerinden gönderin.',
        status: 'comingSoon',
        iconName: 'paper-plane-outline',
      },
      {
        id: 'discord',
        title: 'Discord',
        description: 'Challenge, XP, role veya topluluk bildirimleri oluşturun.',
        status: 'comingSoon',
        iconName: 'chatbubbles-outline',
      },
      {
        id: 'accountability',
        title: 'Accountability Partner',
        description:
          'Belirlediğiniz kişiye ilerleme veya kaçırma bildirimleri gönderin.',
        status: 'comingSoon',
        iconName: 'person-add-outline',
      },
      {
        id: 'shared-challenges',
        title: 'Shared Challenges',
        description: "Arkadaşlarınızla ortak habit challenge'ları başlatın.",
        status: 'comingSoon',
        iconName: 'trophy-outline',
      },
    ],
  },
  {
    id: 'environment',
    title: 'Cihaz & Ortam',
    subtitle: 'Focus mode, smartwatch, Spotify ve akıllı ev bağlantılarını yönetin.',
    description:
      'Habitlerinizi cihazlarınız, odak modlarınız, müzik ve fiziksel ortamınızla bağlayın.',
    iconName: 'phone-portrait-outline',
    accentColor: '#14B8A6',
    items: [
      {
        id: 'focus-mode',
        title: 'Focus Mode',
        description: "Odak habit'i başladığında cihaz davranışlarını otomatik ayarlayın.",
        status: 'comingSoon',
        iconName: 'moon-outline',
      },
      {
        id: 'smartwatch',
        title: 'Smartwatch',
        description: 'Habitleri saatinizden takip edin, tamamlayın veya erteleyin.',
        status: 'comingSoon',
        iconName: 'watch-outline',
      },
      {
        id: 'spotify',
        title: 'Spotify',
        description:
          'Meditation, deep work veya workout için otomatik playlist başlatın.',
        status: 'comingSoon',
        iconName: 'musical-notes-outline',
      },
      {
        id: 'smart-lights',
        title: 'Akıllı Işıklar',
        description:
          'Sabah rutini, uyku modu veya odak seansı için ortam ışığını değiştirin.',
        status: 'comingSoon',
        iconName: 'bulb-outline',
      },
      {
        id: 'smart-speakers',
        title: 'Smart Speakers',
        description: 'Sesli komutlar ve ortam bildirimleriyle habit akışını destekleyin.',
        status: 'comingSoon',
        iconName: 'volume-high-outline',
      },
    ],
  },
];
