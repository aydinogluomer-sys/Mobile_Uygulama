// 6 kademeli rütbe sistemi — backend public.get_rank_for_level ile birebir.
// XPDisplay, leaderboard ve profile ekranları bu tek kaynağı kullanır.
import { colors } from '../lib/tokens';
import type { Ionicons } from '@expo/vector-icons';

export type RankTier = {
  name: string;
  minLevel: number;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
};

// minLevel artan sırada
export const RANK_TIERS: RankTier[] = [
  { name: 'Acemi',    minLevel: 1,  color: colors.textDim, icon: 'leaf-outline' },
  { name: 'Çırak',    minLevel: 5,  color: colors.success, icon: 'school-outline' },
  { name: 'Savaşçı',  minLevel: 10, color: colors.teal, icon: 'flash-outline' },
  { name: 'Şövalye',  minLevel: 20, color: '#8b5cf6', icon: 'ribbon-outline' },
  { name: 'Usta',     minLevel: 30, color: colors.warning, icon: 'star-outline' },
  { name: 'Efsane',   minLevel: 50, color: colors.error, icon: 'flame-outline' },
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
