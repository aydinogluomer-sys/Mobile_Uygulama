import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useIsFocused } from 'expo-router';

function isTestEnv(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
}

function isForegroundState(state: AppStateStatus | string | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

let currentAppActive: boolean = isForegroundState(AppState.currentState);
const appListeners = new Set<() => void>();
let appSub: { remove: () => void } | null = null;

function subscribeAppActive(listener: () => void): () => void {
  appListeners.add(listener);
  if (appListeners.size === 1) {
    currentAppActive = isForegroundState(AppState.currentState);
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const active = isForegroundState(next);
      if (currentAppActive !== active) {
        currentAppActive = active;
        appListeners.forEach((l) => l());
      }
    });
    appSub = sub && typeof sub.remove === 'function' ? sub : null;
  }
  return () => {
    appListeners.delete(listener);
    if (appListeners.size === 0 && appSub) {
      const activeSub = appSub;
      appSub = null;
      activeSub.remove();
    }
  };
}

export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppActive, () => currentAppActive, () => true);
}

export function resolveScreenActive(isFocused: boolean, appActive: boolean): boolean {
  return Boolean(isFocused && appActive);
}

export function useScreenActiveLive(): boolean {
  const isFocused = useIsFocused();
  const appActive = useAppActive();
  return resolveScreenActive(isFocused, appActive);
}

const IS_TEST = isTestEnv();

/** NODE_ENV === 'test' iken () => true (navigasyon bağlamı olmadan render edilen testler çökmesin). */
export const useScreenActive: () => boolean = IS_TEST ? () => true : useScreenActiveLive;

export function resetAppActiveForTests(): void {
  if (appSub) {
    const activeSub = appSub;
    appSub = null;
    activeSub.remove();
  }
  appListeners.clear();
  currentAppActive = isForegroundState(AppState.currentState);
}
