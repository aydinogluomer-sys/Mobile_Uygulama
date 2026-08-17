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

    // "Haftada X kez" — gün seçilmemiş. Eskiden burada `false` dönülüyordu,
    // yani count tabanlı bir alışkanlık YILIN HİÇBİR GÜNÜNDE due olmuyordu:
    // hiç kaçırılmıyor, hiç sayılmıyor, telafiye hiç girmiyordu (AC-H03).
    const count = habit.frequency_config?.count;
    if (typeof count === 'number' && count > 0) {
      return countDueDays(count).includes(weekdayIndex(date));
    }
    return false; // ne gün ne sayı → sabitlenecek bir şey yok
  }
  // monthly → belirli güne sabitlenemez.
  // Bu bilinçli bir karardır, eksik uygulama değil: ayın hangi gününde due
  // olduğu saklanmıyor, dolayısıyla tahmin etmek yanlış "kaçırıldı" üretirdi.
  // Aylık alışkanlıklar için due/miss kavramı ayrı bir tasarım işidir.
  return false;
}

/**
 * `count` haftalık hedefi için haftanın hangi günleri due sayılır.
 *
 * Günler haftaya MÜMKÜN OLDUĞUNCA EŞİT dağıtılır — 3 için Pzt/Çar/Cum gibi —
 * çünkü ardışık ilk N günü seçmek (Pzt/Sal/Çar) hafta sonunu yapısal olarak
 * boş bırakır ve gerçek kullanım örüntüsüne uymaz.
 *
 * Deterministiktir: aynı `count` her hafta aynı günleri verir, böylece
 * raporlar haftalar arasında karşılaştırılabilir kalır.
 *
 * SINIR — bilerek: bu fonksiyonun tamamlanma verisi yoktur. "Haftada 3" hedefi
 * olan biri Sal/Per/Cmt yaparsa, bu takvim Pzt/Çar/Cum bekler ve üç "kaçırma"
 * üretir. Saf, tarih-temelli bir yanıt için doğru davranış budur; gerçek
 * kaçırma tespiti tamamlanma sayısını görmek zorundadır ve çağıranın işidir.
 */
function countDueDays(count: number): number[] {
  const n = Math.min(Math.max(Math.floor(count), 1), 7);
  if (n >= 7) return [0, 1, 2, 3, 4, 5, 6];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(Math.round((i * 7) / n)); // n=3 → 0,2,5 (Pzt/Çar/Cmt)
  }
  return Array.from(new Set(out));
}
