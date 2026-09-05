/* Aderyth Sync — Obsidian Plugin */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AtlasPosPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  vaultFolder: "Aderyth",
  dateFormat: "YYYY-MM-DD",
  supabaseUrl: "",
  supabaseKey: "",
  autoSyncEnabled: false,
  autoSyncIntervalMin: 60,
  appendToExisting: true
};
var BLOCK_MARKER_PREFIX = "## \u{1F5D3}\uFE0F Aderyth";
var LEGACY_BLOCK_MARKER_PREFIX = "## \u{1F5D3}\uFE0F Atlas";
function buildAtlasBlock(payload) {
  var _a;
  const lines = [];
  lines.push(`${BLOCK_MARKER_PREFIX} \u2014 ${payload.date}`);
  lines.push("");
  if (payload.willpower) {
    const { used, daily_budget } = payload.willpower;
    const pct = Math.round(used / daily_budget * 100);
    lines.push(`> \u26A1 \u0130rade: ${used}/${daily_budget} (${pct}%)`);
    lines.push("");
  }
  if (payload.focus_sessions != null && payload.focus_sessions > 0) {
    lines.push(`> \u{1F3AF} Odak seans\u0131: ${payload.focus_sessions}`);
    lines.push("");
  }
  if (payload.habits.length > 0) {
    lines.push("### \u2705 Al\u0131\u015Fkanl\u0131klar");
    lines.push("");
    for (const h of payload.habits) {
      const icon = h.state === "done" ? "\u2705" : h.state === "partial" ? "\u{1F536}" : "\u274C";
      let detail = "";
      if (h.value != null && h.target_value != null) {
        detail = ` \u2014 ${h.value}/${h.target_value} ${(_a = h.unit) != null ? _a : ""}`.trimEnd();
      }
      const xp = h.xp ? ` +${h.xp}XP` : "";
      lines.push(`- ${icon} **${h.habit_name}**${detail}${xp}`);
    }
    lines.push("");
    const done = payload.habits.filter((h) => h.state === "done").length;
    const total = payload.habits.length;
    lines.push(`**Toplam:** ${done}/${total} tamamland\u0131`);
    lines.push("");
  }
  if (payload.tasks.length > 0) {
    lines.push("### \u{1F4CB} G\xF6revler");
    lines.push("");
    for (const t of payload.tasks) {
      const check = t.completed ? "x" : " ";
      const pri = t.priority === "high" ? " \u{1F534}" : t.priority === "medium" ? " \u{1F7E1}" : "";
      lines.push(`- [${check}] ${t.title}${pri}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(`*Aderyth taraf\u0131ndan senkronland\u0131 \u2014 ${(/* @__PURE__ */ new Date()).toLocaleTimeString("tr-TR")}*`);
  lines.push("");
  return lines.join("\n");
}
async function fetchAtlasData(supabaseUrl, supabaseKey, date) {
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };
  const logsRes = await (0, import_obsidian.requestUrl)({
    url: `${supabaseUrl}/rest/v1/habit_logs?date=eq.${date}&select=habit_id,state,value,target_value,xp`,
    headers
  });
  const rawLogs = logsRes.status === 200 ? logsRes.json : [];
  const habitRes = await (0, import_obsidian.requestUrl)({
    url: `${supabaseUrl}/rest/v1/habits?status=eq.active&select=id,name,unit`,
    headers
  });
  const habits = habitRes.status === 200 ? habitRes.json : [];
  const habitMap = Object.fromEntries(habits.map((h) => [h.id, h]));
  const habitLogs = rawLogs.map((l) => {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
      habit_id: l.habit_id,
      habit_name: (_b = (_a = habitMap[l.habit_id]) == null ? void 0 : _a.name) != null ? _b : l.habit_id,
      state: l.state,
      value: (_c = l.value) != null ? _c : void 0,
      target_value: (_d = l.target_value) != null ? _d : void 0,
      unit: (_f = (_e = habitMap[l.habit_id]) == null ? void 0 : _e.unit) != null ? _f : void 0,
      xp: (_g = l.xp) != null ? _g : void 0,
      date
    };
  });
  const taskRes = await (0, import_obsidian.requestUrl)({
    url: `${supabaseUrl}/rest/v1/tasks?or=(due_date.eq.${date},due_date.lt.${date})&select=id,title,completed,priority,due_date&order=priority`,
    headers
  });
  const tasks = taskRes.status === 200 ? taskRes.json : [];
  const wpRes = await (0, import_obsidian.requestUrl)({
    url: `${supabaseUrl}/rest/v1/willpower_states?date=eq.${date}&select=used,daily_budget&limit=1`,
    headers
  });
  const wpData = wpRes.status === 200 ? wpRes.json : [];
  const willpower = wpData[0];
  const fsRes = await (0, import_obsidian.requestUrl)({
    url: `${supabaseUrl}/rest/v1/focus_sessions?started_at=gte.${date}T00:00:00&select=id`,
    headers
  });
  const focusSessions = fsRes.status === 200 ? fsRes.json : [];
  return {
    date,
    habits: habitLogs,
    tasks,
    willpower,
    focus_sessions: focusSessions.length
  };
}
var AtlasPosPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.autoSyncTimer = null;
  }
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("sync", "Aderyth: Bug\xFCn\xFC Senkronla", async () => {
      await this.syncToday();
    });
    this.addCommand({
      id: "atlas-sync-today",
      name: "Bug\xFCn\xFC senkronla",
      callback: async () => {
        await this.syncToday();
      }
    });
    this.addCommand({
      id: "atlas-sync-yesterday",
      name: "D\xFCn\xFC senkronla",
      callback: async () => {
        const d = /* @__PURE__ */ new Date();
        d.setDate(d.getDate() - 1);
        await this.syncDate(d.toISOString().split("T")[0]);
      }
    });
    this.addCommand({
      id: "atlas-open-today",
      name: "Bug\xFCn\xFCn Aderyth notunu a\xE7",
      callback: async () => {
        const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const path = this.notePath(date);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof import_obsidian.TFile) {
          await this.app.workspace.getLeaf().openFile(file);
        } else {
          new import_obsidian.Notice("Bug\xFCn i\xE7in hen\xFCz Aderyth notu yok. \xD6nce senkronla.");
        }
      }
    });
    this.addSettingTab(new AtlasSettingTab(this.app, this));
    if (this.settings.autoSyncEnabled) {
      this.scheduleAutoSync();
    }
    new import_obsidian.Notice("Aderyth Sync y\xFCklendi \u2705");
  }
  onunload() {
    if (this.autoSyncTimer !== null) {
      window.clearInterval(this.autoSyncTimer);
    }
  }
  // ── Senkron ────────────────────────────────────────────────────────────────
  async syncToday() {
    const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    await this.syncDate(date);
  }
  async syncDate(date) {
    if (!this.settings.supabaseUrl || !this.settings.supabaseKey) {
      new import_obsidian.Notice("\u26A0\uFE0F Aderyth: Supabase URL ve Key ayarlara girilmeli.");
      return;
    }
    new import_obsidian.Notice(`Aderyth: ${date} senkronlan\u0131yor\u2026`);
    try {
      const payload = await fetchAtlasData(
        this.settings.supabaseUrl,
        this.settings.supabaseKey,
        date
      );
      await this.writeNote(payload);
      new import_obsidian.Notice(`\u2705 Aderyth: ${date} senkronland\u0131 \u2014 ${payload.habits.length} al\u0131\u015Fkanl\u0131k, ${payload.tasks.length} g\xF6rev`);
    } catch (e) {
      console.error("[Aderyth Plugin]", e);
      new import_obsidian.Notice("\u274C Aderyth senkron hatas\u0131: " + e.message);
    }
  }
  // ── Not yazma ──────────────────────────────────────────────────────────────
  notePath(date) {
    const folder = this.settings.vaultFolder.replace(/\/$/, "");
    return (0, import_obsidian.normalizePath)(`${folder}/${date}.md`);
  }
  async writeNote(payload) {
    const path = this.notePath(payload.date);
    const block = buildAtlasBlock(payload);
    const folder = this.settings.vaultFolder.replace(/\/$/, "");
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian.TFile) {
      if (this.settings.appendToExisting) {
        const content = await this.app.vault.read(existing);
        const current = `${BLOCK_MARKER_PREFIX} \u2014 ${payload.date}`;
        const legacy = `${LEGACY_BLOCK_MARKER_PREFIX} \u2014 ${payload.date}`;
        const marker = content.includes(current) ? current : legacy;
        if (content.includes(marker)) {
          const before = content.slice(0, content.indexOf(marker));
          const afterIdx = content.indexOf("\n## ", content.indexOf(marker) + 1);
          const after = afterIdx >= 0 ? content.slice(afterIdx) : "";
          await this.app.vault.modify(existing, before + block + after);
        } else {
          await this.app.vault.modify(existing, content + "\n\n" + block);
        }
      } else {
        await this.app.vault.modify(existing, block);
      }
    } else {
      const frontmatter = `---
date: ${payload.date}
tags: [atlas, daily]
---

`;
      await this.app.vault.create(path, frontmatter + block);
    }
  }
  // ── Otomatik senkron ───────────────────────────────────────────────────────
  scheduleAutoSync() {
    if (this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
    const ms = this.settings.autoSyncIntervalMin * 60 * 1e3;
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
};
var AtlasSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Aderyth Sync Ayarlar\u0131" });
    new import_obsidian.Setting(containerEl).setName("Vault klas\xF6r\xFC").setDesc("Aderyth notlar\u0131n\u0131n yaz\u0131laca\u011F\u0131 klas\xF6r (vault i\xE7inde)").addText(
      (t) => t.setPlaceholder("Aderyth").setValue(this.plugin.settings.vaultFolder).onChange(async (v) => {
        this.plugin.settings.vaultFolder = v || "Aderyth";
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Supabase Ba\u011Flant\u0131s\u0131" });
    new import_obsidian.Setting(containerEl).setName("Supabase URL").setDesc("Aderyth projenizin Supabase URL'si (EXPO_PUBLIC_SUPABASE_URL)").addText(
      (t) => t.setPlaceholder("https://xxxx.supabase.co").setValue(this.plugin.settings.supabaseUrl).onChange(async (v) => {
        this.plugin.settings.supabaseUrl = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Supabase Anon Key").setDesc("Aderyth anon public key'i").addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("eyJhbGciOiJIUzI1NiIs\u2026").setValue(this.plugin.settings.supabaseKey).onChange(async (v) => {
        this.plugin.settings.supabaseKey = v.trim();
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Ba\u011Flant\u0131y\u0131 test et").setDesc("Supabase'e eri\u015Filebildi\u011Fini kontrol eder").addButton(
      (b) => b.setButtonText("Test Et").onClick(async () => {
        if (!this.plugin.settings.supabaseUrl || !this.plugin.settings.supabaseKey) {
          new import_obsidian.Notice("URL ve Key girilmeli.");
          return;
        }
        try {
          const r = await (0, import_obsidian.requestUrl)({
            url: `${this.plugin.settings.supabaseUrl}/rest/v1/habits?limit=1&select=id`,
            headers: {
              apikey: this.plugin.settings.supabaseKey,
              Authorization: `Bearer ${this.plugin.settings.supabaseKey}`
            }
          });
          new import_obsidian.Notice(r.status === 200 ? "\u2705 Ba\u011Flant\u0131 ba\u015Far\u0131l\u0131!" : `\u274C HTTP ${r.status}`);
        } catch (e) {
          new import_obsidian.Notice("\u274C Ba\u011Flanamad\u0131: " + e.message);
        }
      })
    );
    containerEl.createEl("h3", { text: "Senkronizasyon" });
    new import_obsidian.Setting(containerEl).setName("Mevcut notlara ekle").setDesc("A\xE7\u0131k: Aderyth blo\u011Funu g\xFCnceller. Kapal\u0131: dosyay\u0131 tamamen yeniden yazar.").addToggle(
      (t) => t.setValue(this.plugin.settings.appendToExisting).onChange(async (v) => {
        this.plugin.settings.appendToExisting = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Otomatik senkronizasyon").setDesc("Arka planda periyodik olarak Aderyth verisini \xE7eker").addToggle(
      (t) => t.setValue(this.plugin.settings.autoSyncEnabled).onChange(async (v) => {
        this.plugin.settings.autoSyncEnabled = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Senkron aral\u0131\u011F\u0131 (dakika)").setDesc("Otomatik senkronizasyon ne s\u0131kl\u0131kla \xE7al\u0131\u015Fs\u0131n").addSlider(
      (s) => s.setLimits(15, 240, 15).setValue(this.plugin.settings.autoSyncIntervalMin).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.autoSyncIntervalMin = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u015Eimdi senkronla").setDesc("Bug\xFCn\xFCn Aderyth verisini hemen Obsidian'a yazar").addButton(
      (b) => b.setButtonText("Bug\xFCn\xFC Senkronla").setCta().onClick(async () => {
        await this.plugin.syncToday();
      })
    );
  }
};
