import { FaBatteryHalf, FaBolt, FaClock, FaHeartbeat } from "react-icons/fa";
import { getPowerInfo } from "./backend";
import { IconLabel, Restrictions, SemanticText, SemanticValue, batteryStateText, durationText, supplyText, timeText, valueText } from "./components";
import { useQuery } from "./data";
import { PageQueryStatus, PageReading } from "./FullPage";
import { chargeEstimateText, lastChargeReason, lastChargeText } from "./powerStatus";

function capacityText(charge: number | null, energy: number | null) {
  if (charge === null) return energy === null ? "未上报" : valueText(energy, "Wh");
  return `${valueText(charge, "mAh", 0)}${energy === null ? "" : ` · ${valueText(energy, "Wh")}`}`;
}

export function PowerInfoPage({ visible }: { visible: boolean }) {
  const query = useQuery("power-info", getPowerInfo, visible);
  const info = query.data;
  const battery = info?.battery;
  return <>
    <style>{`
      .pt-fullpage .pt-power-info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 32px; }
      .pt-fullpage .pt-power-info section { min-width: 0; padding-top: 16px; border-top: 1px solid var(--pt-border); }
      .pt-fullpage .pt-power-info .pt-reading-value { overflow-wrap: anywhere; text-align: right; }
      @container pt-page (max-width: 899px) { .pt-fullpage .pt-power-info { grid-template-columns: minmax(0, 1fr); gap: 16px; } }
    `}</style>
    <PageQueryStatus loading={query.loading && !info} error={query.error} retry={query.refresh} />
    {info && battery && <>
      <p className="pt-muted">电池与供电信息 · 读取于 {timeText(info.timestamp)}{Date.now() / 1000 - info.timestamp > 10 && <> · <SemanticText role="warning">当前信息已过期</SemanticText></>}</p>
      <div className="pt-power-info">
        <section aria-label="当前电池">
          <h2 className="pt-section-title"><IconLabel icon={FaBatteryHalf}>当前电池</IconLabel></h2>
          <PageReading label="电量"><SemanticValue value={battery.percent} unit="%" role="battery" digits={0} /></PageReading>
          <PageReading label="电池状态">{batteryStateText(battery.state)} · {supplyText(battery.supply)}</PageReading>
          <PageReading label="型号">{battery.model ?? "未上报"}</PageReading>
          {battery.manufacturer && <PageReading label="制造商">{battery.manufacturer}</PageReading>}
          <PageReading label="电池电压">{valueText(battery.voltage_v, "V", 3)}</PageReading>
          <PageReading label={battery.state === "Charging" ? "充电电流" : battery.state === "Discharging" ? "放电电流" : "电池电流"}>{valueText(battery.current_a, "A", 3)}</PageReading>
          <PageReading label={battery.state === "Charging" ? "电池净充电功率" : "电池净功率"}><SemanticValue value={battery.net_w} unit="W" /></PageReading>
          <PageReading label="当前整机功率" description={battery.system_w === null ? "外接供电或未确认独立放电时，电池净功率不能代表整机功率。" : undefined}><SemanticValue value={battery.system_w} unit="W" /></PageReading>
        </section>
        <section aria-label="容量与健康信息">
          <h2 className="pt-section-title"><IconLabel icon={FaHeartbeat}>容量与健康信息</IconLabel></h2>
          <PageReading label="剩余容量">{capacityText(battery.charge_now_mah, battery.energy_now_wh)}</PageReading>
          <PageReading label="当前满充容量">{capacityText(battery.charge_full_mah, battery.energy_full_wh)}</PageReading>
          <PageReading label="设计容量">{capacityText(battery.charge_design_mah, battery.energy_design_wh)}</PageReading>
          <PageReading label="满充／设计比" description="原始容量比；超过 100% 不直接表示故障。">{valueText(battery.capacity_ratio_percent, "%", 1)}</PageReading>
          <PageReading label="系统容量估计" description="UPower 转报的容量口径，不是独立第二次容量实测。">{valueText(battery.system_capacity_percent, "%", 0)}</PageReading>
          <PageReading label="循环次数" description={battery.cycle_count === null ? "系统未提供可确认的有效次数，不显示成 0 次。" : undefined}>{battery.cycle_count === null ? "未知" : valueText(battery.cycle_count, "次", 0)}</PageReading>
          {battery.energy_basis !== "reported" && <p className="pt-muted">{battery.energy_basis === "design_voltage" ? "Wh 由电荷量与设计电压换算，不是另一份能量实测。" : battery.energy_basis === "mixed" ? "部分 Wh 由设计电压换算，其余来自电池上报。" : "系统未提供可换算的电池能量。"}</p>}
          <p className="pt-muted">这些字段不构成完整健康诊断，不推断 macOS 健康状态或低电量模式。</p>
        </section>
        <section aria-label="外接电源">
          <h2 className="pt-section-title"><IconLabel icon={FaBolt}>外接电源</IconLabel></h2>
          <PageReading label="供电方式">{supplyText(battery.supply)}</PageReading>
          <PageReading label="PD 协商电压">{valueText(info.adapter.voltage_v, "V", 1)}</PageReading>
          <PageReading label="PD 协商电流">{valueText(info.adapter.current_a, "A", 1)}</PageReading>
          <PageReading label="PD 协商功率上限">{valueText(info.adapter.limit_w, "W", 1)}</PageReading>
          <p className="pt-muted">协商上限不等于充电器铭牌功率或实时输入，不能与电池功率相减推算整机。未接电或契约无效时保持未知。</p>
        </section>
        <section aria-label="充电记录与估计">
          <h2 className="pt-section-title"><IconLabel icon={FaClock}>充电记录与估计</IconLabel></h2>
          <PageReading label="距上次充电结束" description={lastChargeReason(info)}>{lastChargeText(info)}</PageReading>
          <PageReading label="最近观测到的结束时间" description={info.last_charge.uncertainty_seconds === null ? undefined : `结束点位于约 ${durationText(info.last_charge.uncertainty_seconds)} 的采样窗口内，不是精确物理瞬间。`}>{info.last_charge.ended_at === null ? "尚未确认" : timeText(info.last_charge.ended_at, true)}</PageReading>
          <PageReading label="预计充满">{chargeEstimateText(info, battery.state, battery.supply, info.timestamp)}</PageReading>
          <p className="pt-muted">UPower 系统估计{info.estimate.updated_at !== null && ` · 来源更新 ${timeText(info.estimate.updated_at)}`}。预测会随充电速率变化，不是精确倒计时；零值、过期和状态不匹配时不报分钟数。</p>
          {info.estimate.error && <p className="pt-muted"><SemanticText role="warning">系统充电估计暂不可用：{info.estimate.error}</SemanticText></p>}
        </section>
      </div>
      <Restrictions errors={info.errors} label="电源数据状态" />
    </>}
  </>;
}
