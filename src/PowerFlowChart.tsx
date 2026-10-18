import { useId, type CSSProperties } from "react";
import type { PowerFlowReading } from "./types";
import { getPowerBand, semanticColors } from "./displaySemantics";

export const flowIsFresh = (flow: PowerFlowReading | null) => !!flow && Math.abs(Date.now() / 1000 - flow.timestamp) <= 10;
export const flowWatts = (w: number | null, signed = false) => w === null ? "— W" : `${signed && w > 0 ? "+" : ""}${w.toFixed(2)} W`;
export const flowColor = (w: number | null) => w === null ? "currentColor" : getPowerBand(Math.abs(w))!.color;

type Glyph = "battery" | "plug" | "deck" | "apu" | "peripheral" | "unknown";
function FlowGlyph({ kind, x, y, size }: { kind: Glyph; x: number; y: number; size: number }) {
  return <g transform={`translate(${x} ${y}) scale(${size / 28})`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === "battery" && <><rect x="-12" y="-7" width="24" height="14" rx="3" /><path d="M12-3H15V3H12M-7-2V2M-2-2V2M3-2V2" /></>}
    {kind === "plug" && <path d="M-5-12V-5M5-12V-5M-8-5H8V1C8 7 4 10 0 10C-4 10-8 7-8 1ZM0 10V15" />}
    {kind === "deck" && <><rect x="-19" y="-10" width="38" height="20" rx="7" /><rect x="-9" y="-7" width="18" height="14" rx="1.5" /><path d="M-14-3V3M-17 0H-11" /><circle cx="14" cy="-2" r="1" /><circle cx="14" cy="3" r="1" /></>}
    {kind === "apu" && <><rect x="-9" y="-9" width="18" height="18" rx="3" /><rect x="-4" y="-4" width="8" height="8" rx="1" /><path d="M-4-13V-9M4-13V-9M-4 9V13M4 9V13M-13-4H-9M-13 4H-9M9-4H13M9 4H13" /></>}
    {kind === "peripheral" && <><rect x="-13" y="-10" width="23" height="15" rx="2" /><path d="M-2 5V11M-8 11H4" /><rect x="7" y="1" width="8" height="12" rx="3" /><path d="M11 3V6" /></>}
    {kind === "unknown" && <><circle r="11" /><path d="M-4-4C-4-10 5-10 5-4C5 0 0 0 0 4M0 8h.01" /></>}
  </g>;
}

interface Branch { kind: Glyph; label: string; value: number | null; reverse?: boolean }

export function PowerFlowChart({ flow, compact = false, active = true }: { flow: PowerFlowReading | null; compact?: boolean; active?: boolean }) {
  const id = `pt-flow-${useId().replace(/:/g, "")}`;
  const fresh = flowIsFresh(flow);
  const current = fresh ? flow : null;
  const external = flow?.mode === "external";
  const branches: Branch[] = [
    { kind: "apu", label: "APU", value: current?.apu_w ?? null },
    { kind: "peripheral", label: compact ? "外围" : external ? "外围设备" : "外围功耗", value: current?.peripheral_w ?? null },
  ];
  if (external) branches.push({ kind: "battery", label: current?.battery_net_w !== null && (current?.battery_net_w ?? 0) < 0 ? "电池补供" : "电池", value: current?.battery_net_w ?? null, reverse: (current?.battery_net_w ?? 0) < 0 });
  const width = compact ? 268 : 800, height = compact ? 136 : 300;
  const trunkHeight = compact ? 76 : 182, trunkY = (height - trunkHeight) / 2;
  const sourceX = compact ? 2 : 20, sourceWidth = compact ? 18 : 58;
  const trunkX = compact ? 26 : 88, trunkWidth = compact ? 75 : 242;
  const deckX = compact ? 107 : 340, deckWidth = compact ? 20 : 56;
  const portX = compact ? 133 : 408, endX = compact ? 229 : 690;
  const leafX = compact ? 235 : 700, leafWidth = compact ? 24 : 60;
  const gap = compact ? 4 : 8, endGap = compact ? 24 : 46;
  const radius = compact ? 4 : 12, minNode = compact ? 16 : 32;
  const budget = trunkHeight - gap * (branches.length - 1);
  const allKnown = branches.every(b => b.value !== null && !b.reverse);
  const sum = branches.reduce((total, b) => total + Math.abs(b.value ?? 0), 0);
  const laidOut = branches.map((b, index) => {
    const h = allKnown ? sum > 0 ? budget * Math.abs(b.value!) / sum : 0 : budget / branches.length;
    return { ...b, h, slot: Math.max(compact ? 28 : 50, h), center: 0, path: "", shape: `${id}-branch-${index}` };
  });
  const totalSlots = laidOut.reduce((total, b) => total + b.slot, 0);
  const leafGap = Math.min(endGap, Math.max(0, (height - (compact ? 12 : 32) - totalSlots) / (branches.length - 1)));
  let portY = trunkY, slotY = (height - totalSlots - leafGap * (branches.length - 1)) / 2;
  for (const b of laidOut) {
    b.center = slotY + b.slot / 2;
    const endY = b.center - b.h / 2;
    b.path = `M${portX} ${portY}C${portX + (endX - portX) * .36} ${portY} ${endX - (endX - portX) * .36} ${endY} ${endX} ${endY}V${endY + b.h}C${endX - (endX - portX) * .36} ${endY + b.h} ${portX + (endX - portX) * .36} ${portY + b.h} ${portX} ${portY + b.h}Z`;
    portY += b.h + gap;
    slotY += b.slot + leafGap;
  }
  const input = current?.input_w ?? null;
  const sourceKind: Glyph = current?.mode === "external" ? "plug" : current?.mode === "battery" ? "battery" : "unknown";
  const sourceLabel = sourceKind === "plug" ? "USB-C" : sourceKind === "battery" ? "电池" : "来源未知";
  const sourceValue = current?.mode === "battery" && input !== null ? -input : input;
  const batteryAssist = laidOut.some(b => b.reverse);
  let caption = compact ? "" : "外围为差额估算，含通路损耗与窗口差";
  if (!flow) caption = "等待真实采样";
  else if (!fresh) caption = "读数已过期，当前分流未知";
  else if (!compact && flow.mode === "unknown") caption = "供电状态未知，流带仅示意";
  else if (!compact && external && current?.input_w === null) caption = "USB-C输入不可读，流带仅示意，外围暂不可分解";
  else if (!compact && current && current.peripheral_w === null) caption = current.difference_w !== null && current.difference_w < 0 ? "分项差额为负，流带仅示意，外围暂不可分解" : "分项未齐，流带仅示意，外围暂不可分解";
  else if (!compact && batteryAssist) caption = "电池补充供电，流带仅示意；外围为差额估算";
  return <figure className={`pt-flow-chart${compact ? " pt-flow-mini" : ""}`} style={{ margin: 0 }}>
    <style>{`
      .pt-flow-chart { width: 100%; min-width: 0; box-sizing: border-box; flex-shrink: 0; --pt-flow-surface: color-mix(in srgb, currentColor 6%, transparent); --pt-flow-muted: color-mix(in srgb, currentColor 72%, transparent); }
      .pt-flow-chart svg { display: block; width: 100%; height: auto; flex-shrink: 0; overflow: visible; }
      .pt-flow-chart text { font-family: inherit; font-variant-numeric: tabular-nums; }
      .pt-flow-chart figcaption { font-size: 13px; line-height: 20px; opacity: .78; margin-top: 4px; }
      .pt-flow-mini figcaption { font-size: 11px; line-height: 16px; }
      .pt-flow-sweep { pointer-events: none; animation: pt-flow-sweep-right 4.8s linear infinite; }
      @keyframes pt-flow-sweep-right { from { transform: translateX(-160px); } to { transform: translateX(var(--pt-flow-end)); } }
    `}</style>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${sourceLabel}${batteryAssist ? "与电池经Steam Deck向APU及外围供电" : `经Steam Deck向APU、外围${external ? "及电池" : ""}分流`}，${caption}`} style={{ "--pt-flow-end": `${width + 160}px` } as CSSProperties}>
      <defs>
        <linearGradient id={`${id}-input`}><stop stopColor={sourceKind === "plug" ? semanticColors.warning : sourceKind === "battery" ? semanticColors.battery : "currentColor"} stopOpacity=".30" /><stop offset="1" stopColor={semanticColors.system} stopOpacity=".14" /></linearGradient>
        <linearGradient id={`${id}-apu`}><stop stopColor={semanticColors.system} stopOpacity=".14" /><stop offset="1" stopColor={semanticColors.cpu} stopOpacity=".22" /></linearGradient>
        <linearGradient id={`${id}-peripheral`}><stop stopColor="currentColor" stopOpacity=".08" /><stop offset="1" stopColor="currentColor" stopOpacity=".14" /></linearGradient>
        <linearGradient id={`${id}-battery`}><stop stopColor={semanticColors.system} stopOpacity=".12" /><stop offset="1" stopColor={semanticColors.battery} stopOpacity=".30" /></linearGradient>
        <linearGradient id={`${id}-shine`}><stop stopColor="currentColor" stopOpacity="0" /><stop offset=".5" stopColor="currentColor" stopOpacity=".25" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient>
        <rect id={`${id}-trunk`} x={trunkX} y={trunkY} width={trunkWidth} height={trunkHeight} rx={compact ? 3 : 8} />
        {laidOut.map(b => <path key={b.shape} id={b.shape} d={b.path} />)}
        <clipPath id={`${id}-clip`}><use href={`#${id}-trunk`} />{laidOut.filter(b => !b.reverse).map(b => <use key={b.shape} href={`#${b.shape}`} />)}</clipPath>
      </defs>
      <use href={`#${id}-trunk`} fill={`url(#${id}-input)`} />
      {laidOut.map(b => <use key={b.shape} href={`#${b.shape}`} fill={`url(#${id}-${b.kind})`} stroke={b.value === null ? "var(--pt-flow-muted)" : "none"} strokeWidth=".6" strokeDasharray={b.value === null ? "4 5" : undefined} />)}
      {active && fresh && input !== null && input > 0 && <g clipPath={`url(#${id}-clip)`} aria-hidden="true"><rect className="pt-flow-sweep" x="0" y="0" width={compact ? 64 : 160} height={height} fill={`url(#${id}-shine)`} /></g>}
      <g fill="var(--pt-flow-surface)">
        <rect x={sourceX} y={trunkY} width={sourceWidth} height={trunkHeight} rx={radius} />
        <rect x={deckX} y={trunkY} width={deckWidth} height={trunkHeight} rx={radius} />
        {laidOut.map(b => <rect key={b.shape} x={leafX} y={b.center - Math.max(minNode, b.h) / 2} width={leafWidth} height={Math.max(minNode, b.h)} rx={radius} />)}
      </g>
      <g style={{ color: "var(--pt-flow-muted)" }}>
        <FlowGlyph kind={sourceKind} x={sourceX + sourceWidth / 2} y={height / 2} size={compact ? 13 : 28} />
        <FlowGlyph kind="deck" x={deckX + deckWidth / 2} y={height / 2} size={compact ? 13 : 28} />
        {laidOut.map(b => <FlowGlyph key={b.shape} kind={b.kind} x={leafX + leafWidth / 2} y={b.center} size={compact ? 12 : 26} />)}
      </g>
      <text x={trunkX + trunkWidth / 2} y={height / 2 + (compact ? 5 : 11)} textAnchor="middle" fontSize={compact ? 14 : 31} fontWeight="600" fill={flowColor(sourceValue)}>{flowWatts(sourceValue)}</text>
      {laidOut.map(b => <g key={b.shape} textAnchor="end">
        <text x={compact ? endX - 2 : 660} y={b.center - (compact ? 4 : 12)} fontSize={compact ? 8.5 : 13} fill="var(--pt-flow-muted)">{b.label}{b.reverse ? " ←" : ""}</text>
        <text x={compact ? endX - 2 : 660} y={b.center + (compact ? 9 : 16)} fontSize={compact ? 11 : 24} fontWeight="600" fill={flowColor(b.value)}>{flowWatts(b.value, b.kind === "battery")}</text>
      </g>)}
    </svg>
    {caption && <figcaption>{caption}</figcaption>}
  </figure>;
}

export function CorePowerChart({ values }: { values: (number | null)[] }) {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0);
  const maximum = Math.max(1, Math.ceil(Math.max(0, ...finite) * 2) / 2);
  const baseline = 144, plotHeight = 102;
  return <svg viewBox="0 0 740 180" role="img" aria-label="每核平均功率，所有核共用瓦数刻度，不代表利用率" style={{ display: "block", width: "100%", fontVariantNumeric: "tabular-nums", overflow: "visible" }}>
    <g fill="none" stroke="currentColor"><path d="M80 42H730M80 93H730" strokeOpacity=".12" strokeDasharray="3 6" /><path d="M80 144H730" strokeOpacity=".3" /></g>
    <g textAnchor="end" fontSize="12" fill="currentColor" opacity=".72"><text x="66" y="46">{maximum.toFixed(1)} W</text><text x="66" y="97">{(maximum / 2).toFixed(1)}</text><text x="66" y="148">0</text></g>
    {[0, 1, 2, 3].map(index => {
      const value = values[index] ?? null;
      const x = 160 + index * 160, h = value === null ? 0 : value / maximum * plotHeight;
      return <g key={index} textAnchor="middle">
        {value !== null && <rect x={x - 19} y={baseline - h} width="38" height={h} rx="6" fill={flowColor(value)} fillOpacity=".75" />}
        <text x={x} y={baseline - h - 10} fontSize="17" fontWeight="600" fill={flowColor(value)}>{value === null ? "— W" : `${value.toFixed(3)} W`}</text>
        <text x={x} y="170" fontSize="13" fill="currentColor" opacity=".72">核{index}</text>
      </g>;
    })}
  </svg>;
}
