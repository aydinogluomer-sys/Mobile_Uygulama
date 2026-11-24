import { useEffect, useSyncExternalStore, type ReactElement } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { registerAccountScoped } from '../../lib/accountScope';
import {
  dismissAllDialogs,
  getCurrentDialog,
  registerDialogHost,
  settleDialog,
  subscribeDialogs,
  type DialogRequest,
} from '../../lib/dialog';
import { font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';
import ActionSheet from './ActionSheet';
import Button from './Button';

registerAccountScoped({ name: 'dialogs', onReset: () => dismissAllDialogs() });

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    centerWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: space.lg,
    },
    scrim: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: hexA(c.black, 0.55),
    },
    card: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: c.bgElevated,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.xl,
      gap: space.md,
    },
    title: {
      ...font.h2,
      color: c.text,
    },
    message: {
      ...font.body,
      color: c.textDim,
      lineHeight: 22,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      gap: space.sm,
      marginTop: space.xs,
    },
  });

function DialogCard({
  req,
  reduce,
  maxBodyHeight,
}: {
  req: Extract<DialogRequest, { kind: 'confirm' | 'notify' }>;
  reduce: boolean;
  maxBodyHeight: number;
}): ReactElement {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);

  const cancel = () => {
    if (req.kind === 'confirm') settleDialog(req, false);
    else settleDialog(req);
  };

  useEffect(() => {
    const win = (globalThis as { window?: { addEventListener?: (t: string, fn: (e: { key?: string; preventDefault?: () => void }) => void) => void; removeEventListener?: (t: string, fn: (e: { key?: string; preventDefault?: () => void }) => void) => void } }).window;
    if (Platform.OS !== 'web' || typeof win?.addEventListener !== 'function') return;
    const onKeyDown = (e: { key?: string; preventDefault?: () => void }) => {
      if (e.key === 'Escape') {
        e.preventDefault?.();
        if (req.kind === 'confirm') settleDialog(req, false);
        else settleDialog(req);
      }
    };
    win.addEventListener('keydown', onKeyDown);
    return () => {
      win.removeEventListener?.('keydown', onKeyDown);
    };
  }, [req]);

  return (
    <Modal
      key={req.id}
      transparent
      visible
      statusBarTranslucent
      animationType={reduce ? 'none' : 'fade'}
      onRequestClose={cancel}
    >
      <View style={s.centerWrap}>
        <Pressable
          style={s.scrim}
          focusable={false}
          accessible={false}
          onPress={cancel}
        />
        <View
          style={s.card}
          role="alertdialog"
          accessibilityLabel={req.title}
          accessibilityViewIsModal
        >
          <Text style={s.title} accessibilityRole="header">
            {req.title}
          </Text>
          {req.message ? (
            <ScrollView style={{ maxHeight: maxBodyHeight }} bounces={false}>
              <Text style={s.message} selectable>
                {req.message}
              </Text>
            </ScrollView>
          ) : null}
          <View style={s.actions}>
            {req.kind === 'confirm' ? (
              <>
                <Button
                  label={req.cancelText}
                  variant="ghost"
                  color={c.textDim}
                  onPress={() => settleDialog(req, false)}
                />
                <Button
                  label={req.confirmText}
                  variant={req.destructive ? 'danger' : 'primary'}
                  onPress={() => settleDialog(req, true)}
                />
              </>
            ) : (
              <Button
                label={req.okText}
                variant="primary"
                onPress={() => settleDialog(req)}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Mount ONCE, in app/_layout.tsx. Renders nothing while no request is pending (no always-mounted Modal). */
export default function DialogHost(): ReactElement | null {
  const req = useSyncExternalStore(subscribeDialogs, getCurrentDialog, getCurrentDialog);
  useEffect(() => registerDialogHost(), []);
  const reduce = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();

  if (!req) return null;

  if (req.kind === 'sheet') {
    return (
      <ActionSheet
        key={req.id}
        visible
        title={req.title}
        message={req.message}
        items={req.options}
        cancelLabel={req.cancelText}
        reduceMotion={reduce}
        onSelect={(id) => settleDialog(req, id)}
        onCancel={() => settleDialog(req, null)}
      />
    );
  }

  const maxBodyHeight = Math.max(160, Math.round((windowHeight || 640) * 0.5));
  return <DialogCard key={req.id} req={req} reduce={reduce} maxBodyHeight={maxBodyHeight} />;
}
