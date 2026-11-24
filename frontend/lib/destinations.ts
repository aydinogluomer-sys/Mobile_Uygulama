import type { Href } from 'expo-router';
import {
  GOOGLE_CALENDAR_INTEGRATION_ENABLED,
  NOTION_INTEGRATION_ENABLED,
  SPOTIFY_OAUTH_ENABLED,
} from './featureGates';

export type Tier = 'core' | 'more' | 'labs';
export type DrawerGroup = 'PLANLAMA' | 'ALIŞKANLIKLAR' | 'KİŞİSEL' | 'SİSTEM';
export type HubCategory = 'strategy' | 'focus' | 'library' | 'review' | 'system';
export type ToneKey =
  | 'primary'
  | 'accent'
  | 'warning'
  | 'teal'
  | 'success'
  | 'error'
  | 'textDim'
  | 'textFaint';
export type TabPath =
  | '/tabs/today'
  | '/tabs/plan'
  | '/tabs/timeline'
  | '/tabs/insights'
  | '/tabs/profile'
  | '/tabs/hub';
export type DestinationHref =
  | { pathname: TabPath; params?: Readonly<Record<string, string>> }
  | { pathname: `/screens/${string}`; params?: Readonly<Record<string, string>> };
export type DestinationId =
  | 'today'
  | 'habits'
  | 'plan'
  | 'insights'
  | 'profile'
  | 'explore'
  | 'tasks'
  | 'projects'
  | 'focus'
  | 'goals'
  | 'life-areas'
  | 'okr'
  | 'calendar'
  | 'stats'
  | 'weekly-review'
  | 'monthly-review'
  | 'behaviour'
  | 'recovery'
  | 'journal'
  | 'journal-archive'
  | 'journal-insights'
  | 'coach'
  | 'settings'
  | 'integrations'
  | 'notes'
  | 'reading-list'
  | 'deep-work'
  | 'eisenhower'
  | 'leaderboard'
  | 'achievements'
  | 'routine-runner'
  | 'focus-flow'
  | 'privacy'
  | 'focus-points'
  | 'credit-history';
export type Surface = 'drawer' | 'hub' | 'palette';

export type Destination = {
  id: DestinationId;
  label: string;
  shortLabel: string;
  hint: string;
  icon: string;
  tone: ToneKey;
  tier: Tier;
  drawerGroup: DrawerGroup;
  href: DestinationHref;
  embedded: boolean;
  legacyRoutes: readonly string[];
  keywords: readonly string[];
  surfaces: readonly Surface[];
  hub?: { category: HubCategory; blurb: string; featured?: boolean };
  gate?: 'integrations';
};

export const INTEGRATIONS_VISIBLE: boolean =
  NOTION_INTEGRATION_ENABLED || GOOGLE_CALENDAR_INTEGRATION_ENABLED || SPOTIFY_OAUTH_ENABLED;

export const DESTINATIONS: readonly Destination[] = [
  // ── Core (8) ─────────────────────────────────────────────────────────────
  {
    id: 'today',
    label: 'Bugün',
    shortLabel: 'Bugün',
    hint: 'Günlük odak ve ritüeller',
    icon: 'sunny-outline',
    tone: 'warning',
    tier: 'core',
    drawerGroup: 'PLANLAMA',
    href: { pathname: '/tabs/today' },
    embedded: false,
    legacyRoutes: ['/tabs/today'],
    keywords: ['bugün', 'günlük pusula', 'ana sayfa'],
    surfaces: ['drawer', 'palette'],
  },
  {
    id: 'habits',
    label: 'Alışkanlıklar',
    shortLabel: 'Alışkanlıklar',
    hint: 'Günlük ritim akışı ve alışkanlıklar',
    icon: 'checkmark-circle-outline',
    tone: 'success',
    tier: 'core',
    drawerGroup: 'ALIŞKANLIKLAR',
    href: { pathname: '/tabs/timeline' },
    embedded: false,
    legacyRoutes: ['/tabs/timeline', '/tabs/habits'],
    keywords: ['alışkanlık', 'ritüel', 'takip', 'zincir'],
    surfaces: ['drawer', 'palette'],
  },
  {
    id: 'tasks',
    label: 'Görevler',
    shortLabel: 'Görevler',
    hint: 'Öncelikli adımlar ve gelen kutusu',
    icon: 'checkbox-outline',
    tone: 'accent',
    tier: 'core',
    drawerGroup: 'PLANLAMA',
    href: { pathname: '/tabs/plan', params: { tab: 'tasks' } },
    embedded: true,
    legacyRoutes: ['/tabs/tasks', '/tabs/plan?tab=tasks'],
    keywords: ['görev', 'gelen kutusu', 'yapılacak'],
    surfaces: ['drawer', 'palette'],
  },
  {
    id: 'focus',
    label: 'Odak Sayacı',
    shortLabel: 'Odak',
    hint: 'Zamanlayıcılı odak seansı',
    icon: 'timer-outline',
    tone: 'teal',
    tier: 'core',
    drawerGroup: 'PLANLAMA',
    href: { pathname: '/tabs/plan', params: { tab: 'focus' } },
    embedded: true,
    legacyRoutes: ['/tabs/focus', '/tabs/plan?tab=focus'],
    keywords: ['odak', 'pomodoro', 'zamanlayıcı', 'sayaç'],
    surfaces: ['drawer', 'palette'],
  },
  {
    id: 'journal',
    label: 'Günlük',
    shortLabel: 'Günlük',
    hint: 'Duygu ve düşünce defteri',
    icon: 'journal-outline',
    tone: 'primary',
    tier: 'core',
    drawerGroup: 'KİŞİSEL',
    href: { pathname: '/tabs/insights', params: { tab: 'journal', sub: 'write' } },
    embedded: true,
    legacyRoutes: ['/screens/journal', '/tabs/insights?tab=journal&sub=write'],
    keywords: ['günlük', 'defter', 'yansıma', 'yazı'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'library', blurb: 'Duygu ve düşünce günlüğü' },
  },
  {
    id: 'recovery',
    label: 'Telafi Planı',
    shortLabel: 'Telafi',
    hint: 'Kaçan alışkanlık ve görev telafisi',
    icon: 'umbrella-outline',
    tone: 'warning',
    tier: 'core',
    drawerGroup: 'ALIŞKANLIKLAR',
    href: { pathname: '/tabs/insights', params: { tab: 'reports', sub: 'recovery' } },
    embedded: true,
    legacyRoutes: ['/screens/recovery', '/tabs/insights?tab=reports&sub=recovery'],
    keywords: ['telafi', 'kalkan', 'kaçan', 'toparlanma'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'focus', blurb: 'Geciken görevleri toparla' },
  },
  {
    id: 'weekly-review',
    label: 'Haftalık Rapor',
    shortLabel: 'Haftalık Özet',
    hint: 'Haftalık kazanımlar ve değerlendirme',
    icon: 'bar-chart-outline',
    tone: 'teal',
    tier: 'core',
    drawerGroup: 'ALIŞKANLIKLAR',
    href: { pathname: '/tabs/insights', params: { tab: 'reports', sub: 'weekly' } },
    embedded: true,
    legacyRoutes: ['/screens/weekly-review', '/tabs/insights?tab=reports&sub=weekly'],
    keywords: ['haftalık', 'rapor', 'değerlendirme', 'özet'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'review', blurb: 'Haftalık kazanımlar ve trendler' },
  },
  {
    id: 'settings',
    label: 'Ayarlar',
    shortLabel: 'Ayarlar',
    hint: 'Uygulama tercihleri ve veri kontrolü',
    icon: 'settings-outline',
    tone: 'textFaint',
    tier: 'core',
    drawerGroup: 'SİSTEM',
    href: { pathname: '/tabs/profile', params: { tab: 'settings' } },
    embedded: true,
    legacyRoutes: ['/tabs/settings', '/tabs/profile?tab=settings'],
    keywords: ['ayarlar', 'tema', 'tercihler', 'dışa aktarma'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'system', blurb: 'Veri dışa aktarma, bildirim ve tema' },
  },

  // ── Tab hubs (3) ─────────────────────────────────────────────────────────
  {
    id: 'plan',
    label: 'Plan Merkezi',
    shortLabel: 'Plan',
    hint: 'Görev, strateji ve takvim pusulası',
    icon: 'compass-outline',
    tone: 'primary',
    tier: 'more',
    drawerGroup: 'PLANLAMA',
    href: { pathname: '/tabs/plan' },
    embedded: false,
    legacyRoutes: ['/tabs/plan'],
    keywords: ['plan', 'strateji', 'pusula'],
    surfaces: ['palette'],
  },
  {
    id: 'insights',
    label: 'İçgörüler Merkezi',
    shortLabel: 'İçgörüler',
    hint: 'Raporlar, günlük ve akıllı koç',
    icon: 'analytics-outline',
    tone: 'accent',
    tier: 'more',
    drawerGroup: 'ALIŞKANLIKLAR',
    href: { pathname: '/tabs/insights' },
    embedded: false,
    legacyRoutes: ['/tabs/insights'],
    keywords: ['içgörüler', 'analiz', 'rapor'],
    surfaces: ['palette'],
  },
  {
    id: 'profile',
    label: 'Profilim',
    shortLabel: 'Profil',
    hint: 'Seviye, rozetler ve kimlik özeti',
    icon: 'person-circle-outline',
    tone: 'accent',
    tier: 'more',
    drawerGroup: 'KİŞİSEL',
    href: { pathname: '/tabs/profile', params: { tab: 'me' } },
    embedded: true,
    legacyRoutes: ['/screens/profile', '/tabs/profile', '/tabs/profile?tab=me'],
    keywords: ['profil', 'seviye', 'kimlik', 'hesap'],
    surfaces: ['palette'],
  },

  // ── More (20) ────────────────────────────────────────────────────────────
  {
    id: 'okr',
    label: 'OKR & Key Results',
    shortLabel: 'OKR',
    hint: 'Çeyreklik hedefler ve ölçülebilir sonuçlar',
    icon: 'flag-outline',
    tone: 'error',
    tier: 'more',
    drawerGroup: 'PLANLAMA',
    href: { pathname: '/tabs/plan', params: { tab: 'okr' } },
    embedded: true,
    legacyRoutes: ['/screens/okr', '/tabs/plan?tab=okr'],
    keywords: ['okr', 'anahtar sonuç', 'çeyreklik hedef'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'strategy', blurb: 'Çeyreklik hedefler ve ölçülebilir sonuçlar', featured: true },
  },
  {
    id: 'goals',
    label: 'Hedefler',
    shortLabel: 'Hedefler',
    hint: 'Uzun ve orta vadeli vizyon hedefleri',
    icon: 'trophy-outline',
    tone: 'warning',
    tier: 'more',
    drawerGroup: 'PLANLAMA',
    href: { pathname: '/tabs/plan', params: { tab: 'goals' } },
    embedded: true,
    legacyRoutes: ['/screens/goals', '/tabs/plan?tab=goals'],
    keywords: ['hedef', 'vizyon', 'yıllık'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'strategy', blurb: 'Yıllık ve aylık vizyon hedefleri' },
  },
  {
    id: 'life-areas',
    label: 'Yaşam Alanları',
    shortLabel: 'Yaşam Alanı',
    hint: 'Yaşam çarkı ve denge alanları',
    icon: 'pie-chart-outline',
    tone: 'success',
    tier: 'more',
    drawerGroup: 'PLANLAMA',
    href: { pathname: '/tabs/plan', params: { tab: 'life_areas' } },
    embedded: true,
    legacyRoutes: ['/screens/life-areas', '/tabs/plan?tab=life_areas'],
    keywords: ['yaşam alanı', 'denge', 'çark'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'strategy', blurb: '8 alanlık yaşam dengesi çarkı' },
  },
  {
    id: 'projects',
    label: 'Projeler',
    shortLabel: 'Projeler',
    hint: 'Aktif proje ve kilometre taşları',
    icon: 'folder-outline',
    tone: 'primary',
    tier: 'more',
    drawerGroup: 'PLANLAMA',
    href: { pathname: '/tabs/plan', params: { tab: 'projects' } },
    embedded: true,
    legacyRoutes: ['/screens/projects', '/tabs/plan?tab=projects'],
    keywords: ['proje', 'çıktı', 'kilometre taşı'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'strategy', blurb: 'Aktif hedefler ve kilometre taşları' },
  },
  {
    id: 'eisenhower',
    label: 'Eisenhower Matrisi',
    shortLabel: 'Eisenhower',
    hint: 'Acil ve önemli görev matrisi',
    icon: 'grid-outline',
    tone: 'error',
    tier: 'more',
    drawerGroup: 'PLANLAMA',
    href: { pathname: '/screens/eisenhower' },
    embedded: false,
    legacyRoutes: ['/screens/eisenhower'],
    keywords: ['eisenhower', 'matris', 'acil', 'önemli', 'kadran'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'focus', blurb: 'Acil / önemli 4 çeyrek analizi' },
  },
  {
    id: 'calendar',
    label: 'Takvim',
    shortLabel: 'Takvim',
    hint: 'Aylık takvim ve ajanda',
    icon: 'calendar-outline',
    tone: 'primary',
    tier: 'more',
    drawerGroup: 'PLANLAMA',
    href: { pathname: '/tabs/plan', params: { tab: 'calendar' } },
    embedded: true,
    legacyRoutes: ['/screens/calendar', '/tabs/plan?tab=calendar'],
    keywords: ['takvim', 'ajanda', 'aylık'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'strategy', blurb: 'Aylık takvim' },
  },
  {
    id: 'routine-runner',
    label: 'Rutin Yürütücü',
    shortLabel: 'Rutin Koş',
    hint: 'Sabah ve akşam adımları',
    icon: 'play-circle-outline',
    tone: 'success',
    tier: 'more',
    drawerGroup: 'ALIŞKANLIKLAR',
    href: { pathname: '/screens/routine-runner' },
    embedded: false,
    legacyRoutes: ['/screens/routine-runner'],
    keywords: ['rutin', 'koşucu', 'sabah', 'akşam'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'focus', blurb: 'Sabah & akşam adımlarını koştur', featured: true },
  },
  {
    id: 'deep-work',
    label: 'Derin Çalışma',
    shortLabel: 'Derin Odak',
    hint: 'Kesintisiz odaklanma oturumu',
    icon: 'flash-outline',
    tone: 'teal',
    tier: 'more',
    drawerGroup: 'ALIŞKANLIKLAR',
    href: { pathname: '/screens/deep-work' },
    embedded: false,
    legacyRoutes: ['/screens/deep-work'],
    keywords: ['derin çalışma', 'derin odak', 'oturum'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'focus', blurb: 'Kesintisiz odaklanma oturumu', featured: true },
  },
  {
    id: 'behaviour',
    label: 'Davranış Analizi',
    shortLabel: 'Davranış',
    hint: 'Haftalık ve aylık davranış analizi',
    icon: 'bulb-outline',
    tone: 'accent',
    tier: 'more',
    drawerGroup: 'ALIŞKANLIKLAR',
    href: { pathname: '/tabs/insights', params: { tab: 'reports', sub: 'behaviour' } },
    embedded: true,
    legacyRoutes: ['/screens/insights', '/tabs/insights?tab=reports&sub=behaviour'],
    keywords: ['davranış', 'korelasyon', 'analiz', 'içgörü'],
    surfaces: ['drawer', 'palette'],
  },
  {
    id: 'monthly-review',
    label: 'Aylık Özet',
    shortLabel: 'Aylık Özet',
    hint: 'Aylık değerlendirme ve rapor',
    icon: 'calendar-number-outline',
    tone: 'accent',
    tier: 'more',
    drawerGroup: 'ALIŞKANLIKLAR',
    href: { pathname: '/tabs/insights', params: { tab: 'reports', sub: 'monthly' } },
    embedded: true,
    legacyRoutes: ['/screens/monthly-review', '/tabs/insights?tab=reports&sub=monthly'],
    keywords: ['aylık', 'değerlendirme', 'rapor', 'özet'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'review', blurb: 'Aylık başarı ve gelişim raporu' },
  },
  {
    id: 'stats',
    label: 'Detaylı İstatistikler',
    shortLabel: 'İstatistikler',
    hint: 'Alışkanlık oranları ve yıllık ısı haritası',
    icon: 'stats-chart-outline',
    tone: 'teal',
    tier: 'more',
    drawerGroup: 'ALIŞKANLIKLAR',
    href: { pathname: '/tabs/insights', params: { tab: 'reports', sub: 'stats' } },
    embedded: true,
    legacyRoutes: ['/tabs/stats', '/tabs/insights?tab=reports&sub=stats'],
    keywords: ['istatistik', 'heatmap', 'ısı haritası', 'oran'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'review', blurb: 'Alışkanlık oranları ve heatmap' },
  },
  {
    id: 'achievements',
    label: 'Başarımlar & Rozetler',
    shortLabel: 'Rozetler',
    hint: 'Kazanılan rozetler ve XP ödülleri',
    icon: 'ribbon-outline',
    tone: 'warning',
    tier: 'more',
    drawerGroup: 'KİŞİSEL',
    href: { pathname: '/screens/achievements' },
    embedded: false,
    legacyRoutes: ['/screens/achievements'],
    keywords: ['başarım', 'rozet', 'ödül', 'xp'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'review', blurb: 'Kazanılan rozetler ve XP ödülleri' },
  },
  {
    id: 'leaderboard',
    label: 'Sıralama',
    shortLabel: 'Sıralama',
    hint: 'Puan ve seviye ligi',
    icon: 'podium-outline',
    tone: 'warning',
    tier: 'more',
    drawerGroup: 'KİŞİSEL',
    href: { pathname: '/screens/leaderboard' },
    embedded: false,
    legacyRoutes: ['/screens/leaderboard'],
    keywords: ['sıralama', 'liderlik', 'lig', 'puan'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'review', blurb: 'Seviye ve küresel lig sıralaması' },
  },
  {
    id: 'reading-list',
    label: 'Okuma Listesi',
    shortLabel: 'Kitaplık',
    hint: 'Kitaplık ve okuma hedefleri',
    icon: 'book-outline',
    tone: 'teal',
    tier: 'more',
    drawerGroup: 'KİŞİSEL',
    href: { pathname: '/screens/reading-list' },
    embedded: false,
    legacyRoutes: ['/screens/reading-list'],
    keywords: ['okuma', 'kitap', 'makale', 'kitaplık'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'library', blurb: 'Kitaplık ve sayfa hedefleri' },
  },
  {
    id: 'journal-archive',
    label: 'Günlük Arşivi',
    shortLabel: 'Günlükler',
    hint: 'Geçmiş günlük kayıtları ve okuyucu',
    icon: 'library-outline',
    tone: 'primary',
    tier: 'more',
    drawerGroup: 'KİŞİSEL',
    href: { pathname: '/tabs/insights', params: { tab: 'journal', sub: 'archive' } },
    embedded: true,
    legacyRoutes: ['/screens/journal-archive', '/tabs/insights?tab=journal&sub=archive'],
    keywords: ['günlük arşivi', 'geçmiş sayfalar', 'defter'],
    surfaces: ['drawer', 'palette'],
  },
  {
    id: 'journal-insights',
    label: 'Günlük İçgörüsü',
    shortLabel: 'Günlük AI',
    hint: 'Dönemsel günlük analizi ve özetler',
    icon: 'sparkles-outline',
    tone: 'accent',
    tier: 'more',
    drawerGroup: 'KİŞİSEL',
    href: { pathname: '/tabs/insights', params: { tab: 'journal', sub: 'insights' } },
    embedded: true,
    legacyRoutes: ['/screens/journal-insights', '/tabs/insights?tab=journal&sub=insights'],
    keywords: ['günlük analizi', 'dönemsel içgörü'],
    surfaces: ['drawer', 'palette'],
  },
  {
    id: 'notes',
    label: 'Notlar',
    shortLabel: 'Notlar',
    hint: 'Kişisel bilgi kütüphanesi',
    icon: 'document-text-outline',
    tone: 'textDim',
    tier: 'more',
    drawerGroup: 'KİŞİSEL',
    href: { pathname: '/screens/notes' },
    embedded: false,
    legacyRoutes: ['/screens/notes'],
    keywords: ['not', 'fikir', 'bilgi deposu'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'library', blurb: 'Hızlı notlar ve bilgi deposu' },
  },
  {
    id: 'coach',
    label: 'AI Koç',
    shortLabel: 'AI Koç',
    hint: 'Akıllı davranış ve alışkanlık koçu',
    icon: 'chatbubbles-outline',
    tone: 'teal',
    tier: 'more',
    drawerGroup: 'KİŞİSEL',
    href: { pathname: '/tabs/insights', params: { tab: 'coach' } },
    embedded: true,
    legacyRoutes: ['/screens/ai-coach', '/tabs/insights?tab=coach'],
    keywords: ['ai koç', 'asistan', 'sohbet', 'rehber'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'library', blurb: 'Alışkanlık ve davranış rehberi' },
  },
  {
    id: 'focus-points',
    label: 'Focus Points',
    shortLabel: 'Focus Points',
    hint: 'AI puan bakiyesi ve kullanım',
    icon: 'diamond-outline',
    tone: 'warning',
    tier: 'more',
    drawerGroup: 'SİSTEM',
    href: { pathname: '/screens/focus-points' },
    embedded: false,
    legacyRoutes: ['/screens/focus-points'],
    keywords: ['focus points', 'fp', 'bakiye', 'puan'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'system', blurb: 'AI puan bakiyesi ve kullanımı' },
  },
  {
    id: 'credit-history',
    label: 'Puan Geçmişi',
    shortLabel: 'Puanlar',
    hint: 'Focus Points hareketleri',
    icon: 'receipt-outline',
    tone: 'primary',
    tier: 'more',
    drawerGroup: 'SİSTEM',
    href: { pathname: '/screens/credit-history' },
    embedded: false,
    legacyRoutes: ['/screens/credit-history'],
    keywords: ['puan geçmişi', 'hareketler', 'focus points'],
    surfaces: ['drawer', 'palette'],
  },
  {
    id: 'privacy',
    label: 'Gizlilik & Güvenlik',
    shortLabel: 'Gizlilik',
    hint: 'Veri ihracı ve gizlilik politikası',
    icon: 'shield-checkmark-outline',
    tone: 'textDim',
    tier: 'more',
    drawerGroup: 'SİSTEM',
    href: { pathname: '/screens/privacy' },
    embedded: false,
    legacyRoutes: ['/screens/privacy'],
    keywords: ['gizlilik', 'güvenlik', 'veri koruma', 'politika'],
    surfaces: ['drawer', 'palette'],
  },

  // ── Labs (3) ─────────────────────────────────────────────────────────────
  {
    id: 'explore',
    label: 'Keşfet',
    shortLabel: 'Keşfet',
    hint: 'Hazır koleksiyonlar, mikro alışkanlıklar ve araçlar',
    icon: 'compass-outline',
    tone: 'primary',
    tier: 'labs',
    drawerGroup: 'SİSTEM',
    href: { pathname: '/tabs/hub' },
    embedded: false,
    legacyRoutes: ['/tabs/hub'],
    keywords: ['keşfet', 'hub', 'koleksiyon', 'paket', 'araçlar'],
    surfaces: ['drawer', 'palette'],
  },
  {
    id: 'focus-flow',
    label: 'Odak Akışı',
    shortLabel: 'Odak Akışı',
    hint: 'Odak mikro-dersleri',
    icon: 'flame-outline',
    tone: 'primary',
    tier: 'labs',
    drawerGroup: 'ALIŞKANLIKLAR',
    href: { pathname: '/screens/focus-flow' },
    embedded: false,
    legacyRoutes: ['/screens/focus-flow'],
    keywords: ['odak akışı', 'mikro-ders', 'akış'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'focus', blurb: 'Odak mikro-dersleri', featured: true },
  },
  {
    id: 'integrations',
    label: 'Bağlantılar',
    shortLabel: 'Bağlantılar',
    hint: 'Takvim ve dış servis bağlantıları',
    icon: 'git-network-outline',
    tone: 'teal',
    tier: 'labs',
    drawerGroup: 'SİSTEM',
    href: { pathname: '/screens/integrations' },
    embedded: false,
    legacyRoutes: ['/screens/integrations'],
    keywords: ['bağlantılar', 'entegrasyonlar', 'webhook', 'takvim', 'notion'],
    surfaces: ['drawer', 'hub', 'palette'],
    hub: { category: 'system', blurb: 'Webhook ve dış servis bağlantıları' },
    gate: 'integrations',
  },
];

const BY_ID = new Map<DestinationId, Destination>(DESTINATIONS.map((d) => [d.id, d]));

function serializeParams(params?: Readonly<Record<string, string>>): string {
  if (!params) return '';
  const entries = Object.entries(params)
    .filter(([k, v]) => k !== '_t' && v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export function routeKeyOf(target: DestinationHref | string): string {
  if (typeof target === 'string') {
    const [rawPath, rawQuery] = target.split('?');
    const pathname = rawPath.trim();
    if (!rawQuery) return pathname;
    const params: Record<string, string> = {};
    for (const part of rawQuery.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const k = eq === -1 ? part : part.slice(0, eq);
      const v = eq === -1 ? '' : decodeURIComponent(part.slice(eq + 1));
      if (k && k !== '_t') params[k] = v;
    }
    const qs = serializeParams(params);
    return qs ? `${pathname}?${qs}` : pathname;
  }
  const qs = serializeParams(target.params);
  return qs ? `${target.pathname}?${qs}` : target.pathname;
}

const BY_LEGACY = new Map<string, Destination>();
for (const d of DESTINATIONS) {
  BY_LEGACY.set(routeKeyOf(d.href), d);
  for (const r of d.legacyRoutes) {
    BY_LEGACY.set(routeKeyOf(r), d);
    BY_LEGACY.set(r, d);
  }
}

export function isDestinationVisible(d: Destination): boolean {
  if (d.gate === 'integrations' && !INTEGRATIONS_VISIBLE) return false;
  return true;
}

export function destinationById(id: DestinationId): Destination {
  const found = BY_ID.get(id);
  if (!found) {
    throw new Error(`Unknown destination id: ${id}`);
  }
  return found;
}

export function hrefFor(id: DestinationId): DestinationHref {
  return destinationById(id).href;
}

export const hrefOf = hrefFor;

export function destinationForLegacyRoute(route: string): Destination | null {
  if (typeof route !== 'string') return null;
  const trimmed = route.trim();
  if (!trimmed) return null;
  const direct = BY_LEGACY.get(trimmed) ?? BY_LEGACY.get(routeKeyOf(trimmed));
  if (direct) return direct;
  const base = trimmed.split('?')[0];
  return BY_LEGACY.get(base) ?? null;
}

export function visibleDestinations(surface: Surface): Destination[] {
  return DESTINATIONS.filter((d) => d.surfaces.includes(surface) && isDestinationVisible(d));
}

export type HubDestination = Destination & {
  readonly hub: NonNullable<Destination['hub']>;
};

export function hubDestinations(category: HubCategory | 'all'): HubDestination[] {
  return visibleDestinations('hub').filter(
    (d): d is HubDestination =>
      d.hub !== undefined && (category === 'all' || d.hub.category === category),
  );
}

export function toRouterHref(h: DestinationHref): Href {
  if (h.params && Object.keys(h.params).length > 0) {
    return { pathname: h.pathname, params: { ...h.params } } as Href;
  }
  return h.pathname as Href;
}

export function navigateTo(
  router: { navigate?: (h: Href) => void; push: (h: Href) => void },
  id: DestinationId,
  extra?: Readonly<Record<string, string>>,
): void {
  const dest = destinationById(id);
  const merged: Record<string, string> = {
    ...(dest.href.params ?? {}),
    ...(extra ?? {}),
  };
  const hasParams = Object.keys(merged).length > 0;
  const isTabTarget = dest.embedded || dest.href.pathname.startsWith('/tabs/');

  if (isTabTarget) {
    const nav = typeof router.navigate === 'function' ? router.navigate.bind(router) : router.push.bind(router);
    if (hasParams) {
      nav({
        pathname: dest.href.pathname,
        params: { ...merged, _t: String(Date.now()) },
      } as Href);
    } else {
      nav(dest.href.pathname as Href);
    }
    return;
  }

  router.push(
    toRouterHref(
      hasParams
        ? { pathname: dest.href.pathname, params: merged }
        : { pathname: dest.href.pathname },
    ),
  );
}
