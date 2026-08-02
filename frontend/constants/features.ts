export type FeatureHighlight = {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
};

export const CURRENT_FEATURES: FeatureHighlight[] = [
  {
    id: 'habit-tracking',
    title: 'Alışkanlık takibi',
    description: 'Günlük tamamlama, seri ve güç skoru ile ilerlemenizi görün.',
    icon: 'checkmark-circle-outline',
    color: '#6366f1',
  },
  {
    id: 'habit-queue',
    title: 'Odaklı alışkanlık kuyruğu',
    description: 'Aynı anda sınırlı aktif alışkanlık; impact ve önceliğe göre sıralama.',
    icon: 'layers-outline',
    color: '#6366f1',
  },
  {
    id: 'eisenhower',
    title: 'Eisenhower ile hedefleme',
    description: 'Yeni alışkanlıklarda aciliyet ve önem matrisi.',
    icon: 'grid-outline',
    color: '#8b5cf6',
  },
  {
    id: 'xp-level',
    title: 'XP ve seviye',
    description: 'Tamamladıkça deneyim puanı kazanın ve seviye atlayın.',
    icon: 'trophy-outline',
    color: '#f59e0b',
  },
  {
    id: 'timeline',
    title: 'Günlük timeline',
    description: 'Tarihe göre görevlerinizi yönetin ve tamamlayın.',
    icon: 'calendar-outline',
    color: '#3b82f6',
  },
  {
    id: 'adhd-split',
    title: 'ADHD dostu görev bölme',
    description: 'Büyük görevleri küçük, yapılabilir adımlara ayırın.',
    icon: 'git-branch-outline',
    color: '#14b8a6',
  },
  {
    id: 'heatmap',
    title: 'Aktivite ısı haritası',
    description: 'GitHub benzeri yıllık tamamlama görünümü.',
    icon: 'analytics-outline',
    color: '#10b981',
  },
  {
    id: 'bad-habits',
    title: 'Bıraktığım alışkanlıklar',
    description: 'Kötü alışkanlık takibi ve tasarruf özeti.',
    icon: 'ban-outline',
    color: '#ef4444',
  },
  {
    id: 'export',
    title: 'Veri dışa aktarma',
    description: 'JSON, Excel ve CSV ile verileriniz sizde kalır.',
    icon: 'download-outline',
    color: '#10b981',
  },
  {
    id: 'webhook',
    title: 'Webhook otomasyonu',
    description: 'Tamamlama olaylarını kendi URL’nize gönderin. Kurulum: Entegrasyonlar → Otomasyonlar.',
    icon: 'link-outline',
    color: '#f59e0b',
  },
];

export const UPCOMING_FEATURES: FeatureHighlight[] = [
  {
    id: 'quick-add-task',
    title: 'Hızlı görev ekleme',
    description: 'Timeline üzerinden tek dokunuşla görev oluşturma.',
    icon: 'add-circle-outline',
    color: '#9ca3af',
  },
  {
    id: 'achievements-gallery',
    title: 'Rozet ve başarım galerisi',
    description: 'Kazandığınız rozetleri tek ekranda görüntüleyin.',
    icon: 'ribbon-outline',
    color: '#9ca3af',
  },
  {
    id: 'integrations-hub',
    title: 'Entegrasyonlar',
    description: 'Notion, sağlık verisi, AI koç ve daha fazlası — yukarıdaki Entegrasyonlar bölümünde.',
    icon: 'extension-puzzle-outline',
    color: '#9ca3af',
  },
];
