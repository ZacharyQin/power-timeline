import { ButtonItem, DialogButtonSecondary, Field, Focusable, PanelSectionRow } from "@decky/ui";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { IconType } from "react-icons";
import { FaBolt, FaDesktop, FaExclamationTriangle, FaInfoCircle, FaLayerGroup, FaMicrochip, FaSyncAlt, FaTerminal } from "react-icons/fa";
import type { Metric, Sort } from "./types";
import { getPowerBand, powerBands, semanticColors, type SemanticRole } from "./displaySemantics";
import { numberLocale, t, useLocale } from "./i18n";
import type { MessageKey } from "./locales/en";

const metricKey = { system: "metric.system", process: "metric.process", cpu: "metric.cpu", gpu: "metric.gpu" } as const;
export const metricOrder = ["system", "process", "cpu", "gpu"] as const;
export const metricLabel = (metric: Metric) => t(metricKey[metric]);
export const energyFields = { system: "system_wh", process: "process_wh", cpu: "cpu_wh", gpu: "gpu_wh" } as const;
const sortKey = { recent: "sort.recent", energy: "sort.energy", power: "sort.power" } as const;
export const sortOrder = ["recent", "energy", "power"] as const;
export const sortLabel = (sort: Sort) => t(sortKey[sort]);
const sessionKey = { active: "session.active", ended: "session.ended", interrupted: "session.interrupted" } as const;
export type SessionStatus = keyof typeof sessionKey;
export const sessionLabel = (status: string) => status in sessionKey ? t(sessionKey[status as SessionStatus]) : status;
export const metricIcons: Record<Metric, IconType> = { system: FaBolt, process: FaLayerGroup, cpu: FaMicrochip, gpu: FaDesktop };
const batteryKey: Record<string, MessageKey> = { Full: "battery.full", Charging: "battery.charging", Discharging: "battery.discharging", "Not charging": "battery.notCharging", Unknown: "battery.unknown" };
export const batteryStateText = (state: string) => batteryKey[state] ? t(batteryKey[state]) : state;
export const supplyText = (supply: string) => t(supply === "external" ? "supply.external" : supply === "battery" ? "supply.battery" : "supply.unknown");
type ReasonGroup = "system" | "coverage" | "model";
const reasonDetails = {
  not_confirmed_battery_discharge: { group: "system", key: "reason.not_confirmed_battery_discharge" },
  system_measurement_unavailable: { group: "system", key: "reason.system_measurement_unavailable" },
  shared_system_unallocated: { group: "system", key: "reason.shared_system_unallocated" },
  battery_missing_or_ambiguous: { group: "system", key: "reason.battery_missing_or_ambiguous" },
  external_supply_unavailable: { group: "system", key: "reason.external_supply_unavailable" },
  observed_mid_run: { group: "coverage", key: "reason.observed_mid_run" },
  first_process_observation: { group: "coverage", key: "reason.first_process_observation" },
  process_set_changed: { group: "coverage", key: "reason.process_set_changed" },
  cpu_interval_incomplete: { group: "coverage", key: "reason.cpu_interval_incomplete" },
  gpu_interval_incomplete: { group: "coverage", key: "reason.gpu_interval_incomplete" },
  cpu_estimate_unavailable: { group: "coverage", key: "reason.cpu_estimate_unavailable" },
  gpu_estimate_unavailable: { group: "coverage", key: "reason.gpu_estimate_unavailable" },
  gpu_counter_reset: { group: "coverage", key: "reason.gpu_counter_reset" },
  amdgpu_metrics_unavailable: { group: "coverage", key: "reason.amdgpu_metrics_unavailable" },
  firmware_invalid_value: { group: "coverage", key: "reason.firmware_invalid_value" },
  uncalibrated_activity_weighting: { group: "model", key: "reason.uncalibrated_activity_weighting" },
  excludes_screen_soc_and_shared_system: { group: "model", key: "reason.excludes_screen_soc_and_shared_system" },
  concurrent_cpu_activity_normalized: { group: "model", key: "reason.concurrent_cpu_activity_normalized" },
  concurrent_gpu_occupancy_normalized: { group: "model", key: "reason.concurrent_gpu_occupancy_normalized" },
  ec_unsupported_device: { group: "coverage", key: "reason.ec_unsupported_device" },
  ec_permission_required: { group: "coverage", key: "reason.ec_permission_required" },
  ec_unavailable: { group: "coverage", key: "reason.ec_unavailable" },
  ec_input_invalid: { group: "coverage", key: "reason.ec_input_invalid" },
  ec_changed_during_sample: { group: "coverage", key: "reason.ec_changed_during_sample" },
  ec_torn_read: { group: "coverage", key: "reason.ec_torn_read" },
  ec_firmware_mismatch: { group: "coverage", key: "reason.ec_firmware_mismatch" },
  battery_direction_unknown: { group: "coverage", key: "reason.battery_direction_unknown" },
  battery_window_changed: { group: "coverage", key: "reason.battery_window_changed" },
  negative_power_difference: { group: "coverage", key: "reason.negative_power_difference" },
  flow_components_unavailable: { group: "coverage", key: "reason.flow_components_unavailable" },
} as const satisfies Record<string, { group: ReasonGroup; key: MessageKey }>;
const fieldKey = { system_w: "field.system_w", battery_w: "field.battery_w", battery_percent: "field.battery_percent", supply: "field.supply", apu_w: "field.apu_w", cpu_w: "field.cpu_w", soc_w: "field.soc_w", gpu_w: "field.gpu_w", input_w: "field.input_w", peripheral_w: "field.peripheral_w", battery_net_w: "field.battery_net_w" } as const satisfies Record<string, MessageKey>;
export const reasonText = (code: string) => code in reasonDetails ? t(reasonDetails[code as keyof typeof reasonDetails].key) : code;
export function IconLabel({ icon: Icon, children }: { icon: IconType; children: ReactNode }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}><Icon aria-hidden="true" focusable="false" style={{ flexShrink: 0 }} /><span>{children}</span></span>;
}
export function Restrictions({ reasons, errors, label }: { reasons?: readonly string[]; errors?: Record<string, string>; label?: string }) {
  const language = useLocale();
  const title = label ?? t("common.dataStatus");
  const [expanded, setExpanded] = useState(false);
  const [technical, setTechnical] = useState(false);
  const { groups, raw } = useMemo(() => {
    const groups: Record<ReasonGroup, string[]> = { system: [], coverage: [], model: [] };
    const raw: string[] = [];
    const groupOf = (code: string): ReasonGroup => code in reasonDetails ? reasonDetails[code as keyof typeof reasonDetails].group : "coverage";
    for (const code of reasons ?? []) {
      groups[groupOf(code)].push(reasonText(code));
      raw.push(code);
    }
    for (const [field, code] of Object.entries(errors ?? {})) {
      const name = field in fieldKey ? t(fieldKey[field as keyof typeof fieldKey]) : field;
      groups[groupOf(code)].push(t("common.fieldReason", { field: name, reason: reasonText(code) }));
      raw.push(`${field}: ${code}`);
    }
    return { groups, raw };
  }, [reasons, errors, language]);
  if (raw.length === 0) return null;
  const sep = t("common.join");
  return <section className="pt-data-status" aria-label={title}>
    <Focusable><DialogButtonSecondary className="pt-compact-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><IconLabel icon={FaInfoCircle}>{expanded ? t("common.collapse", { label: title }) : title}</IconLabel></DialogButtonSecondary></Focusable>
    {expanded && <div className="pt-data-status-body">
      {groups.system.length > 0 && <p><strong>{t("common.systemGroup")}</strong>{groups.system.join(sep)}</p>}
      {groups.coverage.length > 0 && <p><strong>{t("common.coverageGroup")}</strong>{groups.coverage.join(sep)}</p>}
      {groups.model.length > 0 && <p><strong>{t("common.modelGroup")}</strong>{groups.model.join(sep)}</p>}
      <Focusable><DialogButtonSecondary className="pt-compact-button" aria-expanded={technical} onClick={() => setTechnical(!technical)}><IconLabel icon={FaTerminal}>{technical ? t("common.hideCodes") : t("common.showCodes")}</IconLabel></DialogButtonSecondary></Focusable>
      {technical && <p style={{ overflowWrap: "anywhere", fontFamily: "monospace" }}>{raw.join(sep)}</p>}
    </div>}
  </section>;
}
export function valueText(value: number | null, unit: string, digits = 2) {
  return value === null ? t("common.unknown") : `${value.toLocaleString(numberLocale(), { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${unit}`;
}
export function SemanticValue({ value, unit, role, digits = 2, className }: { value: number | null; unit: "W" | "Wh" | "%"; role?: SemanticRole; digits?: number; className?: string }) {
  const color = value === null ? undefined : unit === "W" ? getPowerBand(value)?.color : role ? semanticColors[role] : undefined;
  return <span className={color ? `pt-color${className ? ` ${className}` : ""}` : className} style={color ? { "--pt-color": color } as CSSProperties : undefined}>{valueText(value, unit, digits)}</span>;
}
export function SemanticText({ role, children }: { role: SemanticRole; children: ReactNode }) {
  return <span className="pt-color" style={{ "--pt-color": semanticColors[role] } as CSSProperties}>{children}</span>;
}
export function PowerScaleLegend() {
  return <span className="pt-power-scale" aria-label={t("scale.aria")}>
    <span>{t("scale.title")}</span>
    {powerBands.map((band) => <span key={band.min} className="pt-color" style={{ "--pt-color": band.color } as CSSProperties}>{band.range}</span>)}
  </span>;
}
export function SemanticStyles() {
  return <style>{`
    .pt-color { color: var(--pt-color, inherit); }
    .pt-semantic-field:has(.pt-color):not(.gpfocus):not(.gpfocuswithin):not(:focus-within):not(.pt-semantic-disabled) { background-color: transparent; }
    .pt-semantic-field.gpfocus .pt-color,
    .pt-semantic-field.gpfocuswithin .pt-color,
    .pt-semantic-field:focus-visible .pt-color,
    .pt-semantic-field:has(:focus-visible) .pt-color,
    .pt-semantic-field:disabled .pt-color,
    .pt-semantic-field[disabled] .pt-color,
    .pt-semantic-field[aria-disabled="true"] .pt-color,
    .pt-semantic-field.pt-semantic-disabled .pt-color { color: inherit; }
  `}</style>;
}
export function timeText(timestamp: number, date = false) {
  return new Date(timestamp * 1000).toLocaleString(numberLocale(), date ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function durationText(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return minutes >= 60 ? t("common.durationHours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }) : t("common.durationMinutes", { minutes, seconds: Math.floor(Math.max(0, seconds)) % 60 });
}
export function Reading({ label, children, description, icon: Icon, layout = "inline", padding = "compact", className, onGamepadFocus }: { label: ReactNode; children?: ReactNode; description?: ReactNode; icon?: IconType; layout?: "inline" | "below"; padding?: "none" | "standard" | "compact"; className?: string; onGamepadFocus?: (event: CustomEvent) => void }) {
  return <PanelSectionRow><Field className={`pt-semantic-field${className ? ` ${className}` : ""}`} label={label} description={description} icon={Icon && <Icon aria-hidden="true" focusable="false" />} childrenLayout={layout} inlineWrap="shift-children-below" padding={padding} bottomSeparator="none" onGamepadFocus={onGamepadFocus}>{children}</Field></PanelSectionRow>;
}
export function Action({ children, onClick, preferred = false, description, disabled = false, icon }: { children: ReactNode; onClick: () => void; preferred?: boolean; description?: ReactNode; disabled?: boolean; icon?: IconType }) {
  return <PanelSectionRow><Focusable preferredFocus={preferred}><ButtonItem layout="below" onClick={onClick} description={description} disabled={disabled}>{icon ? <IconLabel icon={icon}>{children}</IconLabel> : children}</ButtonItem></Focusable></PanelSectionRow>;
}
export function QueryStatus({ loading, error, retry, padding }: { loading: boolean; error: string | null; retry: () => void; padding?: "standard" | "compact" }) {
  return <>{loading && <Reading padding={padding} icon={FaSyncAlt} label={t("common.loading")} />}{error && <><Reading padding={padding} icon={FaExclamationTriangle} label={<SemanticText role="error">{t("common.queryFailed")}</SemanticText>} description={error}>{t("common.staleShown")}</Reading><Action icon={FaSyncAlt} onClick={retry}>{t("common.retry")}</Action></>}</>;
}
