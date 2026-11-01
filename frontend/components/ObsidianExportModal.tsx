import { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { colors, alphaHex, radius, space, font } from '../lib/tokens';
import { useHabitStore } from '../store/habitStore';
import { useTaskStore } from '../store/taskStore';
import { useJournalStore } from '../store/journalStore';
import { useNoteStore } from '../store/noteStore';
import { todayLocal } from '../lib/date';
import { haptic } from '../lib/haptics';
import { EmbeddedFiligree } from './ui';
import { DECOR } from '../lib/visualAssets';

interface ObsidianExportModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function ObsidianExportModal({ visible, onClose }: ObsidianExportModalProps) {
  const { habits } = useHabitStore();
  const { tasks } = useTaskStore();
  const { entries } = useJournalStore();
  const { notes } = useNoteStore();

  const [exportType, setExportType] = useState<'daily' | 'all_habits' | 'notes_vault'>('daily');
  const [copied, setCopied] = useState(false);

  const markdownContent = useMemo(() => {
    const today = todayLocal();

    if (exportType === 'daily') {
      const todayJournal = entries.find((e) => e.date === today);
      const pendingTasks = tasks.filter((t) => !t.completed);
      const doneTasks = tasks.filter((t) => t.completed && t.completed_at?.startsWith(today));

      let md = `---
type: aderyth-daily
date: ${today}
tags:
  - aderyth
  - daily-note
  - habits
---

# 📅 Aderyth Günlük Özeti — ${today}

## ⚡ Alışkanlıklar
`;
      habits.forEach((h) => {
        const isDone = (h as any).completedToday ?? false;
        const streakCount = h.streak_current ?? h.current_streak ?? 0;
        md += `- [${isDone ? 'x' : ' '}] **${h.name}** ${streakCount > 0 ? `🔥 ${streakCount} gün` : ''}\n`;
      });

      md += `\n## 🎯 Görevler\n`;
      if (pendingTasks.length === 0 && doneTasks.length === 0) {
        md += `*Bugün için kayıtlı görev yok.*\n`;
      } else {
        doneTasks.forEach((t) => {
          md += `- [x] ${t.title}\n`;
        });
        pendingTasks.forEach((t) => {
          md += `- [ ] ${t.title}${t.due_date ? ` ⏳ (Son: ${t.due_date})` : ''}\n`;
        });
      }

      if (todayJournal) {
        md += `\n## ✍️ Günlük Yansıması\n`;
        if (todayJournal.mood) md += `*Ruh Hali:* ${todayJournal.mood}/5\n\n`;
        md += `${todayJournal.content}\n`;
      }

      return md;
    }

    if (exportType === 'all_habits') {
      let md = `---
type: aderyth-habits-catalog
updated_at: ${new Date().toISOString()}
tags:
  - aderyth
  - habits-vault
---

# 🏆 Alışkanlık Sistemi & Ritüeller

| Alışkanlık | Kategori | Durum | Seri |
|---|---|---|---|
`;
      habits.forEach((h) => {
        md += `| ${h.name} | ${h.life_area || 'Genel'} | ${h.status || 'active'} | ${h.streak_current ?? h.current_streak ?? 0} gün |\n`;
      });
      return md;
    }

    // notes_vault
    let md = `---
type: aderyth-notes-export
date: ${today}
tags:
  - aderyth
  - personal-knowledge
---

# 📚 Aderyth Bilgi Kütüphanesi & Notlar

`;
    notes.forEach((n) => {
      md += `## 📝 ${n.title || 'İsimsiz Not'}\n`;
      md += `*Oluşturulma: ${n.created_at ? n.created_at.slice(0, 10) : today}*\n\n`;
      md += `${n.content}\n\n---\n\n`;
    });

    return md;
  }, [exportType, habits, tasks, entries, notes]);

  async function handleCopy() {
    haptic.success();
    await Clipboard.setStringAsync(markdownContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    Alert.alert('✅ Panoya Kopyalandı', "Markdown formatındaki içerik panoya kopyalandı. Obsidian kasanızdaki bir nota doğrudan yapıştırabilirsiniz.");
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <EmbeddedFiligree source={DECOR.obsidianPrism} anchor="top-right" opacity={0.18} size={138} />
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <View style={s.iconBox}>
                <Ionicons name="document-text" size={22} color={colors.accent} />
              </View>
              <View>
                <Text style={s.title}>Obsidian Markdown Aktarımı</Text>
                <Text style={s.sub}>Obsidian Vault ile uyumlu Markdown çıktısı</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          {/* Dışa Aktarma Tipi Seçimi */}
          <View style={s.tabRow}>
            {[
              { key: 'daily', label: 'Bugünün Notu' },
              { key: 'all_habits', label: 'Alışkanlıklar' },
              { key: 'notes_vault', label: 'Tüm Notlar' },
            ].map((tab) => {
              const active = exportType === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[s.tabBtn, active && s.tabBtnActive]}
                  onPress={() => {
                    haptic.select();
                    setExportType(tab.key as any);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={tab.label}
                >
                  <Text style={[s.tabText, active && s.tabTextActive]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Önizleme Alanı */}
          <View style={s.previewHeader}>
            <Text style={s.previewLabel}>MARKDOWN ÖNİZLEME</Text>
            <Text style={s.charCount}>{markdownContent.length} karakter</Text>
          </View>
          <View style={s.previewWrap}>
            <EmbeddedFiligree source={DECOR.obsidianPrism} anchor="bottom-right" opacity={0.12} size={110} />
            <ScrollView style={s.previewBox} contentContainerStyle={{ padding: space.sm }}>
              <Text style={s.codeText}>{markdownContent}</Text>
            </ScrollView>
          </View>

          {/* Alt Aksiyon Butonu */}
          <TouchableOpacity
            style={[s.copyBtn, copied && s.copyBtnDone]}
            onPress={handleCopy}
            accessibilityRole="button"
            accessibilityLabel="Obsidian Markdown formatında panoya kopyala"
          >
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.white} />
            <Text style={s.copyBtnText}>
              {copied ? 'Kopyalandı!' : 'Obsidian Markdown Kopyala'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
    maxHeight: '88%',
    overflow: 'hidden',
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alphaHex(colors.accent, '20'),
  },
  title: {
    ...font.title,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  sub: {
    ...font.caption,
    color: colors.textDim,
    marginTop: 1,
  },
  closeBtn: {
    padding: 6,
  },

  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  tabBtnActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabText: {
    fontSize: 12,
    color: colors.textFaint,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.text,
    fontWeight: '700',
  },

  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textGhost,
    letterSpacing: 1,
  },
  charCount: {
    fontSize: 10,
    color: colors.textFaint,
  },
  previewWrap: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  previewBox: {
    maxHeight: 240,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: colors.textDim,
    lineHeight: 16,
  },

  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: space.md,
    marginTop: 4,
  },
  copyBtnDone: {
    backgroundColor: colors.success,
  },
  copyBtnText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
});
