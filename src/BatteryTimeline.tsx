import { DialogButton, Dropdown, Focusable, Toggle } from "@decky/ui";
import { useEffect } from "react";
import { FaGamepad, FaMicrochip, FaStream } from "react-icons/fa";
import { getTimeline } from "./backend";
import { batteryStateText, IconLabel, SemanticValue, supplyText, durationText, timeText } from "./components";
import { t } from "./i18n";
import { PageQueryStatus, PageReading } from "./FullPage";
import { useQuery, useSnapshot } from "./data";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { getView, openSession, rangeBounds, rangeBucket, updateView, useView } from "./viewState";
import { isSleepEvent, timelineEventLabel } from "./timelineEvents";

export function BatteryTimeline({ visible }: { visible: boolean }) {
  const view = useView();
  const live = useSnapshot(visible);
  const sample = live.snapshot?.sample ?? null;
  const key = `timeline:${view.range}`;
  const query = useQuery(key, () => {
    const current = getView();
    const bounds = current.live ? rangeBounds(current.range) : current.bounds;
    return getTimeline(bounds.start, bounds.end, 600, rangeBucket(current.range));
  }, visible);
  useEffect(() => {
    if (view.live && query.data) updateView({ bounds: { start: query.data.start, end: query.data.end } });
  }, [query.data, view.live]);
  const displayedBounds = query.data ?? view.bounds;
  const events = query.data?.events ?? [];
  const selectedEvent = events.findIndex((event) => view.event !== null && event.kind === view.event.kind && event.timestamp === view.event.timestamp && event.session_id === view.event.session_id);
  return <div className="pt-timeline">
    <style>{`
      .pt-fullpage .pt-timeline { container: pt-timeline / inline-size; }
      .pt-fullpage .pt-timeline .pt-control { min-width: 0; max-width: 100%; }
      .pt-fullpage .pt-timeline-workbench { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
      .pt-fullpage .pt-timeline-workbench > * { min-width: 0; }
      .pt-fullpage .pt-timeline-side { box-sizing: border-box; padding: 12px; border: 1px solid var(--pt-border); border-radius: 6px; background: var(--pt-surface); }
      .pt-fullpage .pt-timeline-side .pt-reading { margin: 0; }
      .pt-fullpage .pt-timeline-side .pt-reading + .pt-reading { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--pt-border); }
      .pt-fullpage .pt-timeline-side .pt-reading-value { font-size: 22px; line-height: 28px; font-weight: 600; }
      .pt-fullpage .pt-range-tabs { display: flex; gap: 3px; padding: 3px; border-radius: 6px; background: var(--pt-surface); }
      .pt-fullpage .pt-page-frame button.pt-range-tab.DialogButton { min-width: 64px; padding: 4px 8px; font-size: 12px; }
      .pt-fullpage .pt-range-tab-active:not(.gpfocus):not(:focus-visible) { background: color-mix(in srgb, currentColor 12%, transparent); box-shadow: inset 0 -2px 0 currentColor; }
      .pt-fullpage .pt-timeline-boundaries { margin: 0 0 8px; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
      .pt-fullpage .pt-timeline-side .pt-coverage-duration { font-size: 14px; line-height: 22px; font-weight: 400; }
      .pt-fullpage .pt-timeline-events { margin-top: 24px; }
      .pt-fullpage .pt-timeline-event { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-top: 12px; }
      .pt-fullpage .pt-timeline-event time { font-variant-numeric: tabular-nums; }
      @container pt-timeline (min-width: 620px) {
        .pt-fullpage .pt-timeline-workbench { grid-template-columns: minmax(0, 1fr) 165px; }
      }
    `}</style>
    <div className="pt-timeline-workbench">
    <div>
    <Focusable className="pt-toolbar" flow-children="row">
      <Focusable className="pt-range-tabs" flow-children="row" role="tablist" aria-label={t("range.aria")}>
        {([["1d", "range.1d"], ["3d", "range.3d"], ["7d", "range.7d"]] as const).map(([id, label]) => <Focusable key={id} preferredFocus={view.focus === "range" && view.range === id}><DialogButton className={`pt-compact-button pt-range-tab${view.range === id ? " pt-range-tab-active" : ""}`} onClick={() => updateView({ range: id, bounds: rangeBounds(id), live: true, cursor: null, event: null, focus: "range" })}>{t(label)}</DialogButton></Focusable>)}
      </Focusable>
      <Focusable className="pt-control" aria-label={t("range.hardware")}>
        <span><IconLabel icon={FaMicrochip}>{t("range.hardware")}</IconLabel></span>
        <Toggle aria-label={t("range.hardware")} value={view.hardware} onChange={(hardware) => updateView({ hardware })} />
      </Focusable>
    </Focusable>
    <p className="pt-timeline-boundaries pt-muted">{view.live ? t("range.live") : t("range.fixed")} · {timeText(displayedBounds.start, true)} — {timeText(displayedBounds.end, true)}</p>
    <PageQueryStatus loading={false} error={query.error} retry={query.refresh} />
    <div className="pt-chart-panel"><TimeSeriesChart timeline={query.data ?? displayedBounds} totals={false} showGames cursor={view.cursor} onCursor={(cursor) => updateView({ cursor, live: false, focus: "cursor" })} hardware={view.hardware} preferredFocus={view.focus === "cursor"} /></div>
    <section className="pt-timeline-events" aria-labelledby="pt-timeline-events-title">
      <h2 className="pt-section-title" id="pt-timeline-events-title">{t("events.title")}</h2>
      {events.length === 0 ? <PageReading label={query.loading ? t("events.loading") : t("events.empty")} /> : <>
        <Focusable className="pt-control" preferredFocus={view.focus === "event"}>
          <span><IconLabel icon={FaStream}>{t("events.pick")}</IconLabel></span>
          <Dropdown aria-label={t("events.pick")} menuLabel={t("events.pick")} strDefaultLabel={t("events.placeholder")} selectedOption={selectedEvent < 0 ? null : selectedEvent} rgOptions={events.map((event, index) => ({ data: index, label: isSleepEvent(event) ? t("events.sleepOption", { time: timeText(event.timestamp), duration: durationText(event.end - event.timestamp) }) : t("events.option", { time: timeText(event.timestamp), kind: event.kind === "game" ? t("events.game") : event.kind === "supply" ? t("events.supply") : t("events.gap"), label: timelineEventLabel(event) }) }))} onChange={(option) => {
            const event = events[Number(option.data)];
            if (event) updateView({ event, cursor: event.timestamp, live: false, focus: "event" });
          }} />
        </Focusable>
        {view.event && <div className="pt-timeline-event">
          <time dateTime={new Date(view.event.timestamp * 1000).toISOString()} className="pt-muted">{timeText(view.event.timestamp, true)}{view.event.end !== null ? ` — ${timeText(view.event.end, true)}` : ""}</time>
          <span>{timelineEventLabel(view.event)}{isSleepEvent(view.event) && ` · ${durationText(view.event.end - view.event.timestamp)}`}</span>
          {view.event.session_id && <DialogButton className="pt-compact-button" onClick={() => { if (view.event?.session_id) openSession(view.event.session_id, "timeline"); }}><IconLabel icon={FaGamepad}>{t("events.openSession")}</IconLabel></DialogButton>}
        </div>}
      </>}
    </section>
    </div>
    <aside className="pt-timeline-side" aria-label={t("power.summary")}>
      <PageReading layout="below" label={t("power.level")} description={sample ? <>{batteryStateText(sample.battery_state)} · {supplyText(sample.supply)}</> : undefined}>
        <SemanticValue value={sample?.battery_percent ?? null} unit="%" role="battery" digits={0} />
      </PageReading>
      <PageReading layout="below" label={t("session.systemEnergy")}>
        <SemanticValue value={query.data?.system_wh ?? null} unit="Wh" role="system" />
      </PageReading>
      <PageReading layout="below" label={t("chart.coverage")}>
        <span className="pt-coverage-duration">{query.data ? `${durationText(query.data.coverage_seconds)} / ${durationText(query.data.end - query.data.start)}` : "—"}</span>
      </PageReading>
    </aside>
    </div>
  </div>;
}
