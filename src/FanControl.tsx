import { toaster } from "@decky/api";
import { findModuleExport, PanelSectionRow } from "@decky/ui";
import { useEffect, useId, useRef, useState, type FC, type ReactNode } from "react";
import { FaFan } from "react-icons/fa";
import { getFanStatus, setFanMode } from "./backend";
import { Reading } from "./components";
import { useQuery } from "./data";
import { t, useLocale } from "./i18n";
import type { MessageKey } from "./locales/en";
import type { FanStatus } from "./types";

const reasonKeys: Record<string, MessageKey> = {
  download_mode: "fan.downloadMode", external_control: "fan.externalControl",
  fan_fault: "fan.fault", fan_stalled: "fan.stalled", hardware_missing: "fan.hardwareMissing",
  hardware_failed: "fan.hardwareFailed", recovery_failed: "fan.recoveryFailed",
  restore_degraded: "fan.restoreDegraded", monitor_failed: "fan.monitorFailed",
  service_failed: "fan.serviceFailed", sleeping: "fan.sleeping", owner_lost: "fan.ownerLost",
};

interface NativeModeTabsProps {
  parentid: string;
  tabs: { id: string; title: string; footer: { onFocus: undefined; onActivate: () => void; noFocusRing: boolean } }[];
  activeTab: string | null;
  onShowTab: (tab: string) => void;
  showGlyphs: boolean;
  wrapAround: boolean;
  className?: string;
}

// The full native Tabs page selects its first tab for an unknown active ID.
// Use its real header so an unavailable controller never looks like automatic.
const NativeModeTabs = findModuleExport(value => {
  const source = typeof value === "function" ? value.toString() : "";
  return source.includes(".TabRowTabs") && source.includes("activeTab:");
}) as FC<NativeModeTabsProps>;

function validate(status: FanStatus): FanStatus {
  if (!status || ![null, "automatic", "maximum"].includes(status.mode)
      || !["automatic", "starting", "maximum", "restoring", "conflict", "error", "unavailable"].includes(status.phase)
      || typeof status.available !== "boolean" || !Number.isFinite(status.updated_at)
      || ![null, true, false].includes(status.fault)
      || [status.target_rpm, status.actual_rpm].some(value => value !== null && (!Number.isFinite(value) || value < 0))) {
    throw new Error("Invalid fan control status");
  }
  return status;
}

export function FanControl({ active, children }: { active: boolean; children: ReactNode }) {
  const locale = useLocale();
  const parentId = useId();
  const root = useRef<HTMLDivElement>(null);
  const query = useQuery("fan-control", async () => validate(await getFanStatus()), active, 2000);
  const [response, setResponse] = useState<FanStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const lastNotice = useRef<string | null>(null);
  const status = response && (!query.data || response.updated_at >= query.data.updated_at) ? response : query.data;
  const failure = error || query.error || status?.error;
  const recovery = status?.reason === "owner_lost" || status?.reason === "sleeping";
  useEffect(() => {
    if (!active) return;
    const key = failure || (recovery ? status?.reason : null);
    if (!key) { lastNotice.current = null; return; }
    if (key === lastNotice.current) return;
    lastNotice.current = key;
    const reason = status?.reason && reasonKeys[status.reason];
    toaster.toast({ title: t(failure ? "fan.error" : "fan.title"), body: reason ? t(reason) : failure || t("fan.unavailable") });
  }, [active, failure, recovery, status?.reason, locale]);
  const change = async (mode: "automatic" | "maximum") => {
    if (!active || inFlight.current || !status?.available || query.error || root.current?.closest("[inert]")) return;
    if (mode === status.mode && !status.error) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      setResponse(validate(await setFanMode(mode)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
      query.refresh();
    }
  };
  // Native tabs normally activate on focus. Only confirmation commits a mode;
  // directional navigation keeps its native focus ring without changing hardware.
  const tabs = [
    { id: "automatic", title: t("fan.automatic"), footer: { onFocus: undefined, noFocusRing: false, onActivate: () => void change("automatic") } },
    { id: "maximum", title: t("fan.maximum"), footer: { onFocus: undefined, noFocusRing: false, onActivate: () => void change("maximum") } },
  ];
  const blocked = busy || !status?.available || !!query.error;
  return <div ref={root} className="pt-fan-control" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <style>{`
      .pt-fan-mode-tabs > :not([role="tablist"]) { display: none; }
      .pt-fan-mode-tabs [role="tablist"],
      .pt-fan-mode-tabs [role="tablist"] > div > .Panel { width: 100%; min-width: 0; }
      .pt-fan-mode-tabs [role="tablist"] > div > .Panel > :not([role="tab"]) { display: none; }
      .pt-fan-mode-tabs [role="tab"] { flex: 1 1 0; min-width: 0; height: auto; padding-inline: 8px; white-space: normal; justify-content: center; text-align: center; }
      .pt-fan-mode-tabs [role="tab"] > span { white-space: normal; }
    `}</style>
    <Reading padding="standard" icon={FaFan} label={t("fan.title")} />
    <PanelSectionRow>
      <div inert={blocked} aria-disabled={blocked} aria-busy={busy || (!status && query.loading)}>
        <NativeModeTabs parentid={parentId} tabs={tabs} activeTab={query.error ? null : status?.mode ?? null}
          className="pt-fan-mode-tabs" showGlyphs={false} wrapAround={false}
          onShowTab={mode => document.getElementById(parentId + mode)?.focus()} />
      </div>
    </PanelSectionRow>
    {!query.error && status?.mode === "automatic" && children}
  </div>;
}
