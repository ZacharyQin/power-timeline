import { addEventListener, removeEventListener } from "@decky/api";
import { useSyncExternalStore } from "react";
import { getSailingStatus, setSailingMode, updateNativeChargeSettings } from "./backend";
import type { SailingStatus } from "./types";

const listeners = new Set<() => void>();
let view: { status: SailingStatus | null; error: string | null; busy: boolean } = { status: null, error: null, busy: false };
let nativeRequest: Promise<SailingStatus> | null = null;
let stopBridge: (() => void) | null = null;
let generation = 0;

function publish(next: typeof view) {
  view = next;
  listeners.forEach(listener => listener());
}

function receive(status: SailingStatus) {
  if (view.status && status.updated_at < view.status.updated_at) return;
  publish({ ...view, status, error: null });
}

function nativeSettings() {
  const host = globalThis as { settingsStore?: { GetClientSetting?: (key: string) => unknown } };
  const store = host.settingsStore;
  if (!store?.GetClientSetting) throw new Error("Steam charge settings are unavailable");
  const enabled = store.GetClientSetting("steamos_charge_limit_enabled");
  const limit = store.GetClientSetting("steamos_charge_limit");
  if (!Array.isArray(enabled) || typeof enabled[0] !== "boolean" || !Array.isArray(limit) || typeof limit[0] !== "number") {
    throw new Error("Steam charge settings are not ready");
  }
  return { enabled: enabled[0], limit: limit[0] };
}

function syncNative(): Promise<SailingStatus> {
  if (nativeRequest) return nativeRequest;
  const own = generation;
  const request = Promise.resolve().then(() => {
    const native = nativeSettings();
    return updateNativeChargeSettings(native.enabled, native.limit);
  }).then(status => {
    if (own === generation) receive(status);
    return status;
  }).finally(() => {
    if (nativeRequest === request) nativeRequest = null;
  });
  nativeRequest = request;
  return request;
}

export function startSailingBridge() {
  stopBridge?.();
  const own = ++generation;
  let stopped = false;
  const subscription = addEventListener<[status: SailingStatus]>("sailing_changed", status => {
    if (!stopped && own === generation) receive(status);
  });
  const refresh = async () => {
    if (stopped || view.busy || nativeRequest) return;
    try {
      await syncNative();
    } catch (error) {
      if (stopped || own !== generation) return;
      publish({ ...view, error: error instanceof Error ? error.message : String(error) });
      if (!view.status) {
        try {
          const status = await getSailingStatus();
          if (!stopped && own === generation) publish({ ...view, status });
        } catch (backendError) {
          if (!stopped && own === generation) publish({ ...view, error: backendError instanceof Error ? backendError.message : String(backendError) });
        }
      }
    }
  };
  void refresh();
  const timer = window.setInterval(refresh, 2000);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    removeEventListener("sailing_changed", subscription);
    if (own === generation) generation++;
    if (stopBridge === stop) stopBridge = null;
  };
  stopBridge = stop;
  return stop;
}

export async function changeSailing(enabled: boolean, delta: number) {
  if (view.busy) return;
  const own = generation;
  publish({ ...view, busy: true, error: null });
  try {
    if (enabled) {
      if (nativeRequest) await nativeRequest;
      await syncNative();
    }
    const status = await setSailingMode(enabled, delta);
    if (own === generation) receive(status);
  } catch (error) {
    if (own === generation) publish({ ...view, error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (own === generation) publish({ ...view, busy: false });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSailing() {
  return useSyncExternalStore(subscribe, () => view, () => view);
}
