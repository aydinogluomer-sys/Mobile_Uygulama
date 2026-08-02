import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Web'de no-op; native'de hafif dokunsal geri bildirim.
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

export const haptic = {
  light() { if (isNative) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  medium() { if (isNative) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); },
  success() { if (isNative) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  warning() { if (isNative) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); },
  error() { if (isNative) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); },
  select() { if (isNative) Haptics.selectionAsync().catch(() => {}); },
};
