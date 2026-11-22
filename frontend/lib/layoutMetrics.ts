export const MAX_CONTENT_WIDTH = 720;
export const TAB_BAR_CONTENT_HEIGHT = 56;
export const FAB_SIZE = 56;
export const FLOATING_GAP = 12;

export function contentWidth(windowWidth: number): number {
  return Math.min(windowWidth, MAX_CONTENT_WIDTH);
}

export function heatmapCellSize(windowWidth: number): number {
  return Math.max(4, Math.floor((contentWidth(windowWidth) - 48) / 53));
}

export function chartWidth(windowWidth: number): number {
  return Math.max(160, contentWidth(windowWidth) - 64);
}

export function barWidth(chartW: number, count = 14, gap = 3): number {
  const safeCount = Math.max(1, count);
  return Math.max(2, Math.floor((chartW - gap * (safeCount - 1)) / safeCount));
}

export function radarSize(windowWidth: number): number {
  return Math.max(120, Math.min(280, contentWidth(windowWidth) - 80));
}

export function tabBarPaddingBottom(insetBottom: number): number {
  return Math.max(insetBottom, 8);
}

export function tabBarHeight(insetBottom: number, fontScale: number): number {
  const clampedScale = Math.min(1.6, Math.max(1, Number.isFinite(fontScale) ? fontScale : 1));
  return Math.round(
    TAB_BAR_CONTENT_HEIGHT + tabBarPaddingBottom(insetBottom) + 14 * (clampedScale - 1),
  );
}

export function undoToastBottom(fabBottom: number): number {
  return fabBottom + FAB_SIZE + FLOATING_GAP;
}
