import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  requestUrl,
} from 'obsidian';

// ── Tipler ────────────────────────────────────────────────────────────────────

interface AtlasHabitLog {
  habit_id: string;
  habit_name: string;
  state: 'done' | 'partial' | 'miss';
  value?: number;
  target_value?: number;
  unit?: string;
  xp?: number;
  date: string; // YYYY-MM-DD
}

interface AtlasTask {
  id: string;
  title: string;
  completed: boolean;
  priority: 'high' | 'medium' | 'low' | 'none';
  due_date?: string;
}

interface AtlasSyncPayload {
  date: string;
  habits: AtlasHabitLog[];
  tasks: AtlasTask[];
  willpower?: { used: number; daily_budget: number };
  focus_sessions?: number;
}

interface AtlasPluginSettings {
  vaultFolder: string;       // Günlük notların yazılacağı klasör
  dateFormat: string;        // Not dosyası isim formatı
  supabaseUrl: string;       // Atlas Supabase project URL
  supabaseKey: string;       // Atlas anon key
  autoSyncEnabled: boolean;
  autoSyncIntervalMin: number;
  appendToExisting: boolean; // Mevcut nota ekle veya üzerine yaz
}

const DEFAULT_SETTINGS: AtlasPluginSettings = {
  vaultFolder: 'Atlas',
  dateFormat: 'YYYY-MM-DD',
  supabaseUrl: '',
  supabaseKey: '',
  autoSyncEnabled: false,
  autoSyncIntervalMin: 60,
  appendToExisting: true,
};

// ── Yardımcı: Markdown blok üret ─────────────────────────────────────────────

function buildAtlasBlock(payload: AtlasSyncPayload): string {
  const lines: string[] = [];

  lines.push(`## 🗓️ Atlas — ${payload.date}`);
  lines.push('');

  // Willpower
  if (payload.willpower) {
    const { used, daily_budget } = payload.willpower;
    const pct = Math.round((used / daily_budget) * 100);
    lines.push(`> ⚡ İrade: ${used}/${daily_budget} (${pct}%)`);
    lines.push('');
  }

  // Odak seansları
  if (payload.focus_sessions != null && payload.focus_sessions > 0) {
    lines.push(`> 🎯 Odak seansı: ${payload.focus_sessions}`);
    lines.push('');
  }

  // Alışkanlıklar
  if (payload.habits.length > 0) {
    lines.push('### ✅ Alışkanlıklar');
    lines.push('');
    for (const h of payload.habits) {
      const icon = h.state === 'done' ? '✅' : h.state === 'partial' ? '🔶' : '❌';
      let detail = '';
      if (h.value != null && h.target_value != null) {
        detail = ` — ${h.value}/${h.target_value} ${h.unit ?? ''}`.trimEnd();
      }
      const xp = h.xp ? ` +${h.xp}XP` : '';
      lines.push(`- ${icon} **${h.habit_name}**${detail}${xp}`);
    }
    lines.push('');

    const done = payload.habits.filter(h => h.state === 'done').length;
    const total = payload.habits.length;
    lines.push(`**Toplam:** ${done}/${total} tamamlandı`);
    lines.push('');
  }

  // Görevler
  if (payload.tasks.length > 0) {
    lines.push('### 📋 Görevler');
    lines.push('');
    for (const t of payload.tasks) {
      const check = t.completed ? 'x' : ' ';
      const pri = t.priority === 'high' ? ' 🔴' : t.priority === 'medium' ? ' 🟡' : '';
      lines.push(`- [${check}] ${t.title}${pri}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Atlas POS v2 tarafından senkronlandı — ${new Date().toLocaleTimeString('tr-TR')}*`);
  lines.push('');

  return lines.join('\n');
}

// ── Supabase'den veri çek ─────────────────────────────────────────────────────

async function fetchAtlasData(
  supabaseUrl: string,
  supabaseKey: string,
  date: string
): Promise<AtlasSyncPayload> {
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  };

  // Habit logları
  const logsRes = await requestUrl({
    url: `${supabaseUrl}/rest/v1/habit_logs?date=eq.${date}&select=habit_id,state,value,target_value,xp`,
    headers,
  });
  const rawLogs: {habit_id:string;state:string;value:number|null;target_value:number|null;xp:number|null}[] =
    logsRes.status === 200 ? logsRes.json : [];

  // Alışkanlık isimleri
  const habitRes = await requestUrl({
    url: `${supabaseUrl}/rest/v1/habits?status=eq.active&select=id,name,unit`,
    headers,
  });
  const habits: {id:string;name:string;unit:string|null}[] =
    habitRes.status === 200 ? habitRes.json : [];

  const habitMap = Object.fromEntries(habits.map(h => [h.id, h]));

  const habitLogs: AtlasHabitLog[] = rawLogs.map(l => ({
    habit_id: l.habit_id,
    habit_name: habitMap[l.habit_id]?.name ?? l.habit_id,
    state: l.state as AtlasHabitLog['state'],
    value: l.value ?? undefined,
    target_value: l.target_value ?? undefined,
    unit: habitMap[l.habit_id]?.unit ?? undefined,
    xp: l.xp ?? undefined,
    date,
  }));

  // Görevler (bugün + geciken)
  const taskRes = await requestUrl({
    url: `${supabaseUrl}/rest/v1/tasks?or=(due_date.eq.${date},due_date.lt.${date})&select=id,title,completed,priority,due_date&order=priority`,
    headers,
  });
  const tasks: AtlasTask[] = taskRes.status === 200 ? taskRes.json : [];

  // Willpower
  const wpRes = await requestUrl({
    url: `${supabaseUrl}/rest/v1/willpower_states?date=eq.${date}&select=used,daily_budget&limit=1`,
    headers,
  });
  const wpData: {used:number;daily_budget:number}[] =
    wpRes.status === 200 ? wpRes.json : [];
  const willpower = wpData[0];

  // Focus seansları
  const fsRes = await requestUrl({
    url: `${supabaseUrl}/rest/v1/focus_sessions?started_at=gte.${date}T00:00:00&select=id`,
    headers,
  });
  const focusSessions: {id:string}[] = fsRes.status === 200 ? fsRes.json : [];

  return {
    date,
    habits: habitLogs,
    tasks,
    willpower,
    focus_sessions: focusSessions.length,
  };
}

// ── Plugin ana sınıfı ─────────────────────────────────────────────────────────

export default class AtlasPosPlugin extends Plugin {
  settings!: AtlasPluginSettings;
  private autoSyncTimer: number | null = null;

  async onload() {
    await this.loadSettings();

    // Ribbon ikonu
    this.addRibbonIcon('sync', 'Atlas: Bugünü Senkronla', async () => {
      await this.syncToday();
    });

    // Komutlar
    this.addCommand({
      id: 'atlas-sync-today',
      name: 'Bugünü senkronla',
      callback: async () => { await this.syncToday(); },
    });

    this.addCommand({
      id: 'atlas-sync-yesterday',
      name: 'Dünü senkronla',
      callback: async () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        await this.syncDate(d.toISOString().split('T')[0]);
      },
    });

    this.addCommand({
      id: 'atlas-open-today',
      name: "Bugünün Atlas notunu aç",
      callback: async () => {
        const date = new Date().toISOString().split('T')[0];
        const path = this.notePath(date);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await this.app.workspace.getLeaf().openFile(file);
        } else {
          new Notice('Bugün için henüz Atlas notu yok. Önce senkronla.');
        }
      },
    });

    // Ayarlar paneli
    this.addSettingTab(new AtlasSettingTab(this.app, this));

    // Otomatik senkron
    if (this.settings.autoSyncEnabled) {
      this.scheduleAutoSync();
    }

    new Notice('Atlas POS Sync yüklendi ✅');
  }

  onunload() {
    if (this.autoSyncTimer !== null) {
      window.clearInterval(this.autoSyncTimer);
    }
  }

  // ── Senkron ────────────────────────────────────────────────────────────────

  async syncToday() {
    const date = new Date().toISOString().split('T')[0];
    await this.syncDate(date);
  }

  async syncDate(date: string) {
    if (!this.settings.supabaseUrl || !this.settings.supabaseKey) {
      new Notice('⚠️ Atlas: Supabase URL ve Key ayarlara girilmeli.');
      return;
    }

    new Notice(`Atlas: ${date} senkronlanıyor…`);

    try {
      const payload = await fetchAtlasData(
        this.settings.supabaseUrl,
        this.settings.supabaseKey,
        date
      );

      await this.writeNote(payload);
      new Notice(`✅ Atlas: ${date} senkronlandı — ${payload.habits.length} alışkanlık, ${payload.tasks.length} görev`);
    } catch (e) {
      console.error('[Atlas Plugin]', e);
      new Notice('❌ Atlas senkron hatası: ' + (e as Error).message);
    }
  }

  // ── Not yazma ──────────────────────────────────────────────────────────────

  notePath(date: string): string {
    const folder = this.settings.vaultFolder.replace(/\/$/, '');
    return normalizePath(`${folder}/${date}.md`);
  }

  async writeNote(payload: AtlasSyncPayload) {
    const path = this.notePath(payload.date);
    const block = buildAtlasBlock(payload);

    // Klasör yoksa oluştur
    const folder = this.settings.vaultFolder.replace(/\/$/, '');
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }

    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      if (this.settings.appendToExisting) {
        // Eski Atlas bloğunu değiştir, yoksa sona ekle
        const content = await this.app.vault.read(existing);
        const marker = `## 🗓️ Atlas — ${payload.date}`;
        if (content.includes(marker)) {
          // Eski bloğu bul ve değiştir
          const before = content.slice(0, content.indexOf(marker));
          // Sonraki başlık veya dosya sonu
          const afterIdx = content.indexOf('\n## ', content.indexOf(marker) + 1);
          const after = afterIdx >= 0 ? content.slice(afterIdx) : '';
          await this.app.vault.modify(existing, before + block + after);
        } else {
          await this.app.vault.modify(existing, content + '\n\n' + block);
        }
      } else {
        await this.app.vault.modify(existing, block);
      }
    } else {
      // Ön madde (frontmatter) + blok
      const frontmatter = `---\ndate: ${payload.date}\ntags: [atlas, daily]\n---\n\n`;
      await this.app.vault.create(path, frontmatter + block);
    }
  }

  // ── Otomatik senkron ───────────────────────────────────────────────────────

  scheduleAutoSync() {
    if (this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
    const ms = this.settings.autoSyncIntervalMin * 60 * 1000;
    this.autoSyncTimer = window.setInterval(() => this.syncToday(), ms);
  }

  // ── Ayarlar ────────────────────────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    if (this.settings.autoSyncEnabled) {
      this.scheduleAutoSync();
    } else if (this.autoSyncTimer !== null) {
      window.clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }
}

// ── Ayarlar paneli ────────────────────────────────────────────────────────────

class AtlasSettingTab extends PluginSettingTab {
  plugin: AtlasPosPlugin;

  constructor(app: App, plugin: AtlasPosPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Atlas POS Sync Ayarları' });

    // Vault klasörü
    new Setting(containerEl)
      .setName('Vault klasörü')
      .setDesc('Atlas notlarının yazılacağı klasör (vault içinde)')
      .addText(t =>
        t.setPlaceholder('Atlas')
          .setValue(this.plugin.settings.vaultFolder)
          .onChange(async v => {
            this.plugin.settings.vaultFolder = v || 'Atlas';
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h3', { text: 'Supabase Bağlantısı' });

    // Supabase URL
    new Setting(containerEl)
      .setName('Supabase URL')
      .setDesc('Atlas projenizin Supabase URL\'si (EXPO_PUBLIC_SUPABASE_URL)')
      .addText(t =>
        t.setPlaceholder('https://xxxx.supabase.co')
          .setValue(this.plugin.settings.supabaseUrl)
          .onChange(async v => {
            this.plugin.settings.supabaseUrl = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // Supabase Anon Key
    new Setting(containerEl)
      .setName('Supabase Anon Key')
      .setDesc('Atlas anon public key\'i')
      .addText(t => {
        t.inputEl.type = 'password';
        t.setPlaceholder('eyJhbGciOiJIUzI1NiIs…')
          .setValue(this.plugin.settings.supabaseKey)
          .onChange(async v => {
            this.plugin.settings.supabaseKey = v.trim();
            await this.plugin.saveSettings();
          });
      });

    // Bağlantı testi
    new Setting(containerEl)
      .setName('Bağlantıyı test et')
      .setDesc('Supabase\'e erişilebildiğini kontrol eder')
      .addButton(b =>
        b.setButtonText('Test Et').onClick(async () => {
          if (!this.plugin.settings.supabaseUrl || !this.plugin.settings.supabaseKey) {
            new Notice('URL ve Key girilmeli.');
            return;
          }
          try {
            const r = await requestUrl({
              url: `${this.plugin.settings.supabaseUrl}/rest/v1/habits?limit=1&select=id`,
              headers: {
                apikey: this.plugin.settings.supabaseKey,
                Authorization: `Bearer ${this.plugin.settings.supabaseKey}`,
              },
            });
            new Notice(r.status === 200 ? '✅ Bağlantı başarılı!' : `❌ HTTP ${r.status}`);
          } catch (e) {
            new Notice('❌ Bağlanamadı: ' + (e as Error).message);
          }
        })
      );

    containerEl.createEl('h3', { text: 'Senkronizasyon' });

    // Mevcut notlara ekle
    new Setting(containerEl)
      .setName('Mevcut notlara ekle')
      .setDesc('Açık: Atlas bloğunu günceller. Kapalı: dosyayı tamamen yeniden yazar.')
      .addToggle(t =>
        t.setValue(this.plugin.settings.appendToExisting)
          .onChange(async v => {
            this.plugin.settings.appendToExisting = v;
            await this.plugin.saveSettings();
          })
      );

    // Otomatik senkron
    new Setting(containerEl)
      .setName('Otomatik senkronizasyon')
      .setDesc('Arka planda periyodik olarak Atlas verisini çeker')
      .addToggle(t =>
        t.setValue(this.plugin.settings.autoSyncEnabled)
          .onChange(async v => {
            this.plugin.settings.autoSyncEnabled = v;
            await this.plugin.saveSettings();
          })
      );

    // Senkron aralığı
    new Setting(containerEl)
      .setName('Senkron aralığı (dakika)')
      .setDesc('Otomatik senkronizasyon ne sıklıkla çalışsın')
      .addSlider(s =>
        s.setLimits(15, 240, 15)
          .setValue(this.plugin.settings.autoSyncIntervalMin)
          .setDynamicTooltip()
          .onChange(async v => {
            this.plugin.settings.autoSyncIntervalMin = v;
            await this.plugin.saveSettings();
          })
      );

    // Manuel senkron butonu
    new Setting(containerEl)
      .setName('Şimdi senkronla')
      .setDesc('Bugünün Atlas verisini hemen Obsidian\'a yazar')
      .addButton(b =>
        b.setButtonText('Bugünü Senkronla')
          .setCta()
          .onClick(async () => { await this.plugin.syncToday(); })
      );
  }
}
