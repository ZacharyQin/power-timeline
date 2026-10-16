import { useQuickAccessVisible } from "@decky/api";
import { Navigation, PanelSection, PanelSectionRow } from "@decky/ui";
import { FaBatteryHalf, FaBolt, FaChartLine, FaClock, FaExclamationCircle, FaGamepad } from "react-icons/fa";
import { getTimeline } from "./backend";
import { Action, QueryStatus, Reading, SemanticStyles, SemanticText, SemanticValue, batteryStateText, reasonText, sessionLabels, supplyText, timeText } from "./components";
import { useDocumentVisible, useQuery, useSnapshot } from "./data";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { updateView } from "./viewState";

export function QamSummary() {
  const visible = useQuickAccessVisible();
  const documentVisible = useDocumentVisible();
  const enabled = visible && documentVisible;
  const summary = useSnapshot(enabled);
  const short = useQuery("qam-battery", () => {
    const end = Date.now() / 1000;
    return getTimeline(end - 1800, end, 120);
  }, enabled);
  const sample = summary.snapshot?.sample;
  return <PanelSection title="电池时间线">
    <SemanticStyles />
    <QueryStatus padding="standard" loading={summary.loading && !summary.snapshot} error={summary.error} retry={summary.refresh} />
    <Reading padding="standard" icon={FaBatteryHalf} label={sample ? "电量" : "尚未采到电池样本"} description={sample ? `${batteryStateText(sample.battery_state)} · 最后采样 ${timeText(sample.timestamp)}${Date.now() / 1000 - sample.timestamp > 10 ? "（当前采样已过期）" : ""}` : "启用后从当前时刻开始记录。"}>
      {sample && <><strong style={{ fontSize: "1.5em" }}><SemanticValue value={sample.battery_percent} unit="%" role="battery" digits={0} /></strong> · {supplyText(sample.supply)}</>}
    </Reading>
    <Reading padding="standard" icon={FaBolt} label="当前整机功率" description={sample?.system_w === null ? sample.errors.system_w ? reasonText(sample.errors.system_w) : "当前样本无有效整机读数，不以电池净功率代替。" : undefined}><SemanticValue value={sample?.system_w ?? null} unit="W" /></Reading>
    <Action icon={FaChartLine} preferred onClick={() => {
      updateView({ page: "timeline" });
      Navigation.Navigate("/power-timeline");
      Navigation.CloseSideMenus();
    }}>查看电池时间线</Action>
    {short.data && <><Reading padding="standard" icon={FaClock} label="最近 30 分钟" /><PanelSectionRow><TimeSeriesChart timeline={short.data} compact /></PanelSectionRow></>}
    <QueryStatus padding="standard" loading={short.loading} error={short.error} retry={short.refresh} />
    {summary.snapshot?.status !== "recording" && summary.snapshot && <Reading padding="standard" icon={FaExclamationCircle} label={summary.snapshot.status === "error" ? <SemanticText role="error">后台未正常记录</SemanticText> : "后台未正常记录"} description={summary.snapshot.error ?? "记录已停止"} />}
    {summary.snapshot?.sessions.length === 0 && <Reading padding="standard" icon={FaGamepad} label="当前未发现游戏进程" />}
    {summary.snapshot?.sessions.map((session) => <Reading padding="standard" icon={FaGamepad} key={session.session_id} label={session.name} description={<>{session.status === "interrupted" ? <SemanticText role="warning">{sessionLabels[session.status]}</SemanticText> : sessionLabels[session.status]} · 整机伴随 / 游戏进程估算分开统计</>}>整机 <SemanticValue value={session.system_wh} unit="Wh" role="system" /> · CPU + GPU 估算 <SemanticValue value={session.process_wh} unit="Wh" role="process" /></Reading>)}
  </PanelSection>;
}
