// Katmanlı abonelik + Focus Point kredi sistemi — paylaşılan config
// Backend (generate-routine) ile aynı maliyet/grant değerleri kullanılmalı.

export type Tier = 'free' | 'plus' | 'pro';
export type BillingPeriod = 'weekly' | 'monthly' | 'yearly';

// Aksiyon başına Focus Point maliyeti (backend ile birebir)
export const ACTION_COST: Record<'coach' | 'routine' | 'summarize' | 'insights', number> = {
  coach: 5,
  routine: 25,
  summarize: 3,
  insights: 5,
};

export type TierConfig = {
  key: Tier;
  name: string;
  grant: number;            // aylık Focus Point
  color: string;
  tagline: string;
  features: string[];
  prices?: Partial<Record<BillingPeriod, number>>;
};

export const TIERS: Record<Tier, TierConfig> = {
  free: {
    key: 'free',
    name: 'Free',
    grant: 30,
    color: '#6b7280',
    tagline: 'Başlangıç için',
    features: [
      'Tüm alışkanlık takibi & Kanban',
      'Grafikler, istatistik & ısı haritası',
      'İrade ekonomisi & oyunlaştırma',
      'Aylık 30 Focus Point',
    ],
  },
  plus: {
    key: 'plus',
    name: 'Nexus Plus',
    grant: 100,
    color: '#6366f1',
    tagline: 'Günlük AI yardımı',
    prices: { weekly: 4.99, monthly: 12.99, yearly: 39.99 },
    features: [
      "Free'deki her şey",
      'Aylık 100 Focus Point',
      'AI Coach sohbeti',
      'AI Rutin oluşturucu',
      'Reklamsız deneyim',
    ],
  },
  pro: {
    key: 'pro',
    name: 'Nexus Pro',
    grant: 1000,
    color: '#f59e0b',
    tagline: 'Kişisel AI koçun',
    prices: { monthly: 29.99, yearly: 99.99 },
    features: [
      "Plus'taki her şey",
      'Aylık 1000 Focus Point',
      'Öncelikli sunucu hızı',
      'Gelişmiş AI modeli erişimi',
      'Sınırsıza yakın koçluk',
    ],
  },
};

export const PERIOD_LABEL: Record<BillingPeriod, string> = {
  weekly: 'Haftalık',
  monthly: 'Aylık',
  yearly: 'Yıllık',
};

export function priceLabel(tier: Tier, period: BillingPeriod): string | null {
  const p = TIERS[tier].prices?.[period];
  return p != null ? `$${p.toFixed(2)}` : null;
}

// Bakiyenin kaç coach mesajına / kaç rutine yettiği
export function creditsSummary(focusPoints: number) {
  return {
    coach: Math.floor(focusPoints / ACTION_COST.coach),
    routine: Math.floor(focusPoints / ACTION_COST.routine),
  };
}
