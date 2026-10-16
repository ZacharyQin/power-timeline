import { Focusable, Toggle } from "@decky/ui";
import { FaBatteryHalf, FaBolt, FaCheckCircle, FaClock, FaDesktop, FaExclamationTriangle, FaGamepad, FaLayerGroup, FaMicrochip, FaMoon, FaPlug } from "react-icons/fa";
import { getSessionDetail } from "./backend";
import { IconLabel, Restrictions, SemanticText, SemanticValue, durationText, reasonText, sessionLabels, timeText } from "./components";
import { PageQueryStatus, PageReading } from "./FullPage";
import { useQuery } from "./data";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { getView, updateView, useView } from "./viewState";
import { isSleepEvent, timelineEventLabel } from "./timelineEvents";

const processDomains = [
  { label: "CPU", icon: FaMicrochip, energy: "cpu_wh", seconds: "cpu_seconds" },
  { label: "GPU", icon: FaDesktop, energy: "gpu_wh", seconds: "gpu_seconds" },
] as const;
const detailStyles = `
  .pt-fullpage .pt-session-detail { container: pt-session / inline-size; }
  .pt-fullpage .pt-session-identity { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px 24px; margin: 8px 0 12px; }
  .pt-fullpage .pt-session-identity h2 { margin: 0 0 4px; font-size: 22px; font-weight: 600; line-height: 28px; overflow-wrap: anywhere; }
  .pt-fullpage .pt-session-identity p { margin: 0; font-size: 13px; line-height: 18px; }
  .pt-fullpage .pt-session-status { font-size: 13px; line-height: 18px; }
  .pt-fullpage .pt-session-status p { margin: 4px 0 0; }
  .pt-fullpage .pt-session-facts { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-bottom: 16px; font-size: 13px; line-height: 18px; font-variant-numeric: tabular-nums; }
  .pt-fullpage .pt-session-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: start; }
  .pt-fullpage .pt-session-layout > *, .pt-fullpage .pt-session-domains > * { min-width: 0; }
  .pt-fullpage .pt-session-main { min-width: 0; }
  .pt-fullpage .pt-session-summary { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .pt-fullpage .pt-session-summary .pt-section-title { margin-top: 0; }
  .pt-fullpage .pt-session-events { margin-top: 24px; }
  .pt-fullpage .pt-session-domains { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
  .pt-fullpage .pt-session-number { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 34px; }
  .pt-fullpage .pt-session-domains .pt-session-number { font-size: 20px; line-height: 28px; }
  .pt-fullpage .pt-session-cause { margin: 8px 0 0; font-size: 13px; line-height: 18px; }
  .pt-fullpage .pt-session-restrictions { grid-column: 1 / -1; }
  .pt-fullpage .pt-session-event-list { padding: 0; margin: 0; list-style: none; }
  .pt-fullpage .pt-session-event { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 8px 16px; padding: 8px 0; align-items: start; }
  .pt-fullpage .pt-session-event + .pt-session-event { border-top: 1px solid var(--pt-border); }
  .pt-fullpage .pt-session-event time { display: block; font-size: 13px; line-height: 18px; font-variant-numeric: tabular-nums; }
  @container pt-session (min-width: 720px) {
    .pt-fullpage .pt-session-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @container pt-session (min-width: 1100px) {
    .pt-fullpage .pt-session-layout { grid-template-columns: minmax(0, 1fr) 256px; }
    .pt-fullpage .pt-session-summary { grid-template-columns: minmax(0, 1fr); }
  }
  @container pt-session (max-width: 719px) {
    .pt-fullpage .pt-session-event { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  }
`;

export function SessionDetail({ visible }: { visible: boolean }) {
  const view = useView();
  const sessionId = view.sessionId;
  const query = useQuery(`session:${sessionId}`, () => {
    if (!sessionId) return Promise.reject(new Error("未选择会话"));
    return getSessionDetail(sessionId, 600);
  }, visible);
  const session = query.data?.session;
  const duration = session ? Math.max(0, (session.ended_at ?? session.last_seen) - session.started_at) : 0;
  const statusIcon = session?.status === "interrupted" ? FaExclamationTriangle : session?.status === "active" ? FaClock : FaCheckCircle;
  const systemReason = session?.reasons.find((reason) => reason === "not_confirmed_battery_discharge" || reason === "system_measurement_unavailable" || reason === "shared_system_unallocated" || reason === "battery_missing_or_ambiguous" || reason === "external_supply_unavailable");
  return <Focusable className="pt-session-detail" flow-children="column">
    <style>{detailStyles}</style>
    <PageQueryStatus loading={query.loading} error={query.error} retry={query.refresh} />
    {session && query.data && <>
      <div className="pt-session-identity">
        <div>
          <h2><IconLabel icon={FaGamepad}>{session.name}</IconLabel></h2>
          <p className="pt-muted">{timeText(session.started_at, true)} — {timeText(session.ended_at ?? session.last_seen, true)}</p>
        </div>
        <div className="pt-session-status">
          {session.status === "interrupted" ? <SemanticText role="warning"><IconLabel icon={statusIcon}>{sessionLabels[session.status]}</IconLabel></SemanticText> : <IconLabel icon={statusIcon}>{sessionLabels[session.status]}</IconLabel>}
          {session.partial_start && <p>中途开始观测，不包含此前耗电</p>}
        </div>
      </div>
      <div className="pt-session-facts">
        <span><IconLabel icon={FaBatteryHalf}>有效电量起止</IconLabel> <SemanticValue value={session.battery_start} unit="%" role="battery" digits={0} /> → <SemanticValue value={session.battery_end} unit="%" role="battery" digits={0} /></span>
        <span><IconLabel icon={FaClock}>观测跨度</IconLabel> {durationText(duration)}</span>
      </div>
      <Focusable className="pt-session-layout" flow-children="column">
        <Focusable className="pt-session-main" flow-children="column">
          <div className="pt-toolbar">
            <Focusable className="pt-control" aria-label="展开硬件功耗域">
              <span><IconLabel icon={FaMicrochip}>硬件功耗域</IconLabel></span>
              <Toggle aria-label="展开硬件功耗域" value={view.hardware} onChange={(hardware) => updateView({ hardware })} />
            </Focusable>
          </div>
          <TimeSeriesChart timeline={query.data.timeline} hardware={view.hardware} cursor={sessionId ? view.detailCursors[sessionId] ?? null : null} onCursor={(timestamp) => {
            if (sessionId) updateView({ detailCursors: { ...getView().detailCursors, [sessionId]: timestamp } });
          }} />
        </Focusable>
        <div className="pt-session-summary">
          <section aria-labelledby="pt-session-system-title">
            <h3 className="pt-section-title" id="pt-session-system-title">整机伴随耗电 · 实测</h3>
            <PageReading label={<IconLabel icon={FaBolt}>有效累计能量</IconLabel>} layout="below" description={<>
              有效均值 <SemanticValue value={session.system_wh !== null && session.system_seconds > 0 ? session.system_wh * 3600 / session.system_seconds : null} unit="W" /><br />
              覆盖 {durationText(session.system_seconds)} / {durationText(duration)}
            </>}><strong className="pt-session-number"><SemanticValue value={session.system_wh} unit="Wh" role="system" /></strong></PageReading>
            {(systemReason || session.system_wh === null) && <p className="pt-session-cause">{systemReason ? reasonText(systemReason) : "无可用整机累计值"}</p>}
          </section>
          <section aria-labelledby="pt-session-process-title">
            <h3 className="pt-section-title" id="pt-session-process-title">游戏进程能量 · 非校准估算</h3>
            <PageReading label={<IconLabel icon={FaLayerGroup}>CPU + GPU 合计</IconLabel>} layout="below"><strong className="pt-session-number"><SemanticValue value={session.process_wh} unit="Wh" role="process" /></strong></PageReading>
            <div className="pt-session-domains">
              {processDomains.map((domain) => {
                const energy = session[domain.energy];
                const seconds = session[domain.seconds];
                return <PageReading key={domain.energy} label={<IconLabel icon={domain.icon}>{domain.label} 估算</IconLabel>} layout="below" description={<>有效均值 <SemanticValue value={energy !== null && seconds > 0 ? energy * 3600 / seconds : null} unit="W" /><br />覆盖 {durationText(seconds)} / {durationText(duration)}</>}><strong className="pt-session-number"><SemanticValue value={energy} unit="Wh" role="process" /></strong></PageReading>;
              })}
            </div>
          </section>
          <div className="pt-session-restrictions"><Restrictions reasons={session.reasons} /></div>
        </div>
      </Focusable>
      <section className="pt-session-events" aria-labelledby="pt-session-events-title">
        <h3 className="pt-section-title" id="pt-session-events-title">事件、休眠与缺口</h3>
        {query.data.timeline.events.length === 0 && <p className="pt-muted">没有已记录事件</p>}
        <ol className="pt-session-event-list">
          {query.data.timeline.events.map((event, index) => <li className="pt-session-event" key={`${event.kind}:${event.timestamp}:${index}`}>
            <span className="pt-muted"><time dateTime={new Date(event.timestamp * 1000).toISOString()}>{timeText(event.timestamp, true)}</time>{event.end !== null && <time dateTime={new Date(event.end * 1000).toISOString()}>→ {timeText(event.end, true)}</time>}</span>
            <span><IconLabel icon={isSleepEvent(event) ? FaMoon : event.kind === "gap" ? FaExclamationTriangle : event.kind === "supply" ? FaPlug : FaGamepad}>{timelineEventLabel(event)}</IconLabel>{isSleepEvent(event) && <span className="pt-muted"> · {durationText(event.end - event.timestamp)}</span>}</span>
          </li>)}
        </ol>
      </section>
    </>}
  </Focusable>;
}
