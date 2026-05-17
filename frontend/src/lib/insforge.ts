import { createClient } from '@insforge/sdk';

export const insforge = createClient({
  baseUrl: import.meta.env.VITE_INSFORGE_URL,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY,
});

export const FUNCTIONS_URL = import.meta.env.VITE_FUNCTIONS_URL as string;

// Module-level connect/subscribe singleton. Survives React StrictMode's
// dev mount → cleanup → remount cycle, which would otherwise leave the
// socket disconnected because the cleanup ran but the second mount short-
// circuited.
let realtimeReady: Promise<void> | null = null;
export function ensureRealtime(channel: string): Promise<void> {
  if (!realtimeReady) {
    realtimeReady = (async () => {
      await insforge.realtime.connect();
      await insforge.realtime.subscribe(channel);
    })();
  }
  return realtimeReady;
}

export async function callFn(slug: string, body: Record<string, unknown>) {
  const res = await fetch(`${FUNCTIONS_URL}/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${slug} returned ${res.status}`);
  return res.json();
}
