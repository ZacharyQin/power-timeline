import { ButtonItem, DialogButtonSecondary, Field, Focusable, PanelSectionRow } from "@decky/ui";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { IconType } from "react-icons";
import { FaBolt, FaDesktop, FaExclamationTriangle, FaInfoCircle, FaLayerGroup, FaMicrochip, FaSyncAlt, FaTerminal } from "react-icons/fa";
import type { Metric } from "./types";
import { getPowerBand, powerBands, semanticColors, type SemanticRole } from "./displaySemantics";

export const metricLabels = { system: "整机伴随耗电（实测）", process: "游戏 CPU + GPU（估算）", cpu: "游戏 CPU（估算）", gpu: "游戏 GPU（估算）" };
export const energyFields = { system: "system_wh", process: "process_wh", cpu: "cpu_wh", gpu: "gpu_wh" } as const;
export const sortLabels = { recent: "最近游玩", energy: "能量 Wh", power: "平均功率 W（有效覆盖）" };
export const sessionLabels = { active: "正在观测", ended: "已结束观测", interrupted: "观测中断" };
export const metricIcons: Record<Metric, IconType> = { system: FaBolt, process: FaLayerGroup, cpu: FaMicrochip, gpu: FaDesktop };
const batteryStates: Record<string, string> = { Full: "已充满", Charging: "充电中", Discharging: "放电中", "Not charging": "未充电", Unknown: "状态未知" };
export const batteryStateText = (state: string) => batteryStates[state] ?? state;
export const supplyText = (supply: string) => supply === "external" ? "外接供电" : supply === "battery" ? "电池供电" : "供电未知";
type ReasonGroup = "system" | "coverage" | "model";
const reasonDetails: Record<string, { group: ReasonGroup; text: string }> = {
  not_confirmed_battery_discharge: { group: "system", text: "未确认电池独立放电，电池净功率不能代表整机功率" },
  system_measurement_unavailable: { group: "system", text: "部分观测区间没有有效整机电池读数" },
  shared_system_unallocated: { group: "system", text: "多个游戏共享整机开销，未将整机耗电完整分配给每个游戏" },
  battery_missing_or_ambiguous: { group: "system", text: "未找到唯一可用的电池传感器" },
  external_supply_unavailable: { group: "system", text: "无法确认外接供电状态" },
  observed_mid_run: { group: "coverage", text: "从游戏运行中途开始观测，不包含此前耗电" },
  first_process_observation: { group: "coverage", text: "首次发现进程时尚无活动差值" },
  process_set_changed: { group: "coverage", text: "部分区间的游戏进程集合发生变化" },
  cpu_interval_incomplete: { group: "coverage", text: "部分区间的 CPU 活动或功耗读数不完整" },
  gpu_interval_incomplete: { group: "coverage", text: "部分区间的 GPU 活动或功耗读数不完整" },
  cpu_estimate_unavailable: { group: "coverage", text: "部分区间无法给出 CPU 能量估算" },
  gpu_estimate_unavailable: { group: "coverage", text: "部分区间无法给出 GPU 能量估算" },
  gpu_counter_reset: { group: "coverage", text: "GPU 活动计数曾重置，该区间未补算" },
  amdgpu_metrics_unavailable: { group: "coverage", text: "AMDGPU 硬件功耗遥测不可用" },
  firmware_invalid_value: { group: "coverage", text: "固件未提供有效的硬件读数" },
  uncalibrated_activity_weighting: { group: "model", text: "按进程活动权重分配功耗域，属于非校准估算" },
  excludes_screen_soc_and_shared_system: { group: "model", text: "进程估算不包含屏幕、SoC 和系统共享开销" },
  concurrent_cpu_activity_normalized: { group: "model", text: "并行 CPU 活动权重已归一化，避免重复分配" },
  concurrent_gpu_occupancy_normalized: { group: "model", text: "并行 GPU 活动权重已归一化，避免重复分配" },
};
const fieldLabels: Record<string, string> = { system_w: "整机功率", battery_w: "电池净功率", battery_percent: "电量", supply: "供电", apu_w: "APU", cpu_w: "CPU", soc_w: "SoC", gpu_w: "GPU" };
export const reasonText = (code: string) => reasonDetails[code]?.text ?? code;
export function IconLabel({ icon: Icon, children }: { icon: IconType; children: ReactNode }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}><Icon aria-hidden="true" focusable="false" style={{ flexShrink: 0 }} /><span>{children}</span></span>;
}
export function Restrictions({ reasons, errors, label = "本次数据状态" }: { reasons?: readonly string[]; errors?: Record<string, string>; label?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [technical, setTechnical] = useState(false);
  const { groups, raw } = useMemo(() => {
    const groups: Record<ReasonGroup, string[]> = { system: [], coverage: [], model: [] };
    const raw: string[] = [];
    for (const code of reasons ?? []) {
      groups[reasonDetails[code]?.group ?? "coverage"].push(reasonText(code));
      raw.push(code);
    }
    for (const [field, code] of Object.entries(errors ?? {})) {
      groups[reasonDetails[code]?.group ?? "coverage"].push(`${fieldLabels[field] ?? field}：${reasonText(code)}`);
      raw.push(`${field}: ${code}`);
    }
    return { groups, raw };
  }, [reasons, errors]);
  if (raw.length === 0) return null;
  return <section className="pt-data-status" aria-label={label}>
    <Focusable><DialogButtonSecondary className="pt-compact-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><IconLabel icon={FaInfoCircle}>{expanded ? `收起${label}` : label}</IconLabel></DialogButtonSecondary></Focusable>
    {expanded && <div className="pt-data-status-body">
      {groups.system.length > 0 && <p><strong>整机读数：</strong>{groups.system.join("；")}</p>}
      {groups.coverage.length > 0 && <p><strong>本次观测：</strong>{groups.coverage.join("；")}</p>}
      {groups.model.length > 0 && <p><strong>估算信息：</strong>{groups.model.join("；")}</p>}
      <Focusable><DialogButtonSecondary className="pt-compact-button" aria-expanded={technical} onClick={() => setTechnical(!technical)}><IconLabel icon={FaTerminal}>{technical ? "隐藏技术原因码" : "显示技术原因码"}</IconLabel></DialogButtonSecondary></Focusable>
      {technical && <p style={{ overflowWrap: "anywhere", fontFamily: "monospace" }}>{raw.join("；")}</p>}
    </div>}
  </section>;
}
export function valueText(value: number | null, unit: string, digits = 2) {
  return value === null ? "未知" : `${value.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${unit}`;
}
export function SemanticValue({ value, unit, role, digits = 2, className }: { value: number | null; unit: "W" | "Wh" | "%"; role?: SemanticRole; digits?: number; className?: string }) {
  const color = value === null ? undefined : unit === "W" ? getPowerBand(value)?.color : role ? semanticColors[role] : undefined;
  return <span className={color ? `pt-color${className ? ` ${className}` : ""}` : className} style={color ? { "--pt-color": color } as CSSProperties : undefined}>{valueText(value, unit, digits)}</span>;
}
export function SemanticText({ role, children }: { role: SemanticRole; children: ReactNode }) {
  return <span className="pt-color" style={{ "--pt-color": semanticColors[role] } as CSSProperties}>{children}</span>;
}
export function PowerScaleLegend() {
  return <span className="pt-power-scale" aria-label="固定绝对功率色阶">
    <span>功率色阶</span>
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
  return new Date(timestamp * 1000).toLocaleString("zh-CN", date ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function durationText(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分 ${Math.floor(Math.max(0, seconds)) % 60} 秒`;
}
export function Reading({ label, children, description, icon: Icon, layout = "inline", padding = "compact", className }: { label: ReactNode; children?: ReactNode; description?: ReactNode; icon?: IconType; layout?: "inline" | "below"; padding?: "none" | "standard" | "compact"; className?: string }) {
  return <PanelSectionRow><Field className={`pt-semantic-field${className ? ` ${className}` : ""}`} label={label} description={description} icon={Icon && <Icon aria-hidden="true" focusable="false" />} childrenLayout={layout} inlineWrap="shift-children-below" padding={padding} bottomSeparator="none">{children}</Field></PanelSectionRow>;
}
export function Action({ children, onClick, preferred = false, description, disabled = false, icon }: { children: ReactNode; onClick: () => void; preferred?: boolean; description?: ReactNode; disabled?: boolean; icon?: IconType }) {
  return <PanelSectionRow><Focusable preferredFocus={preferred}><ButtonItem layout="below" onClick={onClick} description={description} disabled={disabled}>{icon ? <IconLabel icon={icon}>{children}</IconLabel> : children}</ButtonItem></Focusable></PanelSectionRow>;
}
export function QueryStatus({ loading, error, retry, padding }: { loading: boolean; error: string | null; retry: () => void; padding?: "standard" | "compact" }) {
  return <>{loading && <Reading padding={padding} icon={FaSyncAlt} label="正在读取真实记录…" />}{error && <><Reading padding={padding} icon={FaExclamationTriangle} label={<SemanticText role="error">查询失败</SemanticText>} description={error}>已显示的旧记录不代表当前状态。</Reading><Action icon={FaSyncAlt} onClick={retry}>重新读取</Action></>}</>;
}
