import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import FocusFlowView from '../../components/FocusFlowView';
import {
  FOCUS_FLOW_CATEGORIES,
  type FocusFlowCategoryKey,
} from '../../lib/focusFlowCatalog';

export default function FocusFlowScreen() {
  const params = useLocalSearchParams<{ item?: string; cat?: string }>();

  const validCategory: FocusFlowCategoryKey =
    params.cat && FOCUS_FLOW_CATEGORIES.some((c) => c.key === params.cat)
      ? (params.cat as FocusFlowCategoryKey)
      : 'for_you';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <FocusFlowView
        initialItemId={typeof params.item === 'string' ? params.item : null}
        initialCategory={validCategory}
        showBackButton
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#09090d',
  },
});

