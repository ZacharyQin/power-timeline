import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSnapshot } from "./backend";
import type { Snapshot } from "./types";

let snapshot: Snapshot | null = null;
let eventSequence = 0;
const listeners = new Set<() => void>();
const retiredEpochs = new Set<string>();
const queryCache = new Map<string, unknown>();

export function receiveSnapshot(next: Snapshot) {
  if (retiredEpochs.has(next.epoch)) return;
  if (snapshot?.epoch === next.epoch && snapshot.revision > next.revision) return;
  if (snapshot && snapshot.epoch !== next.epoch) retiredEpochs.add(snapshot.epoch);
  snapshot = next;
  eventSequence += 1;
  listeners.forEach((listener) => listener());
}

export function useDocumentVisible() {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  return visible;
}

export function useSnapshot(enabled: boolean) {
  const current = useSyncExternalStore((listener) => {
    if (!enabled) return () => {};
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => snapshot);
  const query = useQuery("snapshot", async () => {
    const before = eventSequence;
    const next = await getSnapshot();
    if (before === eventSequence || snapshot?.epoch === next.epoch) receiveSnapshot(next);
    return next;
  }, enabled, 5000);
  return { snapshot: current, error: query.error, loading: query.loading, refresh: query.refresh };
}

export function useQuery<T>(key: string, load: () => Promise<T>, enabled = true, interval = 5000) {
  const loader = useRef(load);
  loader.current = load;
  const cached = queryCache.get(key) as T | undefined;
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null; loading: boolean }>({ key, data: cached ?? null, error: null, loading: cached === undefined });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let running = false;
    setResult((previous) => previous.key === key ? previous : { key, data: cached ?? null, error: null, loading: cached === undefined });
    const refresh = async () => {
      if (running || cancelled) return;
      running = true;
      try {
        const data = await loader.current();
        if (!cancelled) {
          queryCache.delete(key);
          queryCache.set(key, data);
          if (queryCache.size > 24) {
            const oldest = queryCache.keys().next().value;
            if (oldest !== undefined) queryCache.delete(oldest);
          }
          setResult({ key, data, error: null, loading: false });
        }
      } catch (error) {
        if (!cancelled) setResult((previous) => ({ key, data: previous.key === key ? previous.data : null, error: error instanceof Error ? error.message : String(error), loading: false }));
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = interval > 0 ? window.setInterval(() => void refresh(), interval) : null;
    return () => { cancelled = true; if (timer !== null) window.clearInterval(timer); };
  }, [key, enabled, interval, retry]);
  const selected = result.key === key ? result : { data: cached ?? null, error: null, loading: cached === undefined };
  return { ...selected, refresh: () => setRetry((value) => value + 1) };
}
