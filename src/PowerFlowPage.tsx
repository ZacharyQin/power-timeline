import { DialogButtonSecondary, Focusable } from "@decky/ui";
import { useState } from "react";
import { FiBattery, FiChevronDown, FiChevronUp, FiClock, FiCpu, FiGrid, FiInfo, FiLayers, FiMonitor, FiZap } from "react-icons/fi";
import { IconLabel, Restrictions, SemanticValue, batteryStateText, timeText, valueText } from "./components";
import { t } from "./i18n";
import { CorePowerChart, PowerFlowChart, flowColor, flowIsFresh, flowWatts } from "./PowerFlowChart";
import type { PowerFlowReading } from "./types";

export function PowerFlowPage({ flow, visible }: { flow: PowerFlowReading | null; visible: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const current = flowIsFresh(flow) ? flow : null;
  const adapterLimit = current?.pd_voltage_v !== null && current?.pd_current_a !== null && current ? current.pd_voltage_v! * current.pd_current_a! : null;
  return <section className="pt-flow-page">
    <style>{`
      .pt-flow-page .pt-flow-status, .pt-flow-page .pt-flow-disclosure { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px 16px; }
      .pt-flow-page .pt-flow-status { font-size: 14px; line-height: 22px; margin-bottom: 8px; }
      .pt-flow-stage { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 240px); gap: 8px 28px; align-items: center; }
      .pt-flow-stage .pt-flow-chart { width: auto; max-width: 100%; }
      .pt-flow-stage .pt-flow-chart svg { width: auto; max-width: 100%; height: 168px; }
      .pt-flow-readout { display: flex; flex-direction: column; gap: 10px; margin: 0; min-width: 0; }
      .pt-flow-readout div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
      .pt-flow-readout div:last-child { border-bottom: none; padding-bottom: 0; }
      .pt-flow-readout dt { font-size: 12px; line-height: 16px; letter-spacing: 0.04em; opacity: .62; }
      .pt-flow-readout dd { margin: 0; font-size: 18px; line-height: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
      .pt-flow-readout div:first-child dt { font-size: 13px; opacity: .78; }
      .pt-flow-readout div:first-child dd { font-size: 26px; line-height: 30px; }
      @container pt-page (max-width: 719px) { .pt-flow-stage { grid-template-columns: minmax(0, 1fr); } .pt-flow-stage .pt-flow-chart svg { height: 136px; } }
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
    <div className="pt-flow-status"><span>{flow?.mode === "external" ? t("flow.modeExternal") : flow?.mode === "battery" ? t("flow.modeBattery") : t("flow.modeUnknown")} · {batteryStateText(flow?.battery_state ?? "Unknown")}</span><small>{flow ? t("flow.sampled", { time: timeText(flow.timestamp) }) : t("flow.waiting")}</small></div>
    <div className="pt-flow-stage">
      <PowerFlowChart flow={flow} active={visible} />
      <dl className="pt-flow-readout">
        <div><dt>{flow?.mode === "external" ? t("flow.sourceUsb") : flow?.mode === "battery" ? t("flow.sourceBattery") : t("flow.sourceUnknown")}</dt><dd style={{ color: flowColor(current?.mode === "battery" && current.input_w !== null ? -current.input_w : current?.input_w ?? null) }}>{flowWatts(current?.mode === "battery" && current.input_w !== null ? -current.input_w : current?.input_w ?? null)}</dd></div>
        <div><dt>APU</dt><dd style={{ color: flowColor(current?.apu_w ?? null) }}>{flowWatts(current?.apu_w ?? null)}</dd></div>
        <div><dt>{flow?.mode === "external" ? t("flow.peripheralDevices") : t("flow.peripheralPower")}</dt><dd style={{ color: flowColor(current?.peripheral_w ?? null) }}>{flowWatts(current?.peripheral_w ?? null)}</dd></div>
        {flow?.mode === "external" && <div><dt>{(current?.battery_net_w ?? 0) < 0 ? t("flow.batteryAssist") : t("flow.battery")}</dt><dd style={{ color: flowColor(current?.battery_net_w ?? null) }}>{flowWatts(current?.battery_net_w ?? null, true)}</dd></div>}
      </dl>
    </div>
    <div className="pt-flow-disclosure">
      <Focusable><DialogButtonSecondary className="pt-compact-button" aria-expanded={expanded} aria-controls="pt-flow-details" onClick={() => setExpanded(!expanded)}><IconLabel icon={expanded ? FiChevronUp : FiChevronDown}>{expanded ? t("flow.collapse") : t("flow.expand")}</IconLabel></DialogButtonSecondary></Focusable>
      <small>{t("flow.live")}</small>
    </div>
    {expanded && <section id="pt-flow-details" className="pt-flow-details" aria-label={t("flow.details")}>
      <div className="pt-flow-detail-grid">
        <div className="pt-flow-detail"><div className="pt-flow-detail-label"><IconLabel icon={FiZap}>{t("flow.usbRead")}</IconLabel></div><div className="pt-flow-detail-value">{valueText(current?.input_v ?? null, "V", 3)} · {valueText(current?.input_a ?? null, "A", 3)}</div></div>
        <div className="pt-flow-detail"><div className="pt-flow-detail-label"><IconLabel icon={FiBattery}>{t("flow.batteryRead")}</IconLabel></div><div className="pt-flow-detail-value">{valueText(current?.battery_v ?? null, "V", 3)} · {valueText(current?.battery_a ?? null, "A", 3)}</div><small>{t("flow.net", { value: "\u0000" }).split("\u0000")[0]}<span style={{ color: flowColor(current?.battery_net_w ?? null) }}>{flowWatts(current?.battery_net_w ?? null, true)}</span>{t("flow.net", { value: "\u0000" }).split("\u0000")[1]}</small></div>
        <div className="pt-flow-detail"><div className="pt-flow-detail-label"><IconLabel icon={FiZap}>{t("flow.pdLimit")}</IconLabel></div><div className="pt-flow-detail-value">{valueText(current?.pd_voltage_v ?? null, "V", 1)} · {valueText(current?.pd_current_a ?? null, "A", 1)}</div><small>{t("flow.pdNote", { value: valueText(adapterLimit, "W") })}</small></div>
      </div>
      <div className="pt-flow-chip-header"><small><IconLabel icon={FiClock}>{t("flow.rails")}</IconLabel></small><span><IconLabel icon={FiCpu}>APU <SemanticValue value={current?.apu_w ?? null} unit="W" digits={3} /></IconLabel></span></div>
      <div className="pt-flow-detail-grid">{([
        ["cpu", "CPU VDD", FiCpu], ["soc", "SoC", FiLayers], ["gpu", "GPU", FiMonitor],
      ] as const).map(([key, label, icon]) => {
        const rail = current?.rails[key];
        return <div key={key} className="pt-flow-detail"><div className="pt-flow-rail-heading"><IconLabel icon={icon}>{label}</IconLabel><strong><SemanticValue value={rail?.w ?? null} unit="W" digits={3} /></strong></div><small>{valueText(rail?.voltage_v ?? null, "V", 3)} · {valueText(rail?.current_a ?? null, "A", 3)}</small></div>;
      })}</div>
      <div className="pt-flow-core-heading"><strong><IconLabel icon={FiGrid}>{t("flow.cores")}</IconLabel></strong><small>{t("flow.coresNote")}</small></div>
      <CorePowerChart values={current?.cores_w ?? [null, null, null, null]} />
      <p className="pt-muted"><IconLabel icon={FiInfo}>{t("flow.note")}</IconLabel></p>
      <small>{t("flow.meta", { span: valueText(current?.read_span_ms ?? null, "ms", 1), source: current?.apu_source === "gpu_metrics" ? t("flow.sourceGpu") : current?.apu_source === "hwmon" ? t("flow.sourceHwmon") : t("flow.sourceNone") })}</small>
      <Restrictions errors={flow?.errors} label={t("flow.status")} />
    </section>}
  </section>;
}
