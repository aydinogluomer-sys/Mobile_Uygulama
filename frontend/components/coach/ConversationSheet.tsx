/**
 * The conversation list: switch threads, start one, rename one, file one.
 *
 * A sheet rather than a new route, because opening history should not push a
 * screen the user then has to back out of — and because the thing they most
 * often want from it is to go straight back to the thread they were in.
 *
 * Nothing here talks to Supabase. It renders what the store holds and calls
 * back; the store owns loading, ordering and ownership.
 */
import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, TextInput, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { alphaHex, hexA, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import type { ConversationRow } from '../../repositories/aiConversationRepository';

export type ProjectOption = { id: string; name: string };

type Props = {
  visible: boolean;
  conversations: ConversationRow[];
  activeId: string | null;
  projects: ProjectOption[];
  loading?: boolean;
  hasMore?: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => Promise<boolean> | boolean;
  onAssignProject: (id: string, projectId: string | null) => void;
  onLoadMore?: () => void;
};

/** Short relative time. Three cases cover everything a chat list needs. */
function whenLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'az önce';
  if (mins < 60) return `${mins} dk`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days} g` : new Date(then).toLocaleDateString('tr-TR');
}

export default function ConversationSheet({
  visible, conversations, activeId, projects, loading, hasMore,
  onClose, onOpen, onNewChat, onRename, onAssignProject, onLoadMore,
}: Props) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const projectName = (id: string | null) =>
    id ? projects.find((p) => p.id === id)?.name ?? null : null;

  async function commitRename(id: string) {
    const next = draftTitle.trim();
    if (!next) { setRenameError('Başlık boş olamaz.'); return; }
    const ok = await onRename(id, next);
    if (!ok) { setRenameError('Yeniden adlandırılamadı.'); return; }
    setRenamingId(null);
    setRenameError(null);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.headerTitle}>Sohbetler</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={20} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={s.newBtn}
            onPress={() => { onNewChat(); onClose(); }}
            accessibilityRole="button"
            accessibilityLabel="Yeni sohbet başlat"
          >
            <Ionicons name="add" size={18} color={colors.primary} />
            <Text style={s.newText}>Yeni Sohbet</Text>
          </TouchableOpacity>

          <ScrollView contentContainerStyle={s.list}>
            {conversations.length === 0 && !loading && (
              <Text style={s.empty}>Henüz sohbet yok. İlk mesajın yeni bir sohbet başlatır.</Text>
            )}

            {conversations.map((c) => {
              const pname = projectName(c.project_id);
              const isRenaming = renamingId === c.id;
              return (
                <View key={c.id} style={[s.row, c.id === activeId && s.rowActive]}>
                  {isRenaming ? (
                    <View style={s.renameWrap}>
                      <TextInput
                        style={s.renameInput}
                        value={draftTitle}
                        onChangeText={(t) => { setDraftTitle(t); setRenameError(null); }}
                        autoFocus
                        maxLength={200}
                        accessibilityLabel="Yeni sohbet başlığı"
                        onSubmitEditing={() => commitRename(c.id)}
                      />
                      {!!renameError && <Text style={s.renameError}>{renameError}</Text>}
                      <View style={s.renameRow}>
                        <TouchableOpacity onPress={() => commitRename(c.id)} accessibilityRole="button" accessibilityLabel="Başlığı kaydet">
                          <Text style={s.renameSave}>Kaydet</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { setRenamingId(null); setRenameError(null); }} accessibilityRole="button" accessibilityLabel="Yeniden adlandırmayı iptal et">
                          <Text style={s.renameCancel}>Vazgeç</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={s.rowMain}
                        onPress={() => { onOpen(c.id); onClose(); }}
                        accessibilityRole="button"
                        accessibilityLabel={`${c.title} sohbetini aç`}
                        accessibilityState={{ selected: c.id === activeId }}
                      >
                        <Text style={s.rowTitle} numberOfLines={1}>{c.title}</Text>
                        <View style={s.rowMeta}>
                          {pname && (
                            <View style={s.badge}><Text style={s.badgeText} numberOfLines={1}>{pname}</Text></View>
                          )}
                          <Text style={s.rowWhen}>{whenLabel(c.last_message_at)}</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setMenuFor(menuFor === c.id ? null : c.id)}
                        hitSlop={10}
                        style={s.moreBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`${c.title} sohbet seçenekleri`}
                      >
                        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textGhost} />
                      </TouchableOpacity>
                    </>
                  )}

                  {menuFor === c.id && !isRenaming && (
                    <View style={s.menu}>
                      <TouchableOpacity
                        style={s.menuItem}
                        onPress={() => { setRenamingId(c.id); setDraftTitle(c.title); setMenuFor(null); }}
                        accessibilityRole="button"
                        accessibilityLabel="Yeniden adlandır"
                      >
                        <Ionicons name="create-outline" size={15} color={colors.textDim} />
                        <Text style={s.menuText}>Yeniden Adlandır</Text>
                      </TouchableOpacity>

                      <Text style={s.menuLabel}>Projeye Ata</Text>
                      <View style={s.chips}>
                        {projects.map((p) => (
                          <TouchableOpacity
                            key={p.id}
                            style={[s.chip, c.project_id === p.id && s.chipOn]}
                            onPress={() => { onAssignProject(c.id, p.id); setMenuFor(null); }}
                            accessibilityRole="button"
                            accessibilityLabel={`${p.name} projesine ata`}
                          >
                            <Text style={[s.chipText, c.project_id === p.id && s.chipTextOn]} numberOfLines={1}>{p.name}</Text>
                          </TouchableOpacity>
                        ))}
                        {projects.length === 0 && <Text style={s.empty}>Önce bir proje oluştur.</Text>}
                      </View>
                      {c.project_id && (
                        <TouchableOpacity
                          style={s.menuItem}
                          onPress={() => { onAssignProject(c.id, null); setMenuFor(null); }}
                          accessibilityRole="button"
                          accessibilityLabel="Projeden çıkar"
                        >
                          <Ionicons name="remove-circle-outline" size={15} color={colors.textDim} />
                          <Text style={s.menuText}>Projeden Çıkar</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })}

            {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />}
            {hasMore && !loading && (
              <TouchableOpacity onPress={onLoadMore} style={s.more} accessibilityRole="button" accessibilityLabel="Daha fazla sohbet yükle">
                <Text style={s.moreText}>Daha fazla</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    // Same scrim the AI Coach screen's own modal uses (`0.6` black), so
    // opening the thread list does not dim the app to a different depth than
    // every other sheet on this screen.
    overlay: { flex: 1, backgroundColor: hexA(colors.black, 0.6), justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingTop: 14, paddingHorizontal: 16, paddingBottom: 24, maxHeight: '82%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    marginBottom: 12, minHeight: 44,
  },
  newText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  list: { gap: 6, paddingBottom: 12 },
  empty: { color: colors.textFaint, fontSize: 13, paddingVertical: 8 },
  row: {
    borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  rowActive: { borderColor: colors.primary },
  rowMain: { minHeight: 40, justifyContent: 'center', paddingRight: 28 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  rowWhen: { fontSize: 11, color: colors.textFaint },
  badge: {
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
    backgroundColor: alphaHex(colors.primary, '22'), maxWidth: 140,
  },
  badgeText: { fontSize: 11, color: colors.primary, fontWeight: '700' },
  moreBtn: { position: 'absolute', right: 8, top: 10, padding: 6 },
  menu: { marginTop: 10, gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  menuText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
  menuLabel: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderRadius: 999, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 10, paddingVertical: 6, maxWidth: 160,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: alphaHex(colors.primary, '18') },
  chipText: { fontSize: 12, color: colors.textDim },
  chipTextOn: { color: colors.primary, fontWeight: '700' },
  renameWrap: { gap: 8 },
  renameInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, color: colors.text, fontSize: 14,
  },
  renameError: { color: colors.error, fontSize: 12 },
  renameRow: { flexDirection: 'row', gap: 16 },
  renameSave: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  renameCancel: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  more: { alignItems: 'center', paddingVertical: 10 },
  moreText: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
});
