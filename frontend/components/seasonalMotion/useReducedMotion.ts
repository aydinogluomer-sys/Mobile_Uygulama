// Sistem "hareketi azalt" (reduce motion) erişilebilirlik ayarını izler (contract §6).
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(IS_TEST);

  useEffect(() => {
    if (IS_TEST) return;
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (mounted) setReduced(!!v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(!!v));
    return () => { mounted = false; sub?.remove?.(); };
  }, []);

  return reduced;
}
