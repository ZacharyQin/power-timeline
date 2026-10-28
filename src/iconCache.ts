const saved = new Map<string, Promise<unknown>>();

export async function rememberDisplayedIcon(appId: string, accountId: string, source: string, save: (app: string, account: string, source: string) => Promise<unknown>) {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const digest = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
  const key = `${accountId}:${appId}:${digest}`;
  const previous = saved.get(key);
  if (previous) return previous;
  const operation = save(appId, accountId, source);
  saved.set(key, operation);
  try {
    return await operation;
  } catch (error) {
    saved.delete(key);
    throw error;
  } finally {
    while (saved.size > 128) saved.delete(saved.keys().next().value!);
  }
}
