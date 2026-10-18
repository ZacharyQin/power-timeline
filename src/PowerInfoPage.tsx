import { DialogButtonSecondary, Focusable } from "@decky/ui";
import { useState } from "react";
import { FaBatteryHalf, FaBolt, FaChevronDown, FaChevronUp, FaClock } from "react-icons/fa";
import { getPowerInfo } from "./backend";
import { IconLabel, Restrictions, SemanticText, SemanticValue, batteryStateText, reasonText, supplyText, timeText, valueText } from "./components";
import { t } from "./i18n";
import { useQuery } from "./data";
import { PageQueryStatus, PageReading } from "./FullPage";
import { chargeEstimateText, lastChargeReason, lastChargeText } from "./powerStatus";

function capacityText(charge: number | null, energy: number | null) {
  if (charge === null) return energy === null ? t("common.notReported") : valueText(energy, "Wh");
  return `${valueText(charge, "mAh", 0)}${energy === null ? "" : ` · ${valueText(energy, "Wh")}`}`;
}

export function PowerInfoPage({ visible }: { visible: boolean }) {
  const query = useQuery("power-info", getPowerInfo, visible);
  const [expanded, setExpanded] = useState(false);
  const info = query.data;
  const battery = info?.battery;
  const charging = battery?.state === "Charging";
  const chargeReason = info && !charging ? lastChargeReason(info) : undefined;
  return <>
    <style>{`
      .pt-fullpage.pt-power-page .pt-page-header { margin-bottom: 10px; }
      .pt-fullpage.pt-power-page .pt-page-footer { margin-top: 0; padding-top: 0; border-top: 0; }
      .pt-fullpage.pt-power-page .pt-page-footer .pt-muted { margin: 0; }
      .pt-fullpage .pt-power-info { display: flex; flex-direction: column; gap: 10px; }
      .pt-fullpage .pt-power-summary { display: grid; grid-template-columns: 1.1fr 1fr 1.1fr; gap: 12px; padding: 10px 14px; border: 1px solid var(--pt-border); border-radius: 8px; background: var(--pt-surface); }
      .pt-fullpage .pt-power-metric { min-width: 0; }
      .pt-fullpage .pt-power-metric + .pt-power-metric { padding-left: 12px; border-left: 1px solid var(--pt-border); }
      .pt-fullpage .pt-power-metric-label { display: block; font-size: 13px; line-height: 18px; opacity: .78; }
      .pt-fullpage .pt-power-metric-value { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-top: 4px; min-height: 32px; font-size: 28px; line-height: 32px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      .pt-fullpage .pt-power-timing { font-size: 23px; }
      .pt-fullpage .pt-power-metric-note { font-size: 13px; line-height: 18px; font-weight: 400; }
      .pt-fullpage .pt-power-cards, .pt-fullpage .pt-power-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; }
      .pt-fullpage .pt-power-card { min-width: 0; padding: 10px 14px; border: 1px solid var(--pt-border); border-radius: 8px; }
      .pt-fullpage .pt-power-card-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 0 0 6px; }
      .pt-fullpage .pt-power-card-heading h2 { margin: 0; font-size: 15px; line-height: 20px; font-weight: 600; }
      .pt-fullpage .pt-power-model { font-size: 13px; line-height: 18px; opacity: .78; overflow-wrap: anywhere; }
      .pt-fullpage .pt-power-info .pt-reading { margin: 0; min-height: 24px; gap: 4px 12px; }
      .pt-fullpage .pt-power-info .pt-reading-value { font-size: 14px; line-height: 22px; overflow-wrap: anywhere; text-align: right; }
      .pt-fullpage .pt-power-charge { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 16px; padding: 8px 14px; border-radius: 6px; background: var(--pt-surface); font-size: 14px; line-height: 20px; }
      .pt-fullpage .pt-power-charge-value { margin-left: auto; font-variant-numeric: tabular-nums; }
      .pt-fullpage .pt-power-charge-note { flex-basis: 100%; font-size: 13px; line-height: 18px; }
      .pt-fullpage .pt-power-disclosure { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; border-top: 1px solid var(--pt-border); }
      .pt-fullpage .pt-power-disclosure .pt-compact-button:not(.gpfocus):not(:focus-visible) { background: transparent; box-shadow: none; }
      .pt-fullpage .pt-power-updated { font-size: 13px; line-height: 18px; opacity: .78; }
      .pt-fullpage .pt-power-alert { margin: 0; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
      .pt-fullpage .pt-power-details { padding: 12px 14px; border: 1px solid var(--pt-border); border-radius: 8px; }
      .pt-fullpage .pt-power-details p { margin: 10px 0 0; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
      @container pt-page (max-width: 719px) {
        .pt-fullpage .pt-power-cards, .pt-fullpage .pt-power-detail-grid { grid-template-columns: minmax(0, 1fr); }
        .pt-fullpage .pt-power-summary { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        .pt-fullpage .pt-power-metric:last-child { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--pt-border); padding: 8px 0 0; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
        .pt-fullpage .pt-power-metric:last-child .pt-power-metric-value { margin-top: 0; }
      }
    `}</style>
    <PageQueryStatus loading={query.loading && !info} error={query.error} retry={query.refresh} />
    {info && battery && <div className="pt-power-info">
      {Date.now() / 1000 - info.timestamp > 10 && <p className="pt-power-alert" role="status"><SemanticText role="warning">{t("common.infoStale")}</SemanticText></p>}
      <section className="pt-power-summary" aria-label={t("power.summary")}>
        <div className="pt-power-metric">
          <span className="pt-power-metric-label">{t("power.level")}</span>
          <div className="pt-power-metric-value"><SemanticValue value={battery.percent} unit="%" role="battery" digits={0} /><span className="pt-power-metric-note">{batteryStateText(battery.state)} · {supplyText(battery.supply)}</span></div>
        </div>
        <div className="pt-power-metric">
          <span className="pt-power-metric-label">{charging ? t("power.netCharge") : t("power.netBattery")}</span>
          <div className="pt-power-metric-value"><SemanticValue value={battery.net_w} unit="W" /><span className="pt-power-metric-note">{battery.system_w === null ? battery.supply === "external" ? t("power.pluggedUnknown") : t("power.systemUnknown") : <>{t("power.systemInline")} <SemanticValue value={battery.system_w} unit="W" /></>}</span></div>
        </div>
        <div className="pt-power-metric">
          <span className="pt-power-metric-label">{charging ? t("power.eta") : t("power.sinceCharge")}</span>
          <div className="pt-power-metric-value pt-power-timing">{charging ? chargeEstimateText(info, battery.state, battery.supply, info.timestamp) : lastChargeText(info)}</div>
        </div>
      </section>
      {info.errors.system_w && <p className="pt-power-alert" role="status"><SemanticText role="warning">{t("power.systemReason", { reason: reasonText(info.errors.system_w) })}</SemanticText></p>}
      {info.estimate.error && <p className="pt-power-alert" role="status"><SemanticText role="warning">{t("power.upowerFail")}</SemanticText></p>}
      <div className="pt-power-cards">
        <section className="pt-power-card" aria-label={t("power.profile")}>
          <header className="pt-power-card-heading"><h2><IconLabel icon={FaBatteryHalf}>{t("power.profile")}</IconLabel></h2><span className="pt-power-model">{battery.model ?? t("power.modelUnknown")}</span></header>
          <PageReading label={`${t("power.fullDesign")}${battery.energy_basis === "design_voltage" ? t("power.converted") : battery.energy_basis === "mixed" ? t("power.mixed") : ""}`}>
            {battery.energy_full_wh !== null || battery.energy_design_wh !== null ? <>{valueText(battery.energy_full_wh, "").trimEnd()} / {valueText(battery.energy_design_wh, "Wh")}</> : <>{valueText(battery.charge_full_mah, "", 0).trimEnd()} / {valueText(battery.charge_design_mah, "mAh", 0)}</>}
          </PageReading>
          <PageReading label={t("power.ratio")}>{valueText(battery.capacity_ratio_percent, "%", 1)}</PageReading>
          <PageReading label={t("power.cycles")}>{battery.cycle_count === null ? t("power.cyclesUnknown") : valueText(battery.cycle_count, t("power.cyclesUnit"), 0)}</PageReading>
        </section>
        <section className="pt-power-card" aria-label={t("power.settings")}>
          <header className="pt-power-card-heading"><h2><IconLabel icon={FaBolt}>{t("power.settings")}</IconLabel></h2></header>
          <PageReading label={t("power.pd")}>{valueText(info.adapter.voltage_v, "V", 1)} · {valueText(info.adapter.current_a, "A", 1)}</PageReading>
          <PageReading label={t("power.pdLimit")}>{t("power.notMeasured", { value: valueText(info.adapter.limit_w, "W", 1) })}</PageReading>
          <PageReading label={t("power.voltageCurrent")}>{valueText(battery.voltage_v, "V")} · {valueText(battery.current_a, "A")}</PageReading>
        </section>
      </div>
      <div className="pt-power-charge" aria-label={t("power.chargeLog")}>
        <IconLabel icon={FaClock}>{t("power.chargeLog")}</IconLabel>
        <span className="pt-power-charge-value">{charging ? t("power.chargingNow") : info.last_charge.ended_at === null ? t("power.chargeEndUnknown") : t("power.lastEnded", { time: timeText(info.last_charge.ended_at, true) })}</span>
        {chargeReason && <span className="pt-power-charge-note">{chargeReason}</span>}
      </div>
      <div className="pt-power-disclosure">
        <Focusable><DialogButtonSecondary className="pt-compact-button" aria-expanded={expanded} aria-controls="pt-power-details" onClick={() => setExpanded(!expanded)}><IconLabel icon={expanded ? FaChevronUp : FaChevronDown}>{expanded ? t("power.less") : t("power.more")}</IconLabel></DialogButtonSecondary></Focusable>
        <span className="pt-power-updated">{t("power.readAt", { time: timeText(info.timestamp) })}</span>
      </div>
      {expanded && <section id="pt-power-details" className="pt-power-details" aria-label={t("power.details")}>
        <div className="pt-power-detail-grid">
          <PageReading label={t("power.remaining")}>{capacityText(battery.charge_now_mah, battery.energy_now_wh)}</PageReading>
          <PageReading label={t("power.systemCapacity")}>{valueText(battery.system_capacity_percent, "%", 0)}</PageReading>
          <PageReading label={t("power.fullNow")}>{capacityText(battery.charge_full_mah, battery.energy_full_wh)}</PageReading>
          <PageReading label={t("power.design")}>{capacityText(battery.charge_design_mah, battery.energy_design_wh)}</PageReading>
          <PageReading label={t("power.voltage")}>{valueText(battery.voltage_v, "V", 3)}</PageReading>
          <PageReading label={t("power.current")}>{valueText(battery.current_a, "A", 3)}</PageReading>
          <PageReading label={t("power.maker")}>{battery.manufacturer ?? t("common.notReported")}</PageReading>
          <PageReading label={t("power.tech")}>{battery.technology && battery.technology !== "Unknown" ? battery.technology : t("common.notReported")}</PageReading>
          <PageReading label={t("power.systemNow")}><SemanticValue value={battery.system_w} unit="W" /></PageReading>
          <PageReading label={t("power.chargeWindow")}>{valueText(info.last_charge.uncertainty_seconds, t("power.seconds"))}</PageReading>
          <PageReading label={t("power.estimate")}>{chargeEstimateText(info, battery.state, battery.supply, info.timestamp)}</PageReading>
        </div>
        <p>{t("power.health")}</p>
        <p>{battery.energy_basis === "design_voltage" ? t("power.basisDesign") : battery.energy_basis === "mixed" ? t("power.basisMixed") : battery.energy_basis === "reported" ? t("power.basisReported") : t("power.basisNone")}</p>
        <p>{t("power.pdExplain")}</p>
        <p>{t("power.chargeExplain")}</p>
        <p>{t("power.upowerExplain")}{info.estimate.updated_at === null ? "" : t("power.upowerUpdated", { time: timeText(info.estimate.updated_at) })}</p>
        {info.estimate.error && <p><SemanticText role="warning">{t("power.upowerReason", { reason: info.estimate.error })}</SemanticText></p>}
      </section>}
      <Restrictions errors={info.errors} label={t("power.status")} />
    </div>}
  </>;
}
