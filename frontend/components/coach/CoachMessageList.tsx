import { Fragment, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CoachMessage } from '../../hooks/useCoachSend';
import { alphaHex, colors } from '../../lib/tokens';

export type { CoachMessage } from '../../hooks/useCoachSend';

export type CoachMessageListProps = {
  messages: CoachMessage[];
  hasOlder: boolean;
  onLoadOlder: () => void;
  copiedId: string | null;
  speakingId: string | null;
  onCopy: (m: CoachMessage) => void;
  onSpeak: (m: CoachMessage) => void;
  loading: boolean;
  streamingReply: string;
  /** Confirmation cards: rendered after messages and BEFORE the streaming bubble. */
  children?: ReactNode;
};

export default function CoachMessageList(props: CoachMessageListProps) {
  const {
    messages,
    hasOlder,
    onLoadOlder,
    copiedId,
    speakingId,
    onCopy,
    onSpeak,
    loading,
    streamingReply,
    children,
  } = props;

  return (
    <>
      {hasOlder && (
        <TouchableOpacity
          onPress={onLoadOlder}
          style={s.olderBtn}
          accessibilityRole="button"
          accessibilityLabel="Daha eski mesajları yükle"
        >
          <Text style={s.olderText}>Daha eski mesajlar</Text>
        </TouchableOpacity>
      )}
      {messages.map((m) => (
        /* The copy/speak controls are SIBLINGS of the bubble, never
           children of it. Putting them inside would mean touching the
           bubble's flex direction again, and that is the exact geometry
           that stretched a three-word message to the height of the
           conversation in Step 11A.1. This leaves those styles untouched. */
        <Fragment key={m.id}>
          <View
            style={[
              s.bubble,
              m.role === 'user' ? s.bubbleUser : s.bubbleAssistant,
              m.role === 'error' && s.bubbleError,
            ]}
            accessibilityRole={m.role === 'error' ? 'alert' : undefined}
          >
            {m.role === 'assistant' && (
              <View style={s.assistantIcon}>
                <Ionicons name="sparkles" size={12} color="#8b5cf6" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              </View>
            )}
            <Text
              style={[
                s.bubbleText,
                // `flex: 1` belongs ONLY to the bubbles that lay out as a row.
                // Assistant and error bubbles put the sparkles icon beside the
                // text, so the text has to claim the rest of that row. The user
                // bubble has no icon and stays a column.
                m.role !== 'user' && s.bubbleTextRow,
                m.role === 'user' && s.bubbleTextUser,
                m.role === 'error' && s.bubbleTextError,
              ]}
            >
              {m.content}
            </Text>
          </View>

          <View style={[s.msgActions, m.role === 'user' ? s.msgActionsRight : s.msgActionsLeft]}>
            <TouchableOpacity
              onPress={() => onCopy(m)}
              hitSlop={10}
              style={s.msgActionBtn}
              accessibilityRole="button"
              accessibilityLabel="Mesajı kopyala"
            >
              <Ionicons
                name={copiedId === m.id ? 'checkmark' : 'copy-outline'}
                size={13}
                color={copiedId === m.id ? colors.success : colors.textGhost}
              />
              {copiedId === m.id && <Text style={s.msgActionText}>Kopyalandı</Text>}
            </TouchableOpacity>

            {m.role === 'assistant' && (
              <TouchableOpacity
                onPress={() => onSpeak(m)}
                hitSlop={10}
                style={s.msgActionBtn}
                accessibilityRole="button"
                accessibilityLabel={speakingId === m.id ? 'Sesli okumayı durdur' : 'Yanıtı sesli oku'}
                accessibilityState={{ selected: speakingId === m.id }}
              >
                <Ionicons
                  name={speakingId === m.id ? 'stop-circle-outline' : 'volume-medium-outline'}
                  size={14}
                  color={speakingId === m.id ? colors.primary : colors.textGhost}
                />
              </TouchableOpacity>
            )}
          </View>
        </Fragment>
      ))}

      {children}

      {loading && (
        <View style={[s.bubble, s.bubbleAssistant]} accessibilityRole="progressbar" accessibilityLabel="Koç yanıt yazıyor">
          {streamingReply ? (
            <>
              <View style={s.assistantIcon}>
                <Ionicons name="sparkles" size={12} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              </View>
              <Text style={[s.bubbleText, s.bubbleTextRow]}>{streamingReply}</Text>
            </>
          ) : (
            <ActivityIndicator size="small" color={colors.primary} />
          )}
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  olderBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  olderText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },

  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bubbleError: {
    alignSelf: 'flex-start',
    backgroundColor: alphaHex(colors.error, '15'),
    borderColor: alphaHex(colors.error, '30'),
  },
  assistantIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#8b5cf620',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bubbleText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  bubbleTextRow: { flex: 1 },
  bubbleTextUser: { color: colors.white },
  bubbleTextError: { color: colors.error },

  msgActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: -4 },
  msgActionsLeft: { alignSelf: 'flex-start', paddingLeft: 4 },
  msgActionsRight: { alignSelf: 'flex-end', paddingRight: 4 },
  msgActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
    minWidth: 44,
    minHeight: 44,
  },
  msgActionText: { fontSize: 11, color: colors.success, fontWeight: '600' },
});
