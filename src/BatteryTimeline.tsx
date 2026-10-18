import { DialogButton, Dropdown, Focusable, Toggle } from "@decky/ui";
import { useEffect } from "react";
import { FaGamepad, FaMicrochip, FaStream } from "react-icons/fa";
import { getTimeline } from "./backend";
import { IconLabel, durationText, timeText } from "./components";
import { t } from "./i18n";
import { PageQueryStatus, PageReading } from "./FullPage";
import { useQuery } from "./data";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { getView, openSession, rangeBounds, rangeBucket, updateView, useView } from "./viewState";
import { isSleepEvent, timelineEventLabel } from "./timelineEvents";

export function BatteryTimeline({ visible }: { visible: boolean }) {
  const view = useView();
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
      .pt-fullpage .pt-timeline .pt-control { min-width: 0; max-width: 100%; }
      .pt-fullpage .pt-range-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
      .pt-fullpage .pt-range-tab { min-width: 72px; }
      .pt-fullpage .pt-range-tab-active:not(.gpfocus):not(:focus-visible) { background: color-mix(in srgb, currentColor 12%, transparent); box-shadow: inset 0 -2px 0 currentColor; }
      .pt-fullpage .pt-timeline-boundaries { margin: 8px 0 16px; font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }
      .pt-fullpage .pt-timeline-events { margin-top: 24px; }
      .pt-fullpage .pt-timeline-event { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-top: 12px; }
      .pt-fullpage .pt-timeline-event time { font-variant-numeric: tabular-nums; }
    `}</style>
    <div className="pt-toolbar">
      <div className="pt-range-tabs" role="tablist" aria-label={t("range.aria")}>
        {([["1d", "range.1d"], ["3d", "range.3d"], ["7d", "range.7d"]] as const).map(([id, label]) => <Focusable key={id} preferredFocus={view.focus === "range" && view.range === id}><DialogButton className={`pt-compact-button pt-range-tab${view.range === id ? " pt-range-tab-active" : ""}`} onClick={() => updateView({ range: id, bounds: rangeBounds(id), live: true, cursor: null, event: null, focus: "range" })}>{t(label)}</DialogButton></Focusable>)}
      </div>
      <Focusable className="pt-control" aria-label={t("range.hardware")}>
        <span><IconLabel icon={FaMicrochip}>{t("range.hardware")}</IconLabel></span>
        <Toggle aria-label={t("range.hardware")} value={view.hardware} onChange={(hardware) => updateView({ hardware })} />
      </Focusable>
    </div>
    <p className="pt-timeline-boundaries pt-muted">{view.live ? t("range.live") : t("range.fixed")} · {timeText(displayedBounds.start, true)} — {timeText(displayedBounds.end, true)}</p>
    <PageQueryStatus loading={query.loading} error={query.error} retry={query.refresh} />
    {query.data && <TimeSeriesChart timeline={query.data} showGames cursor={view.cursor} onCursor={(cursor) => updateView({ cursor, live: false, focus: "cursor" })} hardware={view.hardware} preferredFocus={view.focus === "cursor"} />}
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
  </div>;
}
