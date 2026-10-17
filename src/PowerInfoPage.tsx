import { DialogButtonSecondary, Focusable } from "@decky/ui";
import { useState } from "react";
import { FaBatteryHalf, FaBolt, FaChevronDown, FaChevronUp, FaClock } from "react-icons/fa";
import { getPowerInfo } from "./backend";
import { IconLabel, Restrictions, SemanticText, SemanticValue, batteryStateText, reasonText, supplyText, timeText, valueText } from "./components";
import { useQuery } from "./data";
import { PageQueryStatus, PageReading } from "./FullPage";
import { chargeEstimateText, lastChargeReason, lastChargeText } from "./powerStatus";

function capacityText(charge: number | null, energy: number | null) {
  if (charge === null) return energy === null ? "未上报" : valueText(energy, "Wh");
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
      {Date.now() / 1000 - info.timestamp > 10 && <p className="pt-power-alert" role="status"><SemanticText role="warning">当前信息已过期，旧读数不代表当前状态。</SemanticText></p>}
      <section className="pt-power-summary" aria-label="电池状态概览">
        <div className="pt-power-metric">
          <span className="pt-power-metric-label">电量</span>
          <div className="pt-power-metric-value"><SemanticValue value={battery.percent} unit="%" role="battery" digits={0} /><span className="pt-power-metric-note">{batteryStateText(battery.state)} · {supplyText(battery.supply)}</span></div>
        </div>
        <div className="pt-power-metric">
          <span className="pt-power-metric-label">{charging ? "电池净充电功率" : "电池净功率"}</span>
          <div className="pt-power-metric-value"><SemanticValue value={battery.net_w} unit="W" /><span className="pt-power-metric-note">{battery.system_w === null ? battery.supply === "external" ? "插电 · 整机未知" : "整机未知" : <>整机 <SemanticValue value={battery.system_w} unit="W" /></>}</span></div>
        </div>
        <div className="pt-power-metric">
          <span className="pt-power-metric-label">{charging ? "预计充满（系统估计）" : "距上次充电结束"}</span>
          <div className="pt-power-metric-value pt-power-timing">{charging ? chargeEstimateText(info, battery.state, battery.supply, info.timestamp) : lastChargeText(info)}</div>
        </div>
      </section>
      {info.errors.system_w && <p className="pt-power-alert" role="status"><SemanticText role="warning">整机读数：{reasonText(info.errors.system_w)}</SemanticText></p>}
      {info.estimate.error && <p className="pt-power-alert" role="status"><SemanticText role="warning">UPower 读取失败，相关系统估计暂不可用。</SemanticText></p>}
      <div className="pt-power-cards">
        <section className="pt-power-card" aria-label="电池档案">
          <header className="pt-power-card-heading"><h2><IconLabel icon={FaBatteryHalf}>电池档案</IconLabel></h2><span className="pt-power-model">{battery.model ?? "型号未上报"}</span></header>
          <PageReading label={`满充 / 设计${battery.energy_basis === "design_voltage" ? "（换算）" : battery.energy_basis === "mixed" ? "（含换算）" : ""}`}>
            {battery.energy_full_wh !== null || battery.energy_design_wh !== null ? <>{valueText(battery.energy_full_wh, "").trimEnd()} / {valueText(battery.energy_design_wh, "Wh")}</> : <>{valueText(battery.charge_full_mah, "", 0).trimEnd()} / {valueText(battery.charge_design_mah, "mAh", 0)}</>}
          </PageReading>
          <PageReading label="原始容量比">{valueText(battery.capacity_ratio_percent, "%", 1)}</PageReading>
          <PageReading label="循环次数">{battery.cycle_count === null ? "未知 · 未确认" : valueText(battery.cycle_count, "次", 0)}</PageReading>
        </section>
        <section className="pt-power-card" aria-label="电源参数">
          <header className="pt-power-card-heading"><h2><IconLabel icon={FaBolt}>电源参数</IconLabel></h2></header>
          <PageReading label="PD 契约">{valueText(info.adapter.voltage_v, "V", 1)} · {valueText(info.adapter.current_a, "A", 1)}</PageReading>
          <PageReading label="协商上限">{valueText(info.adapter.limit_w, "W", 1)} · 非实测</PageReading>
          <PageReading label="电池电压 / 电流">{valueText(battery.voltage_v, "V")} · {valueText(battery.current_a, "A")}</PageReading>
        </section>
      </div>
      <div className="pt-power-charge" aria-label="充电记录">
        <IconLabel icon={FaClock}>充电记录</IconLabel>
        <span className="pt-power-charge-value">{charging ? "正在充电 · 结束后开始计时" : info.last_charge.ended_at === null ? "尚未确认结束时间" : `上次结束 ${timeText(info.last_charge.ended_at, true)}`}</span>
        {chargeReason && <span className="pt-power-charge-note">{chargeReason}</span>}
      </div>
      <div className="pt-power-disclosure">
        <Focusable><DialogButtonSecondary className="pt-compact-button" aria-expanded={expanded} aria-controls="pt-power-details" onClick={() => setExpanded(!expanded)}><IconLabel icon={expanded ? FaChevronUp : FaChevronDown}>{expanded ? "收起参数与数据来源" : "更多参数与数据来源"}</IconLabel></DialogButtonSecondary></Focusable>
        <span className="pt-power-updated">读取于 {timeText(info.timestamp)}</span>
      </div>
      {expanded && <section id="pt-power-details" className="pt-power-details" aria-label="完整电池参数与数据来源">
        <div className="pt-power-detail-grid">
          <PageReading label="剩余容量">{capacityText(battery.charge_now_mah, battery.energy_now_wh)}</PageReading>
          <PageReading label="系统容量估计">{valueText(battery.system_capacity_percent, "%", 0)}</PageReading>
          <PageReading label="当前满充容量">{capacityText(battery.charge_full_mah, battery.energy_full_wh)}</PageReading>
          <PageReading label="设计容量">{capacityText(battery.charge_design_mah, battery.energy_design_wh)}</PageReading>
          <PageReading label="电池电压">{valueText(battery.voltage_v, "V", 3)}</PageReading>
          <PageReading label="电池电流">{valueText(battery.current_a, "A", 3)}</PageReading>
          <PageReading label="制造商">{battery.manufacturer ?? "未上报"}</PageReading>
          <PageReading label="电池类型">{battery.technology && battery.technology !== "Unknown" ? battery.technology : "未上报"}</PageReading>
          <PageReading label="当前整机功率"><SemanticValue value={battery.system_w} unit="W" /></PageReading>
          <PageReading label="充电结束观测窗口">{valueText(info.last_charge.uncertainty_seconds, "秒")}</PageReading>
          <PageReading label="预计充满">{chargeEstimateText(info, battery.state, battery.supply, info.timestamp)}</PageReading>
        </div>
        <p>原始满充／设计容量比超过 100% 不直接表示故障；UPower 系统容量估计不是独立第二次实测。这些字段不构成完整健康诊断，未知循环次数不补成 0 次。</p>
        <p>{battery.energy_basis === "design_voltage" ? "Wh 由电荷量与设计电压换算，不是另一份能量实测。" : battery.energy_basis === "mixed" ? "部分 Wh 由设计电压换算，其余来自电池上报。" : battery.energy_basis === "reported" ? "Wh 来自电池能量字段上报。" : "系统未提供可换算的电池能量。"}</p>
        <p>PD 电压 × 电流仅为协商上限，不是充电器铭牌功率或实时输入，不能减去电池净功率推算整机；未接电或契约无效时保持未知。仅确认电池独立放电时，电池侧读数才用于整机功率。</p>
        <p>充电结束点是连续样本间的观测边界，不是精确物理瞬间或拔电时间；跨缺口保留已知日期，但不能确认可靠经过时长。</p>
        <p>UPower 充满估计会随速率变化，不是精确倒计时；零值、过期或状态不匹配时不报分钟数{info.estimate.updated_at === null ? "。" : `。来源更新 ${timeText(info.estimate.updated_at)}。`}</p>
        {info.estimate.error && <p><SemanticText role="warning">UPower 技术原因：{info.estimate.error}</SemanticText></p>}
      </section>}
      <Restrictions errors={info.errors} label="电源数据状态" />
    </div>}
  </>;
}
