// Supabase functions.invoke hatasından sunucunun gerçek mesajını/kodunu çıkarır.
// AI Coach ve günlük içgörüleri paylaşır.
export async function extractInvokeError(
  error: unknown
): Promise<{ msg: string; code?: string; balance?: number }> {
  let msg = 'Yanıt alınamadı, tekrar deneyin.';
  let code: string | undefined;
  let balance: number | undefined;
  try {
    const body = await (error as any)?.context?.json?.();
    if (body?.error) msg = body.error;
    code = body?.code;
    balance = body?.balance;
  } catch {
    const m = (error as any)?.message;
    if (m) msg = m;
  }
  return { msg, code, balance };
}
