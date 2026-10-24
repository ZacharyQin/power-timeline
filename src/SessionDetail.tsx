import { Focusable, Toggle } from "@decky/ui";
import { FaBatteryHalf, FaBolt, FaCheckCircle, FaClock, FaDesktop, FaExclamationTriangle, FaGamepad, FaLayerGroup, FaMicrochip, FaMoon, FaPlug } from "react-icons/fa";
import { getSessionDetail } from "./backend";
import { IconLabel, Restrictions, SemanticText, SemanticValue, durationText, reasonText, sessionLabel, timeText } from "./components";
import { displayGameName, t } from "./i18n";
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
  .pt-fullpage .pt-session-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
  .pt-fullpage .pt-session-layout > *, .pt-fullpage .pt-session-domains > * { min-width: 0; }
  .pt-fullpage .pt-session-main { min-width: 0; }
  .pt-fullpage .pt-session-summary { order: -1; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 12px; border: 1px solid var(--pt-border); border-radius: 6px; background: var(--pt-surface); }
  .pt-fullpage .pt-session-summary .pt-section-title { margin-top: 0; font-size: 13px; line-height: 18px; }
  .pt-fullpage .pt-session-summary .pt-session-identity { flex-direction: column; margin: 0; }
  .pt-fullpage .pt-session-summary .pt-session-identity h2 { font-size: 15px; line-height: 21px; }
  .pt-fullpage .pt-session-summary .pt-session-facts { flex-direction: column; align-items: flex-start; gap: 8px; margin-bottom: 0; }
  .pt-fullpage .pt-session-events { margin-top: 24px; }
  .pt-fullpage .pt-session-domains { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
  .pt-fullpage .pt-session-number { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 34px; }
  .pt-fullpage .pt-session-domains .pt-session-number { font-size: 20px; line-height: 28px; }
  .pt-fullpage .pt-session-cause { margin: 8px 0 0; font-size: 13px; line-height: 18px; }
  .pt-fullpage .pt-session-restrictions { margin-top: 12px; }
  .pt-fullpage .pt-session-process { margin-top: 16px; padding: 12px; border: 1px solid var(--pt-border); border-radius: 6px; background: var(--pt-surface); }
  .pt-fullpage .pt-session-event-list { padding: 0; margin: 0; list-style: none; }
  .pt-fullpage .pt-session-event { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 8px 16px; padding: 8px 0; align-items: start; }
  .pt-fullpage .pt-session-event + .pt-session-event { border-top: 1px solid var(--pt-border); }
  .pt-fullpage .pt-session-event time { display: block; font-size: 13px; line-height: 18px; font-variant-numeric: tabular-nums; }
  @container pt-session (min-width: 620px) {
    .pt-fullpage .pt-session-layout { grid-template-columns: minmax(0, 1fr) 184px; }
    .pt-fullpage .pt-session-main { order: -1; }
    .pt-fullpage .pt-session-summary { order: 0; }
  }
  @container pt-session (max-width: 719px) {
    .pt-fullpage .pt-session-event { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  }
`;

export function SessionDetail({ visible }: { visible: boolean }) {
  const view = useView();
  const sessionId = view.sessionId;
  const query = useQuery(`session:${sessionId}`, () => {
    if (!sessionId) return Promise.reject(new Error(t("session.none")));
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
      <Focusable className="pt-session-layout" flow-children="row">
        <Focusable className="pt-session-main" flow-children="column">
          <div className="pt-toolbar">
            <Focusable className="pt-control" aria-label={t("range.hardware")}>
              <span><IconLabel icon={FaMicrochip}>{t("range.hardware")}</IconLabel></span>
              <Toggle aria-label={t("range.hardware")} value={view.hardware} onChange={(hardware) => updateView({ hardware })} />
            </Focusable>
          </div>
          <div className="pt-chart-panel">
          <TimeSeriesChart totals={false} timeline={query.data.timeline} hardware={view.hardware} cursor={sessionId ? view.detailCursors[sessionId] ?? null : null} onCursor={(timestamp) => {
            if (sessionId) updateView({ detailCursors: { ...getView().detailCursors, [sessionId]: timestamp } });
          }} />
          </div>
        </Focusable>
        <div className="pt-session-summary">
          <div className="pt-session-identity">
            <div>
              <h2><IconLabel icon={FaGamepad}>{displayGameName(session.name, session.game_id)}</IconLabel></h2>
              <p className="pt-muted">{timeText(session.started_at, true)} — {timeText(session.ended_at ?? session.last_seen, true)}</p>
            </div>
            <div className="pt-session-status">
              {session.status === "interrupted" ? <SemanticText role="warning"><IconLabel icon={statusIcon}>{sessionLabel(session.status)}</IconLabel></SemanticText> : <IconLabel icon={statusIcon}>{sessionLabel(session.status)}</IconLabel>}
              {session.partial_start && <p>{t("session.partial")}</p>}
            </div>
          </div>
          <div className="pt-session-facts">
            <span><IconLabel icon={FaBatteryHalf}>{t("session.batterySpan")}</IconLabel> <SemanticValue value={session.battery_start} unit="%" role="battery" digits={0} /> → <SemanticValue value={session.battery_end} unit="%" role="battery" digits={0} /></span>
            <span><IconLabel icon={FaClock}>{t("session.span")}</IconLabel> {durationText(duration)}</span>
          </div>
          <section aria-labelledby="pt-session-system-title">
            <h3 className="pt-section-title" id="pt-session-system-title">{t("session.systemTitle")}</h3>
            <PageReading label={<IconLabel icon={FaBolt}>{t("session.systemEnergy")}</IconLabel>} layout="below" description={<>
              {t("session.mean")} <SemanticValue value={session.system_wh !== null && session.system_seconds > 0 ? session.system_wh * 3600 / session.system_seconds : null} unit="W" /><br />
              {t("session.coverage", { covered: durationText(session.system_seconds), span: durationText(duration) })}
            </>}><strong className="pt-session-number"><SemanticValue value={session.system_wh} unit="Wh" role="system" /></strong></PageReading>
            {(systemReason || session.system_wh === null) && <p className="pt-session-cause">{systemReason ? reasonText(systemReason) : t("session.noSystem")}</p>}
          </section>
        </div>
      </Focusable>
      <section className="pt-session-process" aria-labelledby="pt-session-process-title">
            <h3 className="pt-section-title" id="pt-session-process-title">{t("session.processTitle")}</h3>
            <PageReading label={<IconLabel icon={FaLayerGroup}>{t("session.processTotal")}</IconLabel>} layout="below"><strong className="pt-session-number"><SemanticValue value={session.process_wh} unit="Wh" role="process" /></strong></PageReading>
            <div className="pt-session-domains">
              {processDomains.map((domain) => {
                const energy = session[domain.energy];
                const seconds = session[domain.seconds];
                return <PageReading key={domain.energy} label={<IconLabel icon={domain.icon}>{t("session.domainEstimate", { domain: domain.label })}</IconLabel>} layout="below" description={<>{t("session.mean")} <SemanticValue value={energy !== null && seconds > 0 ? energy * 3600 / seconds : null} unit="W" /><br />{t("session.coverage", { covered: durationText(seconds), span: durationText(duration) })}</>}><strong className="pt-session-number"><SemanticValue value={energy} unit="Wh" role="process" /></strong></PageReading>;
              })}
            </div>
          </section>
          <div className="pt-session-restrictions"><Restrictions reasons={session.reasons} /></div>
      <section className="pt-session-events" aria-labelledby="pt-session-events-title">
        <h3 className="pt-section-title" id="pt-session-events-title">{t("session.events")}</h3>
        {query.data.timeline.events.length === 0 && <p className="pt-muted">{t("session.noEvents")}</p>}
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
