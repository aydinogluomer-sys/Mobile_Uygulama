type InvokeErrorBody = {
  error?: unknown;
  code?: unknown;
  balance?: unknown;
};

type InvokeErrorLike = {
  message?: unknown;
  context?: {
    json?: () => Promise<InvokeErrorBody>;
  };
};

// Supabase functions.invoke hatasından sunucunun gerçek mesajını/kodunu çıkarır.
// AI Coach ve günlük içgörüleri paylaşır.
export async function extractInvokeError(
  error: unknown,
  fallbackMessage = 'Yanıt alınamadı, tekrar deneyin.',
): Promise<{ msg: string; code?: string; balance?: number }> {
  let msg = fallbackMessage;
  let code: string | undefined;
  let balance: number | undefined;
  const err = error && typeof error === 'object' ? (error as InvokeErrorLike) : null;
  try {
    const body = await err?.context?.json?.();
    if (typeof body?.error === 'string' && body.error) msg = body.error;
    if (typeof body?.code === 'string') code = body.code;
    if (typeof body?.balance === 'number') balance = body.balance;
  } catch {
    const m = err?.message;
    if (typeof m === 'string' && m) msg = m;
  }
  return { msg, code, balance };
}
