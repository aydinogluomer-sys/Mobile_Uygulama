const fs = require('fs');
const { execSync } = require('child_process');

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) {
      results.push('  ✅ ' + name);
      passed++;
    } else {
      results.push('  ❌ ' + name + (typeof r === 'string' ? ': ' + r : ''));
      failed++;
    }
  } catch(e) {
    results.push('  ❌ ' + name + ': ' + e.message.split('\n')[0]);
    failed++;
  }
}

function read(p) { return fs.readFileSync(p, 'utf8'); }
function exists(p) { return fs.existsSync(p); }

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  ATLAS POS v2 — TAM TEST SÜİTİ');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// 1. TypeScript
console.log('\n📋 1. TypeScript');
test('0 hata', () => {
  try { execSync('npx tsc --noEmit', { stdio: 'pipe' }); return true; }
  catch(e) { return (e.stdout || e.stderr || '').toString().slice(0, 200); }
});

// 2. Dosya varlığı
console.log('\n📁 2. Dosya Varlığı');
['today','tasks','focus','timeline','stats','habits','hub','settings'].forEach(t =>
  test('tabs/' + t + '.tsx', () => exists('./app/tabs/' + t + '.tsx'))
);
['calendar','recovery','projects','notes','journal','weekly-review','monthly-review','reading-list'].forEach(s =>
  test('screens/' + s + '.tsx', () => exists('./app/screens/' + s + '.tsx'))
);
['habitStore','taskStore','logStore','willpowerStore','focusStore','drawerStore','readingListStore','commandStore','routineStore'].forEach(s =>
  test('store/' + s + '.ts', () => exists('./store/' + s + '.ts'))
);
['Drawer','CommandPalette','ADHDTaskSplitter','AIRoutineModal','MeasurableInputModal'].forEach(c =>
  test('components/' + c + '.tsx', () => exists('./components/' + c + '.tsx'))
);

// 3. Navigasyon
console.log('\n🗺️  3. Navigasyon Mimarisi');
const layout = read('./app/tabs/_layout.tsx');
// Bu assertion eskiden yalnız isimlerin dosyada GEÇTİĞİNİ arıyordu, ki gizli
// route'lar da geçtiği için hedef IA'ya geçildiğinde bile yeşil kalırdı --
// yani ölçmesi gereken şeyi ölçmüyordu. Artık görünür ve gizli kümeler ayrı
// ayrı çözümleniyor: `href: null` taşıyan bir <Tabs.Screen> tab bar'da yoktur.
function parseTabs() {
  const visible = [], hidden = [];
  const re = /<Tabs\.Screen\s+name="([a-z]+)"([\s\S]*?)\/>/g;
  let m;
  while ((m = re.exec(layout))) (m[2].includes('href: null') ? hidden : visible).push(m[1]);
  return { visible, hidden };
}
test('tam olarak 5 görünür tab', () => parseTabs().visible.length === 5);
test('hedef IA sırası: today/plan/timeline/insights/profile', () =>
  parseTabs().visible.join(',') === 'today,plan,timeline,insights,profile');
test('tab başlıkları Bugün/Plan/Alışkanlıklar/İçgörüler/Profil', () =>
  ['Bugün','Plan','Alışkanlıklar','İçgörüler','Profil'].every(t => layout.includes("title: '" + t + "'")));
// Eski sekmeler SİLİNMEDİ, gizlendi: drawer ve deep-link'ler hâlâ onlara gider.
test('eski sekmeler route olarak korunuyor', () => {
  const { hidden } = parseTabs();
  return ['tasks','focus','stats','habits','hub','settings'].every(t => hidden.includes(t));
});
test('hub ekranları eski ekranları yeniden kullanıyor (kopya yok)', () => {
  const plan = read('./app/tabs/plan.tsx');
  const ins = read('./app/tabs/insights.tsx');
  const prof = read('./app/tabs/profile.tsx');
  return plan.includes("from './tasks'") && plan.includes("from './focus'")
    && ins.includes("from './stats'") && ins.includes('weekly-review')
    && prof.includes("from './settings'") && prof.includes('integrations');
});
test('Drawer render ediliyor', () => layout.includes('<Drawer />'));
test('HamburgerButton headerLeft', () => layout.includes('HamburgerButton'));
test('Arama/komut girişi headerRight', () => layout.includes('headerRight') && layout.includes('HeaderActions') && layout.includes('useCommandStore'));
const rootLayout = read('./app/_layout.tsx');
test('Auth redirect /tabs/today', () => rootLayout.includes('/tabs/today'));
test('Supabase auth dinleniyor', () => rootLayout.includes('onAuthStateChange'));

// 4. Drawer
console.log('\n🗂️  4. Drawer');
const drawer = read('./components/Drawer.tsx');
test('4 grup (PLANLAMA/KİŞİSEL/ALIŞKANLIKLAR/SİSTEM)', () =>
  ['PLANLAMA','KİŞİSEL','ALIŞKANLIKLAR','SİSTEM'].every(g => drawer.includes(g))
);
test('Aylık Özet rotası', () => drawer.includes('/screens/monthly-review'));
test('Okuma Listesi rotası', () => drawer.includes('/screens/reading-list'));
test('Takvim rotası', () => drawer.includes('/screens/calendar'));
test('Animated.Value translateX animasyonu', () => drawer.includes('Animated.Value') && drawer.includes('translateX'));
test('Modal backdrop', () => drawer.includes('backdrop') || drawer.includes('Pressable'));
test('drawerStore open/close/toggle', () => {
  const s = read('./store/drawerStore.ts');
  return ['isOpen','open','close','toggle'].every(k => s.includes(k));
});

// 5. Bugün ekranı
console.log('\n☀️  5. Bugün Ekranı');
const today = read('./app/tabs/today.tsx');
test('Alışkanlık metrik kartı', () => today.includes('completedHabits') && today.includes('activeHabits'));
test('Görev metrik kartı', () => today.includes('todayTasks') || today.includes('dueToday'));
test('İrade bandı', () => today.includes('WillpowerBand') && today.includes('İrade'));
test('Bugünün alışkanlıkları listesi', () => today.includes('RİTÜELLER · BUGÜN') && today.includes('activeHabits'));
test('Bekleyen görevler listesi', () => today.includes('pendingTasks') || today.includes('YAKLAŞAN'));
test('Quick grid KALDIRILDI', () => !today.includes('QUICK_ITEMS'));
test('/tabs/timeline yönlendirmesi', () => today.includes('/tabs/timeline'));

// 6. İstatistikler
console.log('\n📊 6. İstatistikler');
const stats = read('./app/tabs/stats.tsx');
test('Supabase habit_logs sorgusu', () => stats.includes('habit_logs'));
test('Heatmap render', () => stats.includes('heatmap') || stats.includes('heatData') || stats.includes('Heatmap'));
test('Aylık özet bölümü', () => stats.includes('month') || stats.includes('Ay'));
test('Legacy API YOK', () => !stats.includes('completionAPI') && !stats.includes('statsAPI'));

// 7. Timeline (Alışkanlıklar)
console.log('\n✅ 7. Timeline / Alışkanlıklar');
const tl = read('./app/tabs/timeline.tsx');
test('Haftalık takvim', () => tl.includes('weekCal') || tl.includes('renderWeekCalendar'));
// Bu assertion eskiden `tl.includes('numeric')` idi -- yani "numeric kelimesi
// dosyada geçiyor mu". Ölçülebilirlik kararı paylaşılan `isMeasurableTracking`
// seam'ine taşınınca literal kayboldu ve assertion kırmızıya döndü; oysa kod
// DAHA doğru hale gelmişti (artık 'duration' da ölçülebilir sayılıyor). Sığ
// eşleşmeyi gevşetmek yerine gerçek kararı sabitliyoruz: dokunma olayı
// ölçülebilir alışkanlığı modala, diğerini evet/hayır akışına yönlendirmeli.
// Bu iddia ikinci kez, aynı sebeple kırıldı: ternary bir ifade-olarak-deyim
// olduğu için lint (`no-unused-expressions`) haklı olarak uyardı, if/else'e
// çevrildi ve literal yine kayboldu. Karar değişmedi, yazımı değişti. Bu yüzden
// artık BİÇİMİ değil KARARI sabitliyoruz: ölçülebilir olan modala, olmayan
// evet/hayır akışına gitmeli -- her iki yazım da kabul.
const tlFlat = tl.replace(/\s+/g, ' ');
const routesByMeasurability =
  /isMeasurableTracking\(habit\.tracking_type\) \? setMeasureHabit\(habit\) : handleYesNoTap\(habit\)/.test(tlFlat)
  || (/if \(isMeasurableTracking\(habit\.tracking_type\)\) setMeasureHabit\(habit\);/.test(tlFlat)
      && /else handleYesNoTap\(habit\);/.test(tlFlat));
test('Ölçülebilir alışkanlık + MeasurableInputModal', () =>
  routesByMeasurability && tl.includes('MeasurableInputModal'));
test('XP gösterimi', () => tl.includes('xp'));
test('Willpower bandı', () => tl.includes('wp') && tl.includes('daily_budget'));
test('Aktif alışkanlık boş durumu', () => tl.includes('Aktif alışkanlık yok') && tl.includes('EmptyState'));

// 8. Okuma Listesi
console.log('\n📚 8. Okuma Listesi');
const rl = read('./app/screens/reading-list.tsx');
test('3 status tab', () => rl.includes('want_to_read') && rl.includes('reading') && rl.includes('completed'));
test('5 tür (book/article/video/podcast/other)', () => ['book','article','video','podcast','other'].every(t => rl.includes(t)));
test('StarRating bileşeni', () => rl.includes('StarRating'));
test('Alert silme onayı', () => rl.includes('Alert') && rl.includes('Sil'));
test('FAB ekle butonu', () => rl.includes('fab'));
const rls = read('./store/readingListStore.ts');
test('readingListStore metodları', () => ['fetchItems','addItem','updateStatus','updateRating','removeItem'].every(m => rls.includes(m)));
// Bu assertion eskiden store dosyasında `reading_list` metnini arıyordu.
// Veri erişimi repository katmanına taşınınca tablo adı store'dan çıktı ve
// assertion kırmızıya döndü -- oysa kod DAHA doğru hale gelmişti (sorgular
// artık kullanıcı kapsamlı, sayfalı ve sonucu kontrol ediliyor). Sığ metin
// eşleşmesini gevşetmek yerine gerçek sınırı sabitliyoruz: store repository
// üzerinden gider, tablo adı yalnız repository'de geçer.
const rlRepo = read('./repositories/readingListRepository.ts');
test('reading_list repository üzerinden', () =>
  rls.includes('repositories/readingListRepository')
  && !/supabase\s*\.\s*from\s*\(/.test(rls)
  && rlRepo.includes("from('reading_list')"));

// 9. Aylık Özet (gerçek aylık rapor — Haftalık Rapor modeli)
console.log('\n🗓️  9. Aylık Özet (rapor)');
const mr = read('./app/screens/monthly-review.tsx');
test('Ay navigatörü (önceki/sonraki)', () => mr.includes('setMonthOffset') && mr.includes('isCurrentMonth'));
test('Metrik özeti (görev/oran/odak/aktif)', () => mr.includes('metricsRow') && mr.includes('Tamamlandı') && mr.includes('habitCompletionRate'));
test('Bu ay tamamlananlar', () => mr.includes('BU AY TAMAMLANANLAR') && mr.includes('completedTasks'));
test('Alışkanlık performansı', () => mr.includes('ALIŞKANLIK PERFORMANSI') && mr.includes('habitStats'));
test('Aylık yansıma kaydedilir (AsyncStorage)', () => mr.includes('AYLIK YANSIMA') && mr.includes('monthly_review_') && mr.includes('AsyncStorage'));

// 10. ADHDTaskSplitter - Legacy temizlik
console.log('\n🧹 10. ADHDTaskSplitter — Legacy Temizlik');
const adhd = read('./components/ADHDTaskSplitter.tsx');
test('taskAPI kullanılmıyor', () => !adhd.includes('taskAPI'));
test('../utils/api import yok', () => !adhd.includes('../utils/api'));
test('task._id kullanılmıyor', () => !adhd.includes('task._id'));
test('Supabase insert ile görev oluşturma', () => adhd.includes('supabase') && adhd.includes('insert'));
test('taskStore Task tipi kullanılıyor', () => adhd.includes('taskStore'));

// 11. Supabase & Env
//
// Bu bölüm eskiden `read('./.env')` yapıyordu. `.env` GITIGNORE'DA: CI'ın
// temiz klonunda yok, dolayısıyla bu satır ENOENT ile TÜM betiği çökertiyordu
// -- yerelde 142/142, CI'da çalışamadan ölüyordu.
//
// Bu, bu oturumda bulunan aynı sınıftan ÜÇÜNCÜ hata: bir geçidin, yalnızca
// geliştirici makinesinde var olan bir dosyaya bağlı olması. İlk ikisi
// `.expo/types/router.d.ts` (tsconfig include ediyor, .gitignore yok sayıyor)
// ve jest'in TZ sabitlemesiydi. Üstelik teşhis zaten konmuştu:
// `jest.config.js`'in kendi yorumu "Never read .env - the old run-tests.js
// did, and a test that depends on a gitignored file is not reproducible"
// diyor. Jest için çözülmüş, run-tests.js'te bırakılmıştı.
//
// Anlamlı ve YENIDEN URETILEBILIR değişmez, `.env` dosyasının içeriği değil
// -- istemcinin doğru ortam değişkeni adlarından yapılandırılmasıdır. O bilgi
// depoda, kodda duruyor. Eksik bir `.env` ise bir kurulum sorunudur;
// uygulamanın çalışma anında yüzeye çıkardığı bir şeydir, yapısal bir geçidin
// iddia edebileceği bir şey değil.
console.log('\n🔌 11. Supabase & Env');
const sl = read('./lib/supabase.ts');
test('SUPABASE_URL ortam değişkeninden okunuyor', () => sl.includes('EXPO_PUBLIC_SUPABASE_URL'));
test('ANON_KEY ortam değişkeninden okunuyor', () => sl.includes('EXPO_PUBLIC_SUPABASE_ANON_KEY'));
test('createClient çağrısı', () => sl.includes('createClient'));

// 12. CommandPalette
console.log('\n🔍 12. Command Palette');
const cp = read('./components/CommandPalette.tsx');
test('Drawer entegrasyonu', () => cp.includes('useDrawerStore') || cp.includes('openDrawer'));
test('Hızlı navigasyon (today + focus)', () => cp.includes('/tabs/today') && cp.includes('/tabs/focus'));
test('Modal + TextInput arama', () => cp.includes('TextInput') && cp.includes('Modal'));

// 13. screens/_layout kayıtları
console.log('\n📋 13. Screens Layout Kayıtları');
const sl2 = read('./app/screens/_layout.tsx');
['calendar','recovery','monthly-review','reading-list','weekly-review','projects','notes','journal'].forEach(s =>
  test(s + ' kayıtlı', () => sl2.includes(s))
);

// 14. Odak dışa aktarma (CSV/Excel) & ayar sıfırlama
console.log('\n📤 14. Odak Dışa Aktarma & Sıfırlama');
const fr = read('./lib/focusReport.ts');
test('focusReport toExcelXML (SpreadsheetML)', () => fr.includes('export function toExcelXML') && fr.includes('mso-application'));
test('focusReport sessionsSheet', () => fr.includes('export function sessionsSheet'));
test('focusReport webDownload + EXPORT_META', () => fr.includes('export function webDownload') && fr.includes('EXPORT_META'));
const fsm = read('./components/focus/FocusSettingsModal.tsx');
test('Ayarlar export JSON+CSV+Excel', () =>
  fsm.includes('ExportRow') && fsm.includes('toCSV') && fsm.includes('toExcelXML') &&
  fsm.includes("'excel'") && fsm.includes("'csv'"));
const frm = read('./components/focus/FocusReportModal.tsx');
test('Rapor footer Excel butonu', () => frm.includes("exportData('excel')") && frm.includes('toExcelXML'));
test('Ayarları sıfırla geri bildirimi', () =>
  fsm.includes('haptic.success') && fsm.includes('varsayılana döndürüldü') && fsm.includes('DEFAULT_SETTINGS'));
// Platform-güvenli dışa aktarma: web=indir, native=Share (Alert/Share Modal üstünde açılmaz sorunu)
test('Dışa aktarma platform-güvenli (web indir)', () =>
  fsm.includes('webDownload') && fsm.includes("Platform.OS === 'web'") &&
  frm.includes('webDownload') && frm.includes("Platform.OS === 'web'"));
test('Modal-içi ConfirmRow onayı (Alert kaldırıldı)', () =>
  fsm.includes('function ConfirmRow') && !/\bAlert\.alert/.test(fsm));

// 15. Spotify (Odak)
console.log('\n🎵 15. Spotify OAuth & Oynatıcı');
test('spotifyStore var', () => exists('./store/spotifyStore.ts'));
const sps = exists('./store/spotifyStore.ts') ? read('./store/spotifyStore.ts') : '';
test('spotifyStore OAuth + oynatma metotları', () =>
  ['connect','disconnect','fetchStatus','fetchNowPlaying','play','pause','next','previous','playContext'].every(m => sps.includes(m)));
test('spotifyStore openAuthSessionAsync + spotify-auth', () =>
  sps.includes('openAuthSessionAsync') && sps.includes('spotify-auth') && sps.includes("createURL('spotify-callback')"));
test('lib/spotifyFocus çalma listeleri', () => exists('./lib/spotifyFocus.ts') && read('./lib/spotifyFocus.ts').includes('FOCUS_PLAYLISTS'));
test('FocusSpotifyCard bileşeni', () => exists('./components/focus/FocusSpotifyCard.tsx'));
test('focus.tsx Spotify kartı render', () => {
  const f = read('./app/tabs/focus.tsx');
  return f.includes('FocusSpotifyCard') && f.includes('<FocusSpotifyCard');
});
test('Odak konusu adlandırma + başlat-öncesi seçim zorunlu', () => {
  const f = read('./app/tabs/focus.tsx');
  return f.includes('ODAK KONUSU') && !f.includes('ODAK GÖREVLERİ') &&
    f.includes("phase === 'work' && !selectedTaskId") && f.includes('startHint');
});
test('Seans tamamlandı raporu (timer bitince)', () => {
  const f = read('./app/tabs/focus.tsx');
  const st = read('./store/focusStore.ts');
  return exists('./components/focus/FocusSessionCompleteModal.tsx') &&
    f.includes('FocusSessionCompleteModal') && f.includes('justCompleted') &&
    st.includes('justCompleted') && st.includes('clearJustCompleted');
});
test('Seans raporu grafikleri (gerçek veri)', () => {
  const m = read('./components/focus/FocusSessionCompleteModal.tsx');
  return m.includes('ODAK SAATLERİ') && m.includes('buckets') && m.includes('byTask') &&
    m.includes('GÖREVE GÖRE SÜRE') && m.includes('focus_sessions');
});

// 16. Seasonal Ambient Motion (takvim)
console.log('\n❄️  16. Mevsimsel Ambient Hareket');
['types','config','particles','useReducedMotion','SeasonalMotion','SeasonalMotionPreview'].forEach((f) => {
  const ext = (f === 'SeasonalMotion' || f === 'SeasonalMotionPreview') ? 'tsx' : 'ts';
  test('seasonalMotion/' + f, () => exists('./components/seasonalMotion/' + f + '.' + ext));
});
const smCfg = read('./components/seasonalMotion/config.ts');
test('config 12 ay tek source-of-truth', () =>
  ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık']
    .every((m) => smCfg.includes(m + ':')) && smCfg.includes('SEASONAL_MOTION_BY_MONTH'));
test('default yoğunluk subtle', () => smCfg.includes("DEFAULT_SEASONAL_MOTION_INTENSITY: SeasonalMotionIntensity = 'subtle'"));
const smRender = read('./components/seasonalMotion/SeasonalMotion.tsx');
test('renderer: pointerEvents none + off/reduce/görünmez null', () =>
  smRender.includes('pointerEvents="none"') && smRender.includes("reduceMotion ? 'off'") &&
  smRender.includes('if (!active) return null') && smRender.includes('useNativeDriver: true'));
const mbg = read('./components/MonthBackground.tsx');
test('MonthBackground SeasonalMotion entegrasyonu', () =>
  mbg.includes('<SeasonalMotion') && mbg.includes('useReducedMotion') && mbg.includes('active'));
const cal = read('./app/screens/calendar.tsx');
test('calendar isFocused → active', () => cal.includes('useIsFocused') && cal.includes('active={isFocused}'));
test('Ajanda kapak başlığı (hero)', () =>
  cal.includes('heroMonth') && cal.includes('MONTH_TAGLINES') && cal.includes('s.hero'));
test('Defter sayfa-çevirme animasyonu', () =>
  cal.includes('animatePage') && cal.includes('pageAnim') && cal.includes('rotateY') &&
  cal.includes('<Animated.View style={pageStyle}>') && cal.includes('reduceMotion'));
test('monthly-review: kapak + hareket + sayfa çevirme', () => {
  const mr2 = read('./app/screens/monthly-review.tsx');
  return mr2.includes('heroMonth') && mr2.includes('MONTH_TAGLINES_TR') &&
    mr2.includes('animatePage') && mr2.includes('<Animated.View style={pageStyle}>') &&
    mr2.includes('active={isFocused}');
});
test('MONTH_TAGLINES_TR tek kaynak (config)', () => smCfg.includes('MONTH_TAGLINES_TR') && cal.includes('MONTH_TAGLINES_TR'));
const setg = read('./app/tabs/settings.tsx');
test('Ayarlar: Arka plan animasyonları (Kapalı/Hafif/Normal)', () =>
  setg.includes('Arka plan animasyonları') && setg.includes('setSeasonalMotion') &&
  ['Kapalı','Hafif','Normal'].every((l) => setg.includes(l)));
const thm = read('./store/themeStore.ts');
test('themeStore seasonalMotion + persist', () =>
  thm.includes('seasonalMotion') && thm.includes('setSeasonalMotion') && thm.includes('app_seasonal_motion'));

// ── ETAP 15: Atlas HTML paritesi ───────────────────────────────
console.log('\n🗞️ 17. Editöryel Bugün (ETAP 15 · FAZ 1)');
test('lib/todayNarrative.ts buildTodayNarrative', () => {
  const tn = read('./lib/todayNarrative.ts');
  return tn.includes('export function buildTodayNarrative') &&
    tn.includes('emphasis') && tn.includes('overdueCount') && tn.includes('remainingHabits');
});
test('components/today/TodayHero.tsx', () => {
  if (!exists('./components/today/TodayHero.tsx')) return 'yok';
  const h = read('./components/today/TodayHero.tsx');
  return h.includes('narrative') && h.includes('eyebrow') && h.includes('ctas');
});
test('components/today/MetricGrid.tsx', () => {
  if (!exists('./components/today/MetricGrid.tsx')) return 'yok';
  const m = read('./components/today/MetricGrid.tsx');
  return m.includes('eyebrow') && m.includes('tabular-nums') && m.includes('export type Metric');
});
const todayTsx = read('./app/tabs/today.tsx');
test('today.tsx: hero + metrik ızgarası mount', () =>
  todayTsx.includes('<TodayHero') && todayTsx.includes('<MetricGrid') &&
  todayTsx.includes('buildTodayNarrative') && todayTsx.includes('isoWeek'));
test('components/today/NextUpStrip.tsx + Sırada mount', () => {
  if (!exists('./components/today/NextUpStrip.tsx')) return 'yok';
  const ns = read('./components/today/NextUpStrip.tsx');
  return ns.includes('SIRADA') && ns.includes('dueLabel') &&
    todayTsx.includes('<NextUpStrip') && todayTsx.includes('nextUpItems');
});
console.log('\n⚡ 18. Satır-içi görev ekleyici (FAZ 3)');
test('components/InlineComposer.tsx', () => {
  if (!exists('./components/InlineComposer.tsx')) return 'yok';
  const ic = read('./components/InlineComposer.tsx');
  return ic.includes('onSubmit') && ic.includes('onSubmitEditing') && ic.includes('TextInput');
});
test('tasks.tsx + today.tsx: InlineComposer mount', () => {
  const tk = read('./app/tabs/tasks.tsx');
  return tk.includes('<InlineComposer') && tk.includes('ListHeaderComponent') &&
    todayTsx.includes('<InlineComposer');
});
console.log('\n🔎 19. Zengin Komut Paleti (FAZ 4)');
test('CommandPalette: görev/not/proje arama + son kullanılanlar', () => {
  const cp = read('./components/CommandPalette.tsx');
  return cp.includes('useTaskStore') && cp.includes('useNoteStore') && cp.includes('useProjectStore') &&
    cp.includes('filteredTasks') && cp.includes('filteredNotes') && cp.includes('filteredProjects') &&
    cp.includes('app_cmd_recents') && cp.includes('Son kullanılanlar') && cp.includes('recordRecent');
});
console.log('\n🌙 20. Telafi rail + editöryel boş durum (FAZ 5)');
test('components/today/RecoveryRailCard.tsx + mount', () => {
  if (!exists('./components/today/RecoveryRailCard.tsx')) return 'yok';
  const rc = read('./components/today/RecoveryRailCard.tsx');
  return rc.includes('Telafi · son 7 gün') && rc.includes("status === 'planned'") &&
    todayTsx.includes('<RecoveryRailCard');
});
test('EmptyState editorial varyantı + today kullanımı', () => {
  const es = read('./components/ui/EmptyState.tsx');
  return es.includes("variant === 'editorial'") && es.includes('fontStyle') &&
    todayTsx.includes('variant="editorial"');
});
console.log('\n🎨 21. Aksan renk temaları (FAZ 6)');
test('tokens ACCENTS + useAccent hook', () => {
  const tk = read('./lib/tokens.ts');
  return tk.includes('export const ACCENTS') && ['clay','moss','slate','amber'].every((k) => tk.includes(k)) &&
    exists('./lib/useAccent.ts') && read('./lib/useAccent.ts').includes('useThemeStore');
});
test('themeStore accent + persist', () => {
  const t = read('./store/themeStore.ts');
  return t.includes('accent') && t.includes('setAccent') && t.includes('app_accent');
});
test('useAccent: Button + tab bar + TodayHero', () => {
  const btn = read('./components/ui/Button.tsx');
  const lay = read('./app/tabs/_layout.tsx');
  const hero = read('./components/today/TodayHero.tsx');
  return btn.includes('useAccent') && btn.includes('accentTheme.primary') &&
    lay.includes('useAccent') && lay.includes('accent.bright') &&
    hero.includes('useAccent');
});
test('settings: Aksan rengi seçici', () => {
  const sg = read('./app/tabs/settings.tsx');
  return sg.includes('Aksan rengi') && sg.includes('setAccent') && sg.includes('accentDot');
});
console.log('\n📁 22. Proje detay görünümü (FAZ 7)');
test('projects.tsx: detay modal + ilerleme + görev listesi', () => {
  const pj = read('./app/screens/projects.tsx');
  return pj.includes('detailId') && pj.includes('detailProject') && pj.includes('detailPct') &&
    pj.includes('progressFill') && pj.includes('<InlineComposer') && pj.includes('project_id: detailProject.id');
});

// ── SONUÇ
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
results.forEach(r => console.log(r));
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const total = passed + failed;
const pct = Math.round(passed / total * 100);
console.log('  Sonuç: ' + passed + '/' + total + ' (' + pct + '%)' + (failed === 0 ? ' 🎉 TÜMÜ GEÇTI' : ' — ' + failed + ' başarısız'));
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
process.exit(failed > 0 ? 1 : 0);
