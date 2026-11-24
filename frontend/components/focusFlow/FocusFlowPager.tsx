import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import {
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type { FocusFeedEntry } from '../../lib/focusFlowCatalog';

export type FocusFlowPagerHandle = {
  scrollToIndex: (index: number, animated?: boolean) => void;
};

export type FocusFlowPagerProps = {
  entries: readonly FocusFeedEntry[];
  activeIndex: number;
  pageHeight: number;
  windowRadius?: number;
  onActiveIndexChange: (index: number) => void;
  renderEntry: (
    entry: FocusFeedEntry,
    index: number,
    isActive: boolean,
  ) => React.ReactNode;
};

export function isInWindow(
  index: number,
  activeIndex: number,
  radius: number,
): boolean {
  return Math.abs(index - activeIndex) <= Math.max(0, radius);
}

export const FocusFlowPager = forwardRef<FocusFlowPagerHandle, FocusFlowPagerProps>(
  function FocusFlowPager(
    {
      entries,
      activeIndex,
      pageHeight,
      windowRadius = 1,
      onActiveIndexChange,
      renderEntry,
    },
    ref,
  ) {
    const scrollRef = useRef<ScrollView | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex: (index: number, animated = true) => {
          const clamped = Math.max(0, Math.min(entries.length - 1, index));
          scrollRef.current?.scrollTo({
            y: clamped * pageHeight,
            animated,
          });
        },
      }),
      [entries.length, pageHeight],
    );

    const handleScrollEnd = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (pageHeight <= 0 || entries.length === 0) return;
        const offsetY = e.nativeEvent.contentOffset.y;
        const idx = Math.max(
          0,
          Math.min(entries.length - 1, Math.round(offsetY / pageHeight)),
        );
        if (idx !== activeIndex) {
          onActiveIndexChange(idx);
        }
      },
      [pageHeight, entries.length, activeIndex, onActiveIndexChange],
    );

    return (
      <ScrollView
        ref={scrollRef}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={pageHeight}
        snapToAlignment="start"
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        scrollEventThrottle={16}
      >
        {entries.map((entry, idx) =>
          isInWindow(idx, activeIndex, windowRadius) ? (
            <React.Fragment key={entry.key}>
              {renderEntry(entry, idx, idx === activeIndex)}
            </React.Fragment>
          ) : (
            <View key={entry.key} style={{ height: pageHeight }} />
          ),
        )}
      </ScrollView>
    );
  },
);
