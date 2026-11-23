import React, { type ReactElement, type ReactNode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
  within,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

/** 375x812, çentikli telefon: testlerin varsayılan güvenli alanı. */
export const TEST_METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
};

export type ProviderOptions = {
  metrics?: Metrics;
  withDialogHost?: boolean;
  userEventOptions?: Parameters<typeof userEvent.setup>[0];
};

export type RenderedScreen = RenderResult & {
  user: ReturnType<typeof userEvent.setup>;
};

export function renderWithProviders(
  ui: ReactElement,
  options?: ProviderOptions & Omit<RenderOptions, 'wrapper'>,
): RenderedScreen {
  const {
    metrics = TEST_METRICS,
    withDialogHost = false,
    userEventOptions,
    ...renderOptions
  } = options ?? {};

  let DialogHostComponent: React.ComponentType | null = null;
  if (withDialogHost) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    DialogHostComponent = require('../../components/ui/DialogHost').default as React.ComponentType;
  }

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <SafeAreaProvider initialMetrics={metrics}>
        {children}
        {DialogHostComponent ? <DialogHostComponent /> : null}
      </SafeAreaProvider>
    );
  }

  const user = userEvent.setup(userEventOptions);
  const rendered = render(ui, { ...renderOptions, wrapper: Wrapper });
  return Object.assign(rendered, { user });
}

export { act, cleanup, fireEvent, screen, userEvent, waitFor, within };
export type { Metrics, RenderOptions, RenderResult };
