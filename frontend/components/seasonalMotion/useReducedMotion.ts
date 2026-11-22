// Sistem "hareketi azalt" (reduce motion) erişilebilirlik ayarını paylaşılan tek abonelikle izler (contract §6, DSA-11, PRF-21).
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

function isTestEnv(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
}

const IS_TEST = isTestEnv();

// null = henüz bilinmiyor -> hareketsiz say (DSA-11: ilk karelerde istenmeyen hareket olmasın)
let current: boolean | null = IS_TEST ? true : null;
const listeners = new Set<() => void>();
let subs: NativeEventSubscription[] = [];

function set(v: boolean): void {
  const next = Boolean(v);
  if (current === next) return;
  current = next;
  listeners.forEach((l) => l());
}

function refresh(): void {
  AccessibilityInfo.isReduceMotionEnabled()
    .then((v) => {
      set(Boolean(v));
    })
    .catch(() => {});
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && !isTestEnv()) {
    refresh();
    const motionSub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      set(Boolean(v));
    });
    const appSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') refresh();
    });
    subs = [motionSub, appSub].filter(
      (s): s is NativeEventSubscription => Boolean(s && typeof s.remove === 'function'),
    );
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && subs.length > 0) {
      const activeSubs = subs;
      subs = [];
      activeSubs.forEach((s) => s.remove());
    }
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => current ?? true, () => true);
}

export function resetReducedMotionForTests(): void {
  const activeSubs = subs;
  subs = [];
  activeSubs.forEach((s) => s.remove());
  listeners.clear();
  current = isTestEnv() ? true : null;
}

if (!IS_TEST) {
  refresh();
}
