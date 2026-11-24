import React from 'react';
import { Platform } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { shortcutAction, useWebShortcuts } from '../../hooks/useWebShortcuts';
import { useCommandStore } from '../../store/commandStore';
import { useDrawerStore } from '../../store/drawerStore';

type KeyInput = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'
>;

function key(overrides: Partial<KeyInput> & { key: string }): KeyInput {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides,
  };
}

function Harness({ enabled }: { enabled: boolean }) {
  useWebShortcuts(enabled);
  return null;
}

describe('F28 (NAV-12) — webShortcuts', () => {
  const originalPlatform = Platform.OS;
  const originalDocument = (globalThis as Record<string, unknown>).document;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatform, configurable: true });
    (globalThis as Record<string, unknown>).document = originalDocument;
    useCommandStore.setState({ visible: false, pendingIntent: null });
    useDrawerStore.setState({ isOpen: false });
  });

  describe('shortcutAction pure table', () => {
    it('(+) maps Cmd+k, Ctrl+k, and uppercase Cmd+K to toggle-palette, and Escape to escape', () => {
      expect(shortcutAction(key({ key: 'k', metaKey: true }))).toBe('toggle-palette');
      expect(shortcutAction(key({ key: 'k', ctrlKey: true }))).toBe('toggle-palette');
      expect(shortcutAction(key({ key: 'K', metaKey: true }))).toBe('toggle-palette');
      expect(shortcutAction(key({ key: 'Escape' }))).toBe('escape');
    });

    it('(-) ignores Shift/Alt chords, plain typing, unrelated keys, and IME composition', () => {
      expect(shortcutAction(key({ key: 'k', metaKey: true, shiftKey: true }))).toBeNull();
      expect(shortcutAction(key({ key: 'k', ctrlKey: true, altKey: true }))).toBeNull();
      expect(shortcutAction(key({ key: 'k', altKey: true }))).toBeNull();
      expect(shortcutAction(key({ key: 'k' }))).toBeNull();
      expect(shortcutAction(key({ key: 'j', metaKey: true }))).toBeNull();
      expect(shortcutAction(key({ key: 'k', ctrlKey: true, isComposing: true }))).toBeNull();
      expect(shortcutAction(key({ key: 'Escape', isComposing: true }))).toBeNull();
    });
  });

  describe('useWebShortcuts hook lifecycle & precedence', () => {
    it('(+) attaches keydown on web, toggles CommandPalette, closes palette before Drawer on Escape, and cleans up on unmount', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
      const listeners = new Map<string, (ev: unknown) => void>();
      const addEventListener = jest.fn((type: string, fn: (ev: unknown) => void) => {
        listeners.set(type, fn);
      });
      const removeEventListener = jest.fn((type: string) => {
        listeners.delete(type);
      });
      (globalThis as Record<string, unknown>).document = { addEventListener, removeEventListener };

      let tree!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        tree = TestRenderer.create(React.createElement(Harness, { enabled: true }));
      });
      expect(addEventListener).toHaveBeenCalledTimes(1);
      const handler = listeners.get('keydown');
      expect(handler).toBeDefined();

      // Ctrl+K opens palette and prevents browser default
      const prevent1 = jest.fn();
      await act(async () => {
        handler?.({ ...key({ key: 'k', ctrlKey: true }), preventDefault: prevent1 });
      });
      expect(useCommandStore.getState().visible).toBe(true);
      expect(prevent1).toHaveBeenCalledTimes(1);

      // Open Drawer too: Escape must close Palette FIRST, leaving Drawer open
      useDrawerStore.getState().open();
      const prevent2 = jest.fn();
      await act(async () => {
        handler?.({ ...key({ key: 'Escape' }), preventDefault: prevent2 });
      });
      expect(useCommandStore.getState().visible).toBe(false);
      expect(useDrawerStore.getState().isOpen).toBe(true);
      expect(prevent2).toHaveBeenCalledTimes(1);

      // Next Escape closes Drawer
      const prevent3 = jest.fn();
      await act(async () => {
        handler?.({ ...key({ key: 'Escape' }), preventDefault: prevent3 });
      });
      expect(useDrawerStore.getState().isOpen).toBe(false);
      expect(prevent3).toHaveBeenCalledTimes(1);

      // Escape when neither is open does NOT call preventDefault
      const prevent4 = jest.fn();
      await act(async () => {
        handler?.({ ...key({ key: 'Escape' }), preventDefault: prevent4 });
      });
      expect(prevent4).not.toHaveBeenCalled();

      await act(async () => {
        tree.unmount();
      });
      expect(removeEventListener).toHaveBeenCalledTimes(1);
    });

    it('(-) does not attach listeners on native platforms or when enabled=false', async () => {
      const addEventListener = jest.fn();
      const removeEventListener = jest.fn();
      (globalThis as Record<string, unknown>).document = { addEventListener, removeEventListener };

      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      let nativeTree!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        nativeTree = TestRenderer.create(React.createElement(Harness, { enabled: true }));
      });
      expect(addEventListener).not.toHaveBeenCalled();
      await act(async () => {
        nativeTree.unmount();
      });

      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
      let disabledTree!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        disabledTree = TestRenderer.create(React.createElement(Harness, { enabled: false }));
      });
      expect(addEventListener).not.toHaveBeenCalled();
      await act(async () => {
        disabledTree.unmount();
      });
    });
  });
});
