import { format } from 'date-fns';
import type { Habit } from './supabase';

// HabitOnboarding WEEKDAYS = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz']
// → saklanan frequency_config.days indeksi: 0=Pazartesi … 6=Pazar.
// JS Date.getDay(): 0=Pazar … 6=Cumartesi. Dönüşüm:
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7; // Pzt=0 … Paz=6
}

function dStr(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/**
 * Alışkanlık belirli bir günde "yapılması gereken" (due) mi?
 * Telafi/kaçırma tespiti için kullanılır. Yalnız POZİTİF (kurulan) alışkanlıklar için
 * anlamlıdır — negatif (kaçınma) alışkanlıkları telafi mantığına girmez.
 * Belirsiz frekanslar (haftalık-günsüz, aylık) güvenli tarafta `false` döner; böylece
 * yanlış "kaçırıldı" üretilmez (aşırı sayım yerine eksik sayım tercih edilir).
 */
export function isDueOn(habit: Habit, date: Date): boolean {
  if (habit.behavior_type !== 'positive') return false;

  const ds = dStr(date);
  // Oluşturulmadan önceki günlerde due değil
  if (habit.created_at && format(new Date(habit.created_at), 'yyyy-MM-dd') > ds) return false;
  // Tarihli bitiş koşulu geçmişse due değil
  const ec = habit.end_condition;
  if (ec && ec.kind === 'date' && typeof ec.value === 'string' && ds > ec.value) return false;

  const kind = habit.frequency_config?.kind ?? 'daily';
  if (kind === 'daily') return true;
  if (kind === 'weekly') {
    const days = habit.frequency_config?.days;
    if (days && days.length > 0) return days.includes(weekdayIndex(date));
    return false; // gün belirtilmemiş haftalık → belirli güne sabitlenemez
  }
  // monthly → belirli güne sabitlenemez
  return false;
}
