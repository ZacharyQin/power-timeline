import { DialogButtonSecondary, Focusable } from "@decky/ui";
import { useState } from "react";
import { FiBattery, FiChevronDown, FiChevronUp, FiClock, FiCpu, FiGrid, FiInfo, FiLayers, FiMonitor, FiZap } from "react-icons/fi";
import { IconLabel, Restrictions, SemanticValue, batteryStateText, timeText, valueText } from "./components";
import { CorePowerChart, PowerFlowChart, flowColor, flowIsFresh, flowWatts } from "./PowerFlowChart";
import type { PowerFlowReading } from "./types";

export function PowerFlowPage({ flow, visible }: { flow: PowerFlowReading | null; visible: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const current = flowIsFresh(flow) ? flow : null;
  const adapterLimit = current?.pd_voltage_v !== null && current?.pd_current_a !== null && current ? current.pd_voltage_v! * current.pd_current_a! : null;
  return <section className="pt-flow-page">
    <style>{`
      .pt-flow-page .pt-flow-status, .pt-flow-page .pt-flow-disclosure { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px 16px; }
      .pt-flow-page .pt-flow-status { font-size: 14px; line-height: 22px; margin-bottom: 4px; }
      .pt-flow-page .pt-flow-disclosure { margin-top: 12px; border-top: 1px solid var(--pt-border); padding-top: 8px; }
      .pt-flow-page .pt-flow-disclosure .pt-compact-button:not(.gpfocus):not(:focus-visible) { background: transparent; box-shadow: none; }
      .pt-flow-details { padding-top: 16px; }
      .pt-flow-detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px 28px; }
      .pt-flow-detail { min-width: 0; }
      .pt-flow-detail-label { font-size: 13px; line-height: 20px; opacity: .78; }
      .pt-flow-detail-value { font-size: 18px; line-height: 26px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 6px; overflow-wrap: anywhere; }
      .pt-flow-chip-header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px 20px; margin: 20px 0 16px; padding-top: 16px; border-top: 1px solid var(--pt-border); }
      .pt-flow-rail-heading { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; font-size: 15px; }
      .pt-flow-rail-heading strong { font-size: 20px; }
      .pt-flow-core-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px 20px; margin: 20px 0 8px; }
      .pt-flow-page small { font-size: 13px; line-height: 20px; opacity: .78; }
      @container pt-page (max-width: 719px) { .pt-flow-detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; } }
      @container pt-page (max-width: 479px) { .pt-flow-detail-grid { grid-template-columns: minmax(0, 1fr); } }
    `}</style>
    <div className="pt-flow-status"><span>{flow?.mode === "external" ? "USB-C外接供电" : flow?.mode === "battery" ? "电池独立供电" : "供电状态待确认"} · {batteryStateText(flow?.battery_state ?? "Unknown")}</span><small>{flow ? `采样 ${timeText(flow.timestamp)}` : "等待后台首次采样"}</small></div>
    <PowerFlowChart flow={flow} active={visible} />
    <div className="pt-flow-disclosure">
      <Focusable><DialogButtonSecondary className="pt-compact-button" aria-expanded={expanded} aria-controls="pt-flow-details" onClick={() => setExpanded(!expanded)}><IconLabel icon={expanded ? FiChevronUp : FiChevronDown}>{expanded ? "收起节点详情" : "展开节点详情"}</IconLabel></DialogButtonSecondary></Focusable>
      <small>实时读取 · 不从图线重算能量</small>
    </div>
    {expanded && <section id="pt-flow-details" className="pt-flow-details" aria-label="功率流节点详情">
      <div className="pt-flow-detail-grid">
        <div className="pt-flow-detail"><div className="pt-flow-detail-label"><IconLabel icon={FiZap}>USB-C 实读</IconLabel></div><div className="pt-flow-detail-value">{valueText(current?.input_v ?? null, "V", 3)} · {valueText(current?.input_a ?? null, "A", 3)}</div></div>
        <div className="pt-flow-detail"><div className="pt-flow-detail-label"><IconLabel icon={FiBattery}>电池端实读</IconLabel></div><div className="pt-flow-detail-value">{valueText(current?.battery_v ?? null, "V", 3)} · {valueText(current?.battery_a ?? null, "A", 3)}</div><small>净功率 <span style={{ color: flowColor(current?.battery_net_w ?? null) }}>{flowWatts(current?.battery_net_w ?? null, true)}</span>（＋充入／−放出）</small></div>
        <div className="pt-flow-detail"><div className="pt-flow-detail-label"><IconLabel icon={FiZap}>PD协商上限</IconLabel></div><div className="pt-flow-detail-value">{valueText(current?.pd_voltage_v ?? null, "V", 1)} · {valueText(current?.pd_current_a ?? null, "A", 1)}</div><small>{valueText(adapterLimit, "W")} 上限，不是实时输入</small></div>
      </div>
      <div className="pt-flow-chip-header"><small><IconLabel icon={FiClock}>同批读取芯片平均报告，平均窗口不等于完全同步</IconLabel></small><span><IconLabel icon={FiCpu}>APU <SemanticValue value={current?.apu_w ?? null} unit="W" digits={3} /></IconLabel></span></div>
      <div className="pt-flow-detail-grid">{([
        ["cpu", "CPU VDD", FiCpu], ["soc", "SoC", FiLayers], ["gpu", "GPU", FiMonitor],
      ] as const).map(([key, label, icon]) => {
        const rail = current?.rails[key];
        return <div key={key} className="pt-flow-detail"><div className="pt-flow-rail-heading"><IconLabel icon={icon}>{label}</IconLabel><strong><SemanticValue value={rail?.w ?? null} unit="W" digits={3} /></strong></div><small>{valueText(rail?.voltage_v ?? null, "V", 3)} · {valueText(rail?.current_a ?? null, "A", 3)}</small></div>;
      })}</div>
      <div className="pt-flow-core-heading"><strong><IconLabel icon={FiGrid}>每核功率</IconLabel></strong><small>同一瓦数刻度 · 不是利用率</small></div>
      <CorePowerChart values={current?.cores_w ?? [null, null, null, null]} />
      <p className="pt-muted"><IconLabel icon={FiInfo}>外围为输入减电池净充与APU的差额（电池独立放电时为电池输出减APU），包含转换损耗、未覆盖负载和平均窗口差；不是外围独立电表读数。四核和芯片轨不强制配平。</IconLabel></p>
      {current?.difference_w !== null && current?.peripheral_w === null && <p className="pt-muted">原始差额 {valueText(current?.difference_w ?? null, "W")}；当前分项不能可靠分解，未裁成零或补造负载。</p>}
      <small>读取窗口 {valueText(current?.read_span_ms ?? null, "ms", 1)} · APU来源 {current?.apu_source === "gpu_metrics" ? "AMDGPU gpu_metrics" : current?.apu_source === "hwmon" ? "AMDGPU hwmon" : "未上报"} · 未做外接功率计校准</small>
      <Restrictions errors={flow?.errors} label="功率流数据状态" />
    </section>}
  </section>;
}
