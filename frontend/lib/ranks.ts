// 6 kademeli rütbe sistemi — backend public.get_rank_for_level ile birebir.
// XPDisplay, leaderboard ve profile ekranları bu tek kaynağı kullanır.
import type { Ionicons } from '@expo/vector-icons';

export type RankTier = {
  name: string;
  minLevel: number;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
};

// minLevel artan sırada
export const RANK_TIERS: RankTier[] = [
  { name: 'Acemi',    minLevel: 1,  color: '#BFBBAE', icon: 'leaf-outline' },
  { name: 'Çırak',    minLevel: 5,  color: '#87A678', icon: 'school-outline' },
  { name: 'Savaşçı',  minLevel: 10, color: '#7C97C5', icon: 'flash-outline' },
  { name: 'Şövalye',  minLevel: 20, color: '#8b5cf6', icon: 'ribbon-outline' },
  { name: 'Usta',     minLevel: 30, color: '#D4A84A', icon: 'star-outline' },
  { name: 'Efsane',   minLevel: 50, color: '#C76A6A', icon: 'flame-outline' },
];

// Seviyeye göre rütbe (en yüksek minLevel <= level)
export function rankForLevel(level: number): RankTier {
  let tier = RANK_TIERS[0];
  for (const t of RANK_TIERS) {
    if (level >= t.minLevel) tier = t;
  }
  return tier;
}

// İsimle rütbe metası; bulunamazsa seviyeye düş
export function rankMeta(name: string | null | undefined, level = 1): RankTier {
  if (name) {
    const found = RANK_TIERS.find((t) => t.name === name);
    if (found) return found;
  }
  return rankForLevel(level);
}
