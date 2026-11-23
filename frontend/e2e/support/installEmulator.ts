import type { BrowserContext, Page } from '@playwright/test';
import {
  createSupabaseEmulator,
  type EmulatorSeed,
  type SupabaseEmulator,
} from './supabaseEmulator';

export type InstalledEmulator = {
  emulator: SupabaseEmulator;
  blocked: string[];
  pageErrors: string[];
  nativeDialogs: string[];
};

export async function installEmulator(
  context: BrowserContext,
  page: Page,
  seed: EmulatorSeed,
  options: { appOrigin: string; supabaseOrigin?: string; nowMs: () => number },
): Promise<InstalledEmulator> {
  const supabaseOrigin = options.supabaseOrigin ?? 'http://127.0.0.1:54321';
  const emulator = createSupabaseEmulator(seed, options.nowMs);
  const blocked: string[] = [];
  const pageErrors: string[] = [];
  const nativeDialogs: string[] = [];

  page.on('pageerror', (err) => {
    pageErrors.push(err instanceof Error ? err.message : String(err));
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      const locUrl = msg.location().url ?? '';
      // Ignore WebSocket aborts and expected PostgREST 404 (PGRST202 missing RPC in bootstrapMode='missing')
      const isExpectedMissingRpc =
        locUrl.startsWith(supabaseOrigin) &&
        /Failed to load resource: the server responded with a status of 404/i.test(txt);
      if (!/WebSocket connection to/i.test(txt) && !isExpectedMissingRpc) {
        pageErrors.push(txt);
      }
    }
  });

  page.on('dialog', (dialog) => {
    nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });

  await page.routeWebSocket(/.*/, (ws) => {
    void ws.close();
  });

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();

    if (
      url.startsWith(options.appOrigin) ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('about:')
    ) {
      await route.continue();
      return;
    }

    if (url.startsWith(supabaseOrigin)) {
      const headers = await req.allHeaders();
      const body = req.postData();
      const res = emulator.handle({
        method: req.method(),
        url,
        headers,
        body,
      });
      await route.fulfill({
        status: res.status,
        headers: res.headers,
        body: res.body,
      });
      return;
    }

    blocked.push(url);
    await route.abort('blockedbyclient');
  });

  return {
    emulator,
    blocked,
    pageErrors,
    nativeDialogs,
  };
}
