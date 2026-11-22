import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

export type FlowKeyboardArgs = {
  enabled: boolean;
  onNext: () => void;
  onPrev: () => void;
};

export function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || typeof t !== 'object') return false;
  if (typeof HTMLElement !== 'undefined' && t instanceof HTMLElement) {
    if (t.isContentEditable) return true;
    if (t.contentEditable === 'true' || t.contentEditable === 'plaintext-only') return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  }
  const candidate = t as {
    tagName?: unknown;
    isContentEditable?: unknown;
    contentEditable?: unknown;
  };
  if (candidate.isContentEditable === true) return true;
  if (candidate.contentEditable === 'true' || candidate.contentEditable === 'plaintext-only') {
    return true;
  }
  if (typeof candidate.tagName === 'string') {
    return /^(INPUT|TEXTAREA|SELECT)$/i.test(candidate.tagName);
  }
  return false;
}

export function useFlowKeyboard({ enabled, onNext, onPrev }: FlowKeyboardArgs): void {
  const callbacksRef = useRef({ onNext, onPrev });

  useEffect(() => {
    callbacksRef.current = { onNext, onPrev };
  }, [onNext, onPrev]);

  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof window === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        isEditableTarget(e.target)
      ) {
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        callbacksRef.current.onNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        callbacksRef.current.onPrev();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
