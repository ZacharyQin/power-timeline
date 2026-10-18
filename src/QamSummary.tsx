import { useQuickAccessVisible } from "@decky/api";
import { Focusable, Navigation, PanelSection, PanelSectionRow, Toggle } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FaBatteryHalf, FaBolt, FaChartLine, FaExclamationCircle, FaHourglassHalf } from "react-icons/fa";
import { getPowerInfo, getTimeline } from "./backend";
import { QueryStatus, Reading, SemanticStyles, SemanticText, SemanticValue, batteryStateText, sessionLabel, supplyText, valueText } from "./components";
import { displayGameName, t, useLocale } from "./i18n";
import { useDocumentVisible, useQuery, useSnapshot } from "./data";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { LocaleFlags } from "./LocaleFlags";
import { GameIcon } from "./GameIcon";
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
        <div className="pt-qam-limit-title"><FaBolt aria-hidden="true" />{t("qam.chargeLimit")}</div>
        <div className="pt-qam-limit-note">{on ? t("qam.chargeStop", { limit: limit ?? "—" }) : t("qam.chargeUnlimited")}</div>
      </div>
      <Toggle aria-label={t("qam.chargeLimit")} value={on} onChange={(value) => { pending.current = { value, until: Date.now() + 3000 }; setOn(value); write.current?.(value); }} />
    </Focusable>
  </PanelSectionRow>;
}

export function QamSummary() {
  useLocale();
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
      .pt-qam-games { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 4px; }
      .pt-qam-game { min-width: 0; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, currentColor 6%, transparent); }
      .pt-qam-game-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .pt-qam-game .pt-game-icon { width: 28px; height: 28px; object-fit: contain; flex: none; border-radius: 4px; }
      .pt-qam-game-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 18px; font-weight: 620; }
      .pt-qam-game-status { margin-left: auto; flex: none; font-size: 10px; line-height: 14px; font-weight: 650; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 999px; color: #7BDCC5; background: color-mix(in srgb, #7BDCC5 16%, transparent); }
      .pt-qam-game-status-interrupted { color: #E6D58A; background: color-mix(in srgb, #E6D58A 16%, transparent); }
      .pt-qam-game-status-ended { color: color-mix(in srgb, #fff 62%, transparent); background: color-mix(in srgb, #fff 8%, transparent); }
      .pt-qam-game-empty { margin: 6px 0 2px; font-size: 12px; line-height: 16px; color: color-mix(in srgb, #fff 52%, transparent); }
    `}</style>
    <SemanticStyles />
    <QueryStatus padding="standard" loading={summary.loading && !summary.snapshot} error={summary.error} retry={summary.refresh} />
    <Reading className="pt-qam-top" padding="standard" icon={FaBatteryHalf} label={sample ? t("qam.battery") : t("qam.noBattery")} description={sample ? batteryStateText(sample.battery_state) : t("qam.recordingStarts")} onGamepadFocus={(event) => revealQamHeading(event.currentTarget)}>
      {sample && <><strong style={{ fontSize: "1.5em" }}><SemanticValue value={sample.battery_percent} unit="%" role="battery" digits={0} /></strong> · {supplyText(sample.supply)}</>}
    </Reading>
    <PanelSectionRow><Focusable noFocusRing className="pt-qam-chart pt-qam-flow pt-qam-top" preferredFocus onGamepadFocus={(event) => revealQamHeading(event.currentTarget)} onActivate={() => openPage("flow")} onOKButton={() => openPage("flow")} onOKActionDescription={t("qam.openFlow")}><PowerFlowChart flow={summary.snapshot?.power_flow ?? null} compact active={enabled} /></Focusable></PanelSectionRow>
    {showCharge && sample && <Reading padding="standard" icon={FaHourglassHalf} label={t("qam.eta")}>{qamEstimate(estimate.data ?? contract.data, sample.battery_state, sample.supply)}</Reading>}
    <ChargeLimitToggle active={enabled} />

    <Reading padding="standard" icon={FaChartLine} label={t("qam.lastDay")} />
    {day.data && <PanelSectionRow><TimeSeriesChart timeline={day.data} compact onOpen={() => openPage("timeline")} /></PanelSectionRow>}
    <QueryStatus padding="standard" loading={day.loading && !day.data} error={day.error} retry={day.refresh} />
    {summary.snapshot?.status !== "recording" && summary.snapshot && <Reading padding="standard" icon={FaExclamationCircle} label={summary.snapshot.status === "error" ? <SemanticText role="error">{t("qam.backendDown")}</SemanticText> : t("qam.backendDown")} description={summary.snapshot.error ?? t("qam.stopped")} />}
    {summary.snapshot?.sessions.length === 0 && <div className="pt-qam-game-empty">{t("qam.noGame")}</div>}
    {summary.snapshot && summary.snapshot.sessions.length > 0 && <div className="pt-qam-games">
      {summary.snapshot.sessions.map((session) => <div className="pt-qam-game" key={session.session_id}>
        <div className="pt-qam-game-head"><GameIcon gameId={session.game_id} /><span className="pt-qam-game-name">{displayGameName(session.name, session.game_id)}</span><span className={`pt-qam-game-status pt-qam-game-status-${session.status}`}>{sessionLabel(session.status)}</span></div>
      </div>)}
    </div>}
    <PanelSectionRow>
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
    </PanelSectionRow>
    <LocaleFlags />
  </PanelSection></div>;
}
