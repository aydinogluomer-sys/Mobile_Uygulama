import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useCommandStore } from '../store/commandStore';
import { useDrawerStore } from '../store/drawerStore';

export type ShortcutAction = 'toggle-palette' | 'escape' | null;

export function shortcutAction(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>,
): ShortcutAction {
  if (e.isComposing) return null;
  const key = typeof e.key === 'string' ? e.key : '';
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && key.toLowerCase() === 'k') {
    return 'toggle-palette';
  }
  if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && key === 'Escape') {
    return 'escape';
  }
  return null;
}

export function useWebShortcuts(enabled: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof document === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => {
      const action = shortcutAction(e);
      if (action === 'toggle-palette') {
        e.preventDefault();
        const cmd = useCommandStore.getState();
        if (cmd.visible) cmd.close();
        else cmd.open();
        return;
      }
      if (action === 'escape') {
        const cmd = useCommandStore.getState();
        if (cmd.visible) {
          e.preventDefault();
          cmd.close();
          return;
        }
        const drawer = useDrawerStore.getState();
        if (drawer.isOpen) {
          e.preventDefault();
          drawer.close();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}
