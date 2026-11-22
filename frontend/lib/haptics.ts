import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

export const HAPTICS_KEY = 'app_haptics';
export const HAPTIC_DEBOUNCE_MS = 150;

let enabled = true;
let writeVersion = 0;
let lastLightAt = -Infinity;
let lastSelectAt = -Infinity;
const listeners = new Set<() => void>();

function isNativePlatform(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function emit(): void {
  listeners.forEach((l) => l());
}

export function getHapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(v: boolean): void {
  const next = Boolean(v);
  writeVersion += 1;
  const changed = enabled !== next;
  enabled = next;
  AsyncStorage.setItem(HAPTICS_KEY, next ? '1' : '0').catch(() => {});
  if (changed) emit();
}

export function subscribeHapticsEnabled(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useHapticsEnabled(): boolean {
  return useSyncExternalStore(subscribeHapticsEnabled, getHapticsEnabled, () => true);
}

export async function loadHapticsPreference(): Promise<void> {
  const verAtStart = writeVersion;
  try {
    const stored = await AsyncStorage.getItem(HAPTICS_KEY);
    if (verAtStart !== writeVersion) return;
    const next = stored === '0' ? false : true;
    if (enabled !== next) {
      enabled = next;
      emit();
    }
  } catch {
    // Varsayılan açık kalır
  }
}

export function resetHapticsForTests(): void {
  enabled = true;
  writeVersion += 1;
  lastLightAt = -Infinity;
  lastSelectAt = -Infinity;
  listeners.clear();
}

function canFire(): boolean {
  return enabled && isNativePlatform();
}

export const haptic = {
  light(): void {
    if (!canFire()) return;
    const now = Date.now();
    if (now >= lastLightAt && now - lastLightAt < HAPTIC_DEBOUNCE_MS) return;
    lastLightAt = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  medium(): void {
    if (!canFire()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  success(): void {
    if (!canFire()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  warning(): void {
    if (!canFire()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  error(): void {
    if (!canFire()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
  select(): void {
    if (!canFire()) return;
    const now = Date.now();
    if (now >= lastSelectAt && now - lastSelectAt < HAPTIC_DEBOUNCE_MS) return;
    lastSelectAt = now;
    Haptics.selectionAsync().catch(() => {});
  },
};

void loadHapticsPreference();
