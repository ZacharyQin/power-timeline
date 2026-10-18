import { useQuickAccessVisible } from "@decky/api";
import { Focusable, Navigation, PanelSection, PanelSectionRow, Toggle } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FaBatteryHalf, FaBolt, FaChartLine, FaExclamationCircle, FaGamepad, FaHourglassHalf } from "react-icons/fa";
import { getPowerInfo, getTimeline } from "./backend";
import { QueryStatus, Reading, SemanticStyles, SemanticText, SemanticValue, batteryStateText, sessionLabels, supplyText, valueText } from "./components";
import { useDocumentVisible, useQuery, useSnapshot } from "./data";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { updateView } from "./viewState";
import { PowerFlowChart } from "./PowerFlowChart";
import type { PowerInfo } from "./types";

function openPage(page: "timeline" | "flow" | "power") {
  updateView(page === "timeline" ? { page } : { page, focus: "back" });
  Navigation.Navigate("/power-timeline");
  Navigation.CloseSideMenus();
}

function revealQamHeading(node: EventTarget | null) {
  const element = node instanceof HTMLElement ? node : null;
  if (!element) return;
  const show = () => {
    const root = element.closest(".pt-qam");
    const heading = root?.previousElementSibling instanceof HTMLElement ? root.previousElementSibling : root;
    if (!heading) return;
    let parent = heading.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
        const hidden = heading.getBoundingClientRect().top - parent.getBoundingClientRect().top;
        if (hidden < 12) parent.scrollTop += hidden - 12;
        return;
      }
      parent = parent.parentElement;
    }
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(show));
}

function qamNumber(value: number | null, unit: string, digits = 1) {
  return value === null ? "-" : valueText(value, unit, digits);
}

function qamEstimate(info: PowerInfo | null, state: string, supply: string) {
  if (state.toLowerCase() === "full") return <span className="pt-qam-eta pt-qam-eta-full">已充满</span>;
  const seconds = info?.estimate.seconds;
  if (state.toLowerCase() !== "charging" || supply !== "external" || info?.estimate.status !== "available" || seconds == null || seconds <= 0) return <span className="pt-qam-eta pt-qam-eta-empty">—</span>;
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return <span className="pt-qam-eta">
    <span className="pt-qam-eta-approx">约</span>
    {hours > 0 && <><span className="pt-qam-eta-num">{hours}</span><span className="pt-qam-eta-unit">小时</span></>}
    {(hours === 0 || rest > 0) && <><span className="pt-qam-eta-num">{hours > 0 ? rest : minutes}</span><span className="pt-qam-eta-unit">分钟</span></>}
  </span>;
}

type ClientSettingWriter = (value: boolean | number) => void;

function readClientSetting(key: string): [unknown, ClientSettingWriter | null] {
  const host: object = globalThis;
  if (!("settingsStore" in host)) return [undefined, null];
  const store = host.settingsStore;
  if (!store || typeof store !== "object" || !("GetClientSetting" in store) || typeof store.GetClientSetting !== "function") return [undefined, null];
  try {
    const result = store.GetClientSetting(key);
    if (!Array.isArray(result)) return [undefined, null];
    const [value, write] = result;
    // Steam 的 setter 是元组第二项，运行时只能确认它是函数。
    const writeSetting: ClientSettingWriter | null = typeof write === "function" ? write : null;
    return [value, writeSetting];
  } catch {
    return [undefined, null];
  }
}

function ChargeLimitToggle({ active }: { active: boolean }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const write = useRef<ClientSettingWriter | null>(null);
  const pending = useRef<{ value: boolean; until: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    const read = () => {
      const [enabled, setEnabled] = readClientSetting("steamos_charge_limit_enabled");
      const [percent] = readClientSetting("steamos_charge_limit");
      if (setEnabled) write.current = setEnabled;
      if (pending.current && Date.now() < pending.current.until && enabled !== pending.current.value) return;
      pending.current = null;
      setOn(typeof enabled === "boolean" ? enabled : null);
      setLimit(typeof percent === "number" ? percent : null);
    };
    read();
    const timer = window.setInterval(read, 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (on === null || !write.current) return null;
  return <PanelSectionRow>
    <Focusable className="pt-qam-limit">
      <div className="pt-qam-limit-copy">
        <div className="pt-qam-limit-title"><FaBolt aria-hidden="true" />充电限制</div>
        <div className="pt-qam-limit-note">{on ? `充到 ${limit ?? "—"}% 停止` : "当前不限制，可充满"}</div>
      </div>
      <Toggle aria-label="充电限制" value={on} onChange={(value) => { pending.current = { value, until: Date.now() + 3000 }; setOn(value); write.current?.(value); }} />
    </Focusable>
  </PanelSectionRow>;
}

export function QamSummary() {
  const visible = useQuickAccessVisible();
  const documentVisible = useDocumentVisible();
  const enabled = visible && documentVisible;
  const summary = useSnapshot(enabled);
  const day = useQuery("qam-battery-24h", () => {
    const end = Date.now() / 1000;
    return getTimeline(end - 86400, end, 288, 300);
  }, enabled, 30000);
  const sample = summary.snapshot?.sample;
  const showCharge = sample?.supply === "external" && (sample.battery_state === "Charging" || sample.battery_state === "Full" || sample.battery_state === "Not charging");
  const chargingNow = sample?.supply === "external" && sample.battery_state === "Charging";
  const batteryInfo = useQuery("qam-battery-info", () => getPowerInfo(false), enabled, 5000);
  const contract = useQuery("qam-charge-contract", () => getPowerInfo(true), enabled && chargingNow, 0);
  const estimate = useQuery("qam-charge-estimate", () => getPowerInfo(false), enabled && chargingNow, 15000);
  const battery = batteryInfo.data?.battery;
  const adapter = contract.data?.adapter;
  return <div className="pt-qam"><PanelSection>
    <style>{`
      .pt-qam-top { scroll-margin-top: 72px; }
      .pt-qam-chart.gpfocus, .pt-qam-chart.gpfocuswithin, .pt-qam-chart:focus-visible { outline: 1px solid rgba(255, 255, 255, 0.5); outline-offset: 2px; }
      .pt-qam-flow { position: relative; z-index: 0; background: transparent; }
      .pt-qam-flow.gpfocus, .pt-qam-flow.gpfocuswithin, .pt-qam-flow:focus-visible { background: transparent; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.72); outline: none; }
      .pt-qam-limit { position: relative; z-index: 1; background: transparent; }
      .pt-qam-spec { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 16px; margin: 10px 0 6px; scroll-margin: 12px 0; }
      .pt-qam-spec-col { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
      .pt-qam-spec-battery { --pt-spec-accent: #7BDCC5; }
      .pt-qam-spec-power { --pt-spec-accent: #E6D58A; }
      .pt-qam-spec-title { font-size: 11px; line-height: 14px; font-weight: 650; letter-spacing: 0.06em; color: var(--pt-spec-accent); padding-bottom: 4px; border-bottom: 1px solid color-mix(in srgb, var(--pt-spec-accent) 55%, transparent); }
      .pt-qam-spec.gpfocus, .pt-qam-spec.gpfocuswithin, .pt-qam-spec:focus-visible { outline: 1px solid rgba(255, 255, 255, 0.72); outline-offset: 4px; background: color-mix(in srgb, #fff 7%, transparent); }
      .pt-qam-spec-model { margin-top: -4px; font-size: 10px; line-height: 13px; color: color-mix(in srgb, #fff 58%, transparent); }
      .pt-qam-spec-field { min-width: 0; }
      .pt-qam-spec-label { font-size: 10px; line-height: 13px; color: color-mix(in srgb, #fff 52%, transparent); }
      .pt-qam-spec-value { font-size: 14px; line-height: 18px; font-weight: 620; font-variant-numeric: tabular-nums; color: #fff; }
      .pt-qam-eta { display: inline-flex; align-items: baseline; gap: 1px 2px; font-variant-numeric: tabular-nums; }
      .pt-qam-eta-approx { margin-right: 3px; font-size: 11px; line-height: 14px; font-weight: 550; letter-spacing: 0.06em; color: color-mix(in srgb, #7BDCC5 62%, #fff); }
      .pt-qam-eta-num { font-size: 18px; line-height: 22px; font-weight: 680; color: #7BDCC5; }
      .pt-qam-eta-unit { margin-right: 3px; font-size: 11px; line-height: 14px; font-weight: 550; color: color-mix(in srgb, #fff 68%, #7BDCC5); }
      .pt-qam-eta-full { font-size: 14px; line-height: 18px; font-weight: 650; letter-spacing: 0.04em; color: #7BDCC5; }
      .pt-qam-eta-empty { font-size: 16px; line-height: 20px; color: color-mix(in srgb, #fff 42%, transparent); }
      .pt-qam-limit { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
      .pt-qam-limit-copy { min-width: 0; }
      .pt-qam-limit-title { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; }
      .pt-qam-limit-note { font-size: 11px; line-height: 15px; color: color-mix(in srgb, #fff 62%, transparent); }
    `}</style>
    <SemanticStyles />
    <QueryStatus padding="standard" loading={summary.loading && !summary.snapshot} error={summary.error} retry={summary.refresh} />
    <Reading className="pt-qam-top" padding="standard" icon={FaBatteryHalf} label={sample ? "电量" : "尚未采到电池样本"} description={sample ? batteryStateText(sample.battery_state) : "启用后从当前时刻开始记录。"} onGamepadFocus={(event) => revealQamHeading(event.currentTarget)}>
      {sample && <><strong style={{ fontSize: "1.5em" }}><SemanticValue value={sample.battery_percent} unit="%" role="battery" digits={0} /></strong> · {supplyText(sample.supply)}</>}
    </Reading>
    <PanelSectionRow><Focusable noFocusRing className="pt-qam-chart pt-qam-flow pt-qam-top" preferredFocus onGamepadFocus={(event) => revealQamHeading(event.currentTarget)} onActivate={() => openPage("flow")} onOKButton={() => openPage("flow")} onOKActionDescription="查看功率流"><PowerFlowChart flow={summary.snapshot?.power_flow ?? null} compact active={enabled} /></Focusable></PanelSectionRow>
    {showCharge && sample && <Reading padding="standard" icon={FaHourglassHalf} label="预计充满">{qamEstimate(estimate.data ?? contract.data, sample.battery_state, sample.supply)}</Reading>}
    <ChargeLimitToggle active={enabled} />

    <Reading padding="standard" icon={FaChartLine} label="最近 24 小时" />
    {day.data && <PanelSectionRow><TimeSeriesChart timeline={day.data} compact onOpen={() => openPage("timeline")} /></PanelSectionRow>}
    <QueryStatus padding="standard" loading={day.loading && !day.data} error={day.error} retry={day.refresh} />
    {summary.snapshot?.status !== "recording" && summary.snapshot && <Reading padding="standard" icon={FaExclamationCircle} label={summary.snapshot.status === "error" ? <SemanticText role="error">后台未正常记录</SemanticText> : "后台未正常记录"} description={summary.snapshot.error ?? "记录已停止"} />}
    {summary.snapshot?.sessions.length === 0 && <Reading padding="standard" icon={FaGamepad} label="当前未发现游戏进程" />}
    {summary.snapshot?.sessions.map((session) => <Reading padding="standard" icon={FaGamepad} key={session.session_id} label={session.name} description={<>{session.status === "interrupted" ? <SemanticText role="warning">{sessionLabels[session.status]}</SemanticText> : sessionLabels[session.status]} · 整机伴随 / 游戏进程估算分开统计</>}>整机 <SemanticValue value={session.system_wh} unit="Wh" role="system" /> · CPU + GPU 估算 <SemanticValue value={session.process_wh} unit="Wh" role="process" /></Reading>)}
    <PanelSectionRow>
      {/* @ts-expect-error Steam 导航树要显式 focusable，Decky 的 Focusable 类型没声明这个属性。 */}
      <Focusable className="pt-qam-spec" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "12px 16px" }} tabIndex={0} focusable aria-label="电池信息与电源参数" onClick={() => openPage("power")} onOKButton={() => openPage("power")} onOKActionDescription="查看电源与电池">
        <div className="pt-qam-spec-col pt-qam-spec-battery">
          <div className="pt-qam-spec-title">电池信息</div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">剩余容量</div><div className="pt-qam-spec-value">{battery?.energy_now_wh != null ? qamNumber(battery.energy_now_wh, "Wh") : battery?.charge_now_mah != null ? qamNumber(battery.charge_now_mah, "mAh", 0) : "-"}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">当前满充能量</div><div className="pt-qam-spec-value">{battery?.energy_full_wh != null ? qamNumber(battery.energy_full_wh, "Wh") : battery?.charge_full_mah != null ? qamNumber(battery.charge_full_mah, "mAh", 0) : "-"}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">满充 / 设计</div><div className="pt-qam-spec-value">{battery ? battery.energy_full_wh !== null || battery.energy_design_wh !== null ? `${qamNumber(battery.energy_full_wh, "").trimEnd()} / ${qamNumber(battery.energy_design_wh, "Wh")}` : `${qamNumber(battery.charge_full_mah, "", 0).trimEnd()} / ${qamNumber(battery.charge_design_mah, "mAh", 0)}` : "-"}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">容量比</div><div className="pt-qam-spec-value">{battery ? qamNumber(battery.capacity_ratio_percent, "%", 1) : "-"}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">循环</div><div className="pt-qam-spec-value">{battery?.cycle_count == null ? "-" : qamNumber(battery.cycle_count, "次", 0)}</div></div>
        </div>
        <div className="pt-qam-spec-col pt-qam-spec-power">
          <div className="pt-qam-spec-title">电源参数</div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">电池电压</div><div className="pt-qam-spec-value">{qamNumber(battery?.voltage_v ?? null, "V", 3)}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">电池电流</div><div className="pt-qam-spec-value">{qamNumber(battery?.current_a ?? null, "A", 3)}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">PD 契约</div><div className="pt-qam-spec-value">{adapter ? `${qamNumber(adapter.voltage_v, "V")} · ${qamNumber(adapter.current_a, "A")}` : "-"}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">协商上限</div><div className="pt-qam-spec-value">{adapter ? qamNumber(adapter.limit_w, "W") : "-"}</div></div>
        </div>
      </Focusable>
    </PanelSectionRow>
  </PanelSection></div>;
}
