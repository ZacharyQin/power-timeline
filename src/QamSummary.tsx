import { useQuickAccessVisible } from "@decky/api";
import { Focusable, Navigation, PanelSection, PanelSectionRow } from "@decky/ui";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { FaBatteryHalf, FaChartLine, FaExclamationCircle, FaHourglassHalf } from "react-icons/fa";
import { ChargeLimit } from "./QamChargeLimit";
import { getPowerInfo, getTimeline } from "./backend";
import { QueryStatus, Reading, SemanticStyles, SemanticText, SemanticValue, batteryStateText, sessionLabel, supplyText, valueText } from "./components";
import { displayGameName, t, useLocale } from "./i18n";
import { useDocumentVisible, useQuery, useSnapshot } from "./data";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { LocaleFlags } from "./LocaleFlags";
import { GameIcon } from "./GameIcon";
import { rangeBounds, updateView } from "./viewState";
import { PowerFlowChart } from "./PowerFlowChart";
import { QamThermal } from "./QamThermal";
import { QamFanCurve } from "./QamFanCurve";
import { FanControl } from "./FanControl";
import type { PowerInfo } from "./types";
import type { QamBlockId } from "./qamOrder";
import { QamLayout } from "./QamLayout";
function openPage(page: "timeline" | "flow" | "power") {
  updateView(page === "timeline" ? { page } : { page, focus: "back" });
  Navigation.Navigate("/power-timeline");
  Navigation.CloseSideMenus();
}

const openTimeline = () => openPage("timeline");

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
  if (state.toLowerCase() === "full") return <span className="pt-qam-eta pt-qam-eta-full">{t("qam.full")}</span>;
  const seconds = info?.estimate.seconds;
  if (state.toLowerCase() !== "charging" || supply !== "external" || info?.estimate.status !== "available" || seconds == null || seconds <= 0) return <span className="pt-qam-eta pt-qam-eta-empty">—</span>;
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return <span className="pt-qam-eta">
    <span className="pt-qam-eta-approx">{t("qam.about")}</span>
    {hours > 0 && <><span className="pt-qam-eta-num">{hours}</span><span className="pt-qam-eta-unit">{t("qam.hours")}</span></>}
    {(hours === 0 || rest > 0) && <><span className="pt-qam-eta-num">{hours > 0 ? rest : minutes}</span><span className="pt-qam-eta-unit">{t("qam.minutes")}</span></>}
  </span>;
}


export function QamSummary() {
  useLocale();
  const visible = useQuickAccessVisible();
  const documentVisible = useDocumentVisible();
  const enabled = visible && documentVisible;
  const emptyTimelineBounds = useMemo(() => rangeBounds("1d"), [enabled]);
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
  const blocks: Record<QamBlockId, ReactNode> = {
    battery: <Reading padding="standard" icon={FaBatteryHalf} label={sample ? t("qam.battery") : t("qam.noBattery")} description={sample ? batteryStateText(sample.battery_state) : t("qam.recordingStarts")}>
      {sample && <><strong style={{ fontSize: "1.5em" }}><SemanticValue value={sample.battery_percent} unit="%" role="battery" digits={0} /></strong> · {supplyText(sample.supply)}</>}
    </Reading>,
    flow: <PanelSectionRow><Focusable noFocusRing className="pt-qam-chart pt-qam-flow" onActivate={() => openPage("flow")} onOKButton={() => openPage("flow")} onOKActionDescription={t("qam.openFlow")}><PowerFlowChart flow={summary.snapshot?.power_flow ?? null} compact active={enabled} /></Focusable></PanelSectionRow>,
    estimate: showCharge && sample ? <Reading padding="standard" icon={FaHourglassHalf} label={t("qam.eta")}>{qamEstimate(estimate.data ?? contract.data, sample.battery_state, sample.supply)}</Reading> : null,
    "charge-limit": <ChargeLimit active={enabled} percent={sample?.battery_percent ?? null} charging={sample?.battery_state === "Charging"} />,
    timeline: <>
      <Reading padding="standard" icon={FaChartLine} label={t("qam.lastDay")} />
      <PanelSectionRow><TimeSeriesChart timeline={day.data ?? emptyTimelineBounds} compact onOpen={openTimeline} /></PanelSectionRow>
      <QueryStatus padding="standard" loading={false} error={day.error} retry={day.refresh} />
    </>,
    games: <>
      {summary.snapshot?.sessions.length === 0 && <div className="pt-qam-game-empty">{t("qam.noGame")}</div>}
      {summary.snapshot && summary.snapshot.sessions.length > 0 && <div className="pt-qam-games">
        {summary.snapshot.sessions.map((session) => <div className="pt-qam-game" key={session.session_id}>
          <div className="pt-qam-game-head"><GameIcon gameId={session.game_id} /><span className="pt-qam-game-name">{displayGameName(session.name, session.game_id)}</span><span className={`pt-qam-game-status pt-qam-game-status-${session.status}`}>{sessionLabel(session.status)}</span></div>
        </div>)}
      </div>}
    </>,
    thermal: <QamThermal thermals={batteryInfo.data?.thermals ?? null} active={enabled} />,
    fan: <FanControl active={enabled}><QamFanCurve chip={batteryInfo.data?.thermals.chip_c ?? null} ssd={batteryInfo.data?.thermals.ssd_c ?? null} watts={summary.snapshot?.power_flow?.apu_w ?? null} rpm={batteryInfo.data?.thermals.fan_rpm ?? null} open={visible} /></FanControl>,
    specs: <PanelSectionRow>
      {/* @ts-expect-error Steam 导航树要显式 focusable，Decky 的 Focusable 类型没声明这个属性。 */}
      <Focusable className="pt-qam-spec" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "12px 16px" }} tabIndex={0} focusable aria-label={t("qam.specs")} onClick={() => openPage("power")} onOKButton={() => openPage("power")} onOKActionDescription={t("qam.openPower")}>
        <div className="pt-qam-spec-col pt-qam-spec-battery">
          <div className="pt-qam-spec-title">{t("qam.batteryInfo")}</div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">{t("qam.remaining")}</div><div className="pt-qam-spec-value">{battery?.energy_now_wh != null ? qamNumber(battery.energy_now_wh, "Wh") : battery?.charge_now_mah != null ? qamNumber(battery.charge_now_mah, "mAh", 0) : "-"}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">{t("qam.fullEnergy")}</div><div className="pt-qam-spec-value">{battery?.energy_full_wh != null ? qamNumber(battery.energy_full_wh, "Wh") : battery?.charge_full_mah != null ? qamNumber(battery.charge_full_mah, "mAh", 0) : "-"}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">{t("qam.fullDesign")}</div><div className="pt-qam-spec-value">{battery ? battery.energy_full_wh !== null || battery.energy_design_wh !== null ? `${qamNumber(battery.energy_full_wh, "").trimEnd()} / ${qamNumber(battery.energy_design_wh, "Wh")}` : `${qamNumber(battery.charge_full_mah, "", 0).trimEnd()} / ${qamNumber(battery.charge_design_mah, "mAh", 0)}` : "-"}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">{t("qam.ratio")}</div><div className="pt-qam-spec-value">{battery ? qamNumber(battery.capacity_ratio_percent, "%", 1) : "-"}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">{t("qam.cycles")}</div><div className="pt-qam-spec-value">{battery?.cycle_count == null ? "-" : qamNumber(battery.cycle_count, t("qam.cyclesUnit"), 0)}</div></div>
        </div>
        <div className="pt-qam-spec-col pt-qam-spec-power">
          <div className="pt-qam-spec-title">{t("qam.powerSettings")}</div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">{t("qam.voltage")}</div><div className="pt-qam-spec-value">{qamNumber(battery?.voltage_v ?? null, "V", 3)}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">{t("qam.current")}</div><div className="pt-qam-spec-value">{qamNumber(battery?.current_a ?? null, "A", 3)}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">{t("qam.pd")}</div><div className="pt-qam-spec-value">{adapter ? `${qamNumber(adapter.voltage_v, "V")} · ${qamNumber(adapter.current_a, "A")}` : "-"}</div></div>
          <div className="pt-qam-spec-field"><div className="pt-qam-spec-label">{t("qam.pdLimit")}</div><div className="pt-qam-spec-value">{adapter ? qamNumber(adapter.limit_w, "W") : "-"}</div></div>
        </div>
      </Focusable>
    </PanelSectionRow>,
    language: <LocaleFlags />,
  };
  return <div className="pt-qam"><PanelSection>
    <style>{`
      .pt-qam-top { scroll-margin-top: 72px; }
      .pt-qam-chart.gpfocus, .pt-qam-chart.gpfocuswithin, .pt-qam-chart:focus-visible { outline: 1px solid rgba(255, 255, 255, 0.5); outline-offset: 2px; }
      .pt-qam-flow { position: relative; z-index: 0; background: transparent; }
      .pt-qam-flow.gpfocus, .pt-qam-flow.gpfocuswithin, .pt-qam-flow:focus-visible { background: transparent; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.72); outline: none; }

      .pt-qam-spec { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 16px; margin: 0; scroll-margin: 12px 0; }
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
      .pt-qam-games { display: flex; flex-direction: column; gap: 8px; margin: 0; }
      .pt-qam-game { min-width: 0; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, currentColor 6%, transparent); }
      .pt-qam-game-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .pt-qam-game .pt-game-icon { width: 28px; height: 28px; object-fit: contain; flex: none; border-radius: 4px; }
      .pt-qam-game-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 18px; font-weight: 620; }
      .pt-qam-game-status { margin-left: auto; flex: none; font-size: 10px; line-height: 14px; font-weight: 650; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 999px; color: #7BDCC5; background: color-mix(in srgb, #7BDCC5 16%, transparent); }
      .pt-qam-game-status-interrupted { color: #E6D58A; background: color-mix(in srgb, #E6D58A 16%, transparent); }
      .pt-qam-game-status-ended { color: color-mix(in srgb, #fff 62%, transparent); background: color-mix(in srgb, #fff 8%, transparent); }
      .pt-qam-game-empty { margin: 0; font-size: 12px; line-height: 16px; color: color-mix(in srgb, #fff 52%, transparent); }
      .pt-qam-thermal { position: relative; width: 100%; margin: 0; overflow: visible; }
      .pt-qam-thermal-art { position: absolute; left: 0; right: 0; bottom: 0; aspect-ratio: 302.3018755912781 / 122.11307072639465; }
      .pt-qam-thermal-art img { position: absolute; }
      .pt-qam-fan-front { z-index: 2; }
      .pt-qam-rotor { z-index: 3; }
      .pt-qam-thermal-overlay { position: absolute; z-index: 1; transform-origin: 0 0; pointer-events: none; }
      .pt-qam-thermal-overlay > canvas { display: block; }
      .pt-qam-exhaust-buffer { position: absolute; width: 0; height: 0; visibility: hidden; }
      .pt-qam-exhaust { position: absolute; inset: 0; z-index: 4; }
      .pt-qam-exhaust-mask { position: absolute; overflow: hidden; mask-size: 100% 100%; mask-repeat: no-repeat; -webkit-mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; }
      .pt-qam-exhaust-gradient { position: absolute; left: 0; width: 100%; background-image: linear-gradient(to bottom, transparent 0%, var(--flow-color) 18%, transparent 42%, transparent 58%, var(--flow-color) 82%, transparent 100%); background-repeat: repeat-y; will-change: transform; }
      .pt-qam-thermal-leaders { position: absolute; inset: 0; z-index: 5; overflow: visible; pointer-events: none; }
      .pt-qam-thermal-leaders path { fill: none; stroke: #fff; stroke-width: 1; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
      .pt-qam-thermal-leaders circle { fill: #fff; stroke: none; }
      .pt-qam-thermal-tag { position: absolute; z-index: 6; display: flex; flex-direction: column; align-items: center; gap: 1px; transform: translate(-50%, -19.5px); color: #fff; white-space: nowrap; pointer-events: none; }
      .pt-qam-thermal-tag-name, .pt-qam-thermal-tag-value { color: #fff; paint-order: stroke fill; }
      .pt-qam-thermal-tag-name { font-size: 10px; font-weight: 500; line-height: 11px; -webkit-text-stroke: 0.6px #000; }
      .pt-qam-thermal-tag-value { font-size: 13px; font-weight: 650; line-height: 15px; -webkit-text-stroke: 0.9px #000; }
      .pt-qam-fan { margin: 0; }
      .pt-qam-fan-focus.gpfocus, .pt-qam-fan-focus.gpfocuswithin, .pt-qam-fan-focus:focus-visible { outline: 1px solid rgba(255, 255, 255, 0.5); outline-offset: 2px; }
      .pt-qam-fan-legend { display: flex; justify-content: space-between; align-items: center; height: 16px; font-size: 10px; line-height: 16px; }
      .pt-qam-fan-legend span { display: inline-flex; align-items: center; gap: 4px; }
      .pt-qam-fan-legend .off, .pt-qam-fan-read-row.off { opacity: 0.35; }
      .pt-qam-fan-swatch { display: inline-block; width: 10px; height: 0; border-top: 2px solid; }
      .pt-qam-fan-swatch-dash { border-top-style: dashed; }
      .pt-qam-fan svg { display: block; width: 100%; height: 96px; touch-action: pan-y; }
      .pt-qam-fan-read { display: flex; flex-direction: column; justify-content: center; height: 24px; font-variant-numeric: tabular-nums; }
      .pt-qam-fan-read-row { display: flex; align-items: center; gap: 6px; height: 12px; line-height: 12px; }
      .pt-qam-fan-read-name { width: 52px; flex-shrink: 0; font-size: 10px; }
      .pt-qam-fan-read-value { font-size: 11px; font-weight: 500; letter-spacing: -0.2px; }
    `}</style>
    <SemanticStyles />
    <QueryStatus padding="standard" loading={summary.loading && !summary.snapshot} error={summary.error} retry={summary.refresh} />
    {summary.snapshot?.status !== "recording" && summary.snapshot && <Reading padding="standard" icon={FaExclamationCircle} label={summary.snapshot.status === "error" ? <SemanticText role="error">{t("qam.backendDown")}</SemanticText> : t("qam.backendDown")} description={summary.snapshot.error ?? t("qam.stopped")} />}
    <QamLayout blocks={blocks} visible={visible} onFirstFocus={revealQamHeading} />
  </PanelSection></div>;
}
