import { DialogButtonSecondary, Focusable, GamepadButton } from "@decky/ui";
import { Fragment, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FaInfoCircle } from "react-icons/fa";
import { IconLabel, PowerScaleLegend, Restrictions, SemanticText, SemanticValue, batteryStateText, durationText, reasonText, supplyText, timeText } from "./components";
import { displayGameName, t, useLocale } from "./i18n";
import type { MessageKey } from "./locales/en";
import { PageReading } from "./FullPage";
import { GameIcon } from "./GameIcon";
import { GameLegend } from "./GameLegend";
import { chartSeries, hardwareSeries, semanticColors } from "./displaySemantics";
import type { SeriesKey } from "./displaySemantics";
import { getGameIntervals, isSleepEvent, timelineEventLabel } from "./timelineEvents";
import type { SleepEvent } from "./timelineEvents";
import type { GameTimelineEvent, Sample, Timeline, TimelineEvent } from "./types";

const seriesMessage = { battery_percent: "series.battery_percent", system_w: "series.system_w", apu_w: "series.apu_w", cpu_w: "series.cpu_w", soc_w: "series.soc_w", gpu_w: "series.gpu_w" } as const satisfies Record<SeriesKey, MessageKey>;
const EMPTY_POINTS: Sample[] = [];
const EMPTY_EVENTS: TimelineEvent[] = [];

function padTime(value: number) {
  return String(value).padStart(2, "0");
}

function axisTicks(start: number, end: number, left: number, right: number, at: (timestamp: number) => number) {
  const hours = Math.max(1, end - start) / 3600;
  const width = Math.max(1, right - left);
  const dayScale = hours > 36;
  const step = hours <= 3 ? 1800 : hours <= 36 ? 3600 : hours <= 96 ? 6 * 3600 : 12 * 3600;
  const perHour = width / hours;
  const labelEvery = !dayScale && step === 3600 ? perHour >= 56 ? 1 : perHour >= 28 ? 2 : perHour >= 18 ? 3 : 4 : 1;
  const origin = new Date(start * 1000);
  origin.setSeconds(0, 0);
  if (step >= 12 * 3600) origin.setHours(origin.getHours() < 12 ? 0 : 12, 0, 0, 0);
  else if (step >= 6 * 3600) origin.setHours(Math.floor(origin.getHours() / 6) * 6, 0, 0, 0);
  else if (step >= 3600) origin.setMinutes(0, 0, 0);
  else origin.setMinutes(Math.floor(origin.getMinutes() / 30) * 30, 0, 0);
  let timestamp = origin.getTime() / 1000;
  if (timestamp < start) timestamp += step;
  const ticks: { timestamp: number; label: string | null; anchor: "start" | "middle" | "end" }[] = [];
  let previousLabel = -Infinity;
  for (; timestamp <= end; timestamp += step) {
    const position = at(timestamp);
    if (position < left - 1 || position > right + 1) continue;
    const date = new Date(timestamp * 1000);
    const midnight = date.getHours() === 0 && date.getMinutes() === 0;
    const showLabel = dayScale ? midnight : date.getMinutes() === 0 && date.getHours() % labelEvery === 0;
    const text = midnight && dayScale ? `${date.getMonth() + 1}/${date.getDate()}` : `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
    const label = showLabel && position - previousLabel >= 52 && right - position >= 18 ? text : null;
    if (label) previousLabel = position;
    ticks.push({ timestamp, label, anchor: position < left + 28 ? "start" : position > right - 28 ? "end" : "middle" });
  }
  return ticks;
}

function smoothLine(points: { x: number; y: number }[]): string {
  const count = points.length;
  const slope = new Array<number>(count);
  const delta = new Array<number>(count - 1);
  for (let index = 0; index < count - 1; index += 1) {
    const span = points[index + 1].x - points[index].x;
    delta[index] = span === 0 ? 0 : (points[index + 1].y - points[index].y) / span;
  }
  slope[0] = delta[0];
  slope[count - 1] = delta[count - 2];
  for (let index = 1; index < count - 1; index += 1) slope[index] = delta[index - 1] * delta[index] <= 0 ? 0 : (delta[index - 1] + delta[index]) / 2;
  for (let index = 0; index < count - 1; index += 1) {
    if (delta[index] === 0) { slope[index] = 0; slope[index + 1] = 0; continue; }
    const left = slope[index] / delta[index];
    const right = slope[index + 1] / delta[index];
    const scale = left * left + right * right;
    if (scale > 9) { const limit = 3 / Math.sqrt(scale); slope[index] = limit * left * delta[index]; slope[index + 1] = limit * right * delta[index]; }
  }
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < count - 1; index += 1) {
    const span = points[index + 1].x - points[index].x;
    path += ` C ${points[index].x + span / 3} ${points[index].y + slope[index] * span / 3} ${points[index + 1].x - span / 3} ${points[index + 1].y - slope[index + 1] * span / 3} ${points[index + 1].x} ${points[index + 1].y}`;
  }
  return path;
}

function SeriesLabel({ seriesKey }: { seriesKey: SeriesKey }) {
  const item = chartSeries[seriesKey];
  const name = seriesKey === "system_w" ? t("series.systemPower") : t(seriesMessage[seriesKey]);
  return <SemanticText role={item.role}><svg aria-hidden="true" width="24" height="10" viewBox="0 0 24 10" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 6 }}><line x1="0" y1="5" x2="24" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={item.dash} /></svg>{name}</SemanticText>;
}

function unavailableSystemReason(sample: Sample): string {
  const error = sample.errors.system_w;
  if (error && error !== "not_confirmed_battery_discharge") return t("chart.systemFail", { reason: reasonText(error) });
  if (sample.supply === "external") return t("chart.external");
  if (sample.supply !== "battery") return t("chart.supplyUnconfirmed");
  if (sample.battery_state.toLowerCase() !== "discharging") return t("chart.notDischarging");
  return t("chart.noBatteryPower");
}

function ChartGuide({ hardware, games, sleep, gaps }: { hardware: boolean; games: boolean; sleep: boolean; gaps: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  return <Focusable className="pt-chart-guide" flow-children="column">
    <DialogButtonSecondary className="pt-compact-button" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded(!expanded)}>
      <IconLabel icon={FaInfoCircle}>{expanded ? t("chart.guideHide") : t("chart.guideShow")}</IconLabel>
    </DialogButtonSecondary>
    {expanded && <div id={bodyId} className="pt-chart-guide-body">
      <PowerScaleLegend />
      <p>{t("chart.guideLines")}</p>
      {hardware && <p>{t("chart.guideHardware")}</p>}
      {games && <p>{t("chart.guideGames")}</p>}
      {sleep && <p>{t("chart.guideSleep")}</p>}
      {gaps && <p>{t("chart.guideGaps")}</p>}
      <p>{t("chart.guideCursor")}</p>
    </div>}
  </Focusable>;
}

export const TimeSeriesChart = memo(function TimeSeriesChart({ timeline, cursor, onCursor, hardware = false, compact = false, showGames = false, totals = true, onOpen, preferredFocus = false }: {
  timeline: Timeline | Pick<Timeline, "start" | "end">;
  cursor?: number | null;
  onCursor?: (timestamp: number) => void;
  hardware?: boolean;
  compact?: boolean;
  showGames?: boolean;
  totals?: boolean;
  onOpen?: () => void;
  preferredFocus?: boolean;
}) {
  const language = useLocale();
  const series = useMemo(() => hardware ? [chartSeries.system_w, ...hardwareSeries] : [chartSeries.system_w], [hardware]);
  const { start, end } = timeline;
  const data = "points" in timeline ? timeline : null;
  const points = data?.points ?? EMPTY_POINTS;
  const events = data?.events ?? EMPTY_EVENTS;
  const svgRef = useRef<SVGSVGElement>(null);
  const [plotWidth, setPlotWidth] = useState(compact ? 300 : 720);
  const hasPoints = points.length > 0;
  const gaps = useMemo(() => events.filter((event) => event.kind === "gap" && event.timestamp < end && (event.end ?? end) > start), [events, start, end]);
  const sleeps = useMemo(() => gaps.filter(isSleepEvent), [gaps]);
  const hasSleep = sleeps.length > 0;
  const gameIntervals = useMemo(() => showGames && data ? getGameIntervals(data) : null, [showGames, events, start, end, language]);
  const hasGameIntervals = Boolean(gameIntervals?.spans.length);
  const hasSystemReadings = compact || points.some((point) => point.system_w !== null);
  const batteryPoints = useMemo(() => points.filter((point) => point.battery_percent !== null), [points]);
  const [scrub, setScrub] = useState<number | null>(null);
  const gesture = useRef({ active: false, moved: false, startX: 0, hover: false });
  useEffect(() => { setScrub(null); }, [start, end]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !compact) return;
    const blockScroll = (event: TouchEvent) => { if (gesture.current.moved) event.preventDefault(); };
    svg.addEventListener("touchmove", blockScroll, { passive: false });
    return () => svg.removeEventListener("touchmove", blockScroll);
  }, [compact, hasPoints, hasSleep, hasGameIntervals]);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const view = svg.ownerDocument.defaultView as typeof window | null;
    if (!view) return;
    const resize = () => {
      const width = svg.clientWidth;
      if (width > 0) setPlotWidth(width);
    };
    resize();
    const observer = new view.ResizeObserver(resize);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [compact, hasPoints, hasSleep, hasGameIntervals]);
  const span = Math.max(1, end - start);
  const left = compact ? 44 : 54;
  const right = plotWidth - (compact ? 12 : 30);
  const x = (timestamp: number) => left + (timestamp - start) / span * (right - left);
  const maxW = useMemo(() => {
    let maximum = 0;
    for (const point of points) for (const item of series) maximum = Math.max(maximum, point[item.key] ?? 0);
    for (const event of sleeps) for (const item of series) {
      const before = event.before[item.key];
      const after = event.after[item.key];
      if (before !== null && after !== null && Number.isFinite(before) && Number.isFinite(after)) maximum = Math.max(maximum, before, after);
    }
    return Math.max(10, Math.ceil(maximum / 10) * 10);
  }, [points, series, sleeps]);
  const selectedTime = cursor ?? points[points.length - 1]?.timestamp ?? end;
  let selectedIndex = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (Math.abs(points[i].timestamp - selectedTime) < Math.abs(points[selectedIndex].timestamp - selectedTime)) selectedIndex = i;
  }
  const nearest = points[selectedIndex];
  const selected = nearest ?? null;
  const systemRestriction = useMemo(() => {
    if (compact || !selected || selected.system_w !== null) return null;
    if (!hasSystemReadings && points.every((point) => point.supply === "external" && (!point.errors.system_w || point.errors.system_w === "not_confirmed_battery_discharge"))) {
      return t("chart.externalAll");
    }
    return `${hasSystemReadings ? "" : t("chart.noSystemRange")}${t("chart.selectedPrefix", { reason: unavailableSystemReason(selected) })}`;
  }, [compact, selected, points, hasSystemReadings, language]);
  const systemReadingError = Boolean(selected?.errors.system_w && selected.errors.system_w !== "not_confirmed_battery_discharge");
  const markerTime = selected?.timestamp ?? selectedTime;
  const descriptions = useMemo(() => new Map(gaps.map((event) => [event, isSleepEvent(event)
    ? t("chart.sleepAria", { label: timelineEventLabel(event), start: timeText(event.timestamp, true), end: timeText(event.end, true), duration: durationText(event.end - event.timestamp) })
    : t("chart.gapAria", { label: timelineEventLabel(event), start: timeText(event.timestamp, true), end: timeText(event.end ?? end, true), duration: durationText((event.end ?? end) - event.timestamp) })])), [gaps, end, language]);
  const sleepDescription = (event: SleepEvent) => descriptions.get(event)!;
  const gapBackgrounds = (top: number, bottom: number, labelY: number) => gaps.map((event, index) => {
    const from = Math.max(left, Math.min(right, x(event.timestamp)));
    const to = Math.max(left, Math.min(right, x(event.end ?? end)));
    if (to <= from) return null;
    const sleep = event.label === "suspend";
    const description = descriptions.get(event)!;
    return <Fragment key={index}>
      <rect role="img" aria-label={description} x={from} y={top} width={to - from} height={bottom - top} fill={sleep ? semanticColors.soc : "currentColor"} opacity={sleep ? "0.18" : "0.07"}><title>{description}</title></rect>
      {sleep && to - from >= 40 && <text x={(from + to) / 2} y={labelY} textAnchor="middle" fill="currentColor" fontSize="14" aria-hidden="true">{t("chart.sleep")}</text>}
    </Fragment>;
  });
  const plot = (key: SeriesKey, top: number, bottom: number, maximum: number, smooth = false) => {
    const item = chartSeries[key];
    const paths: string[] = [];
    const dots: { x: number; y: number }[] = [];
    let path = "";
    let segment: { x: number; y: number }[] = [];
    let previous: Sample | null = null;
    const finish = () => {
      if (smooth && segment.length > 2) paths.push(smoothLine(segment));
      else if (path) paths.push(path);
      path = "";
      segment = [];
    };
    for (const point of points) {
      const value = point[key];
      if (value === null) {
        finish();
        previous = null;
        continue;
      }
      const px = x(point.timestamp);
      const py = bottom - Math.min(maximum, Math.max(0, value)) / maximum * (bottom - top);
      if (!previous || previous.segment !== point.segment || point.break_reason !== null) {
        finish();
        path = `M ${px} ${py}`;
        segment = [{ x: px, y: py }];
        if (!smooth) dots.push({ x: px, y: py });
      } else {
        path += ` L ${px} ${py}`;
        segment.push({ x: px, y: py });
      }
      previous = point;
    }
    finish();
    return <g key={key} color={semanticColors[item.role]}>
      <svg x={left} y={top} width={right - left} height={bottom - top} viewBox={`${left} ${top} ${right - left} ${bottom - top}`} overflow="hidden">
        {sleeps.map((event, index) => {
          const before = event.before[key];
          const after = event.after[key];
          if (before === null || after === null || !Number.isFinite(before) || !Number.isFinite(after)) return null;
          const elapsed = event.after.timestamp - event.before.timestamp;
          const from = Math.max(start, event.timestamp, event.before.timestamp);
          const to = Math.min(end, event.end, event.after.timestamp);
          if (elapsed <= 0 || to <= from) return null;
          const beforeY = bottom - Math.min(maximum, Math.max(0, before)) / maximum * (bottom - top);
          const afterY = bottom - Math.min(maximum, Math.max(0, after)) / maximum * (bottom - top);
          return <line key={index} x1={x(from)} y1={beforeY + (afterY - beforeY) * (from - event.before.timestamp) / elapsed} x2={x(to)} y2={beforeY + (afterY - beforeY) * (to - event.before.timestamp) / elapsed} stroke="currentColor" strokeWidth="2" strokeDasharray={item.dash || "6 4"} vectorEffect="non-scaling-stroke">
            <title>{t("series.sleepTitle", { series: t(seriesMessage[key]), description: sleepDescription(event) })}</title>
          </line>;
        })}
      </svg>
      {paths.length > 0 && <path d={paths.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={item.dash} vectorEffect="non-scaling-stroke" />}
      {dots.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r="1.6" fill="currentColor" />)}
    </g>;
  };
  if (compact) {
    const scrubbed = batteryPoints.find((point) => point.timestamp === scrub) ?? null;
    const scrubX = scrubbed ? x(scrubbed.timestamp) : 0;
    const scrubY = scrubbed ? 92 - Math.min(100, Math.max(0, scrubbed.battery_percent!)) / 100 * 72 : 0;
    const labelLeft = scrubX > (left + right) / 2;
    const clockLabel = (timestamp: number) => {
      const date = new Date(timestamp * 1000);
      return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    };
    const scrubAt = (clientX: number) => {
      const svg = svgRef.current;
      if (!svg || batteryPoints.length === 0) return;
      const bounds = svg.getBoundingClientRect();
      if (bounds.width <= 0) return;
      const localX = (clientX - bounds.left) / bounds.width * plotWidth;
      let nearest = batteryPoints[0];
      let best = Infinity;
      for (const point of batteryPoints) {
        const distance = Math.abs(x(point.timestamp) - localX);
        if (distance < best) {
          best = distance;
          nearest = point;
        }
      }
      setScrub(nearest.timestamp);
    };
    const hours: number[] = [];
    const firstHour = new Date(start * 1000);
    firstHour.setMinutes(0, 0, 0);
    if (firstHour.getTime() / 1000 < start) firstHour.setHours(firstHour.getHours() + 1);
    for (let timestamp = firstHour.getTime() / 1000; timestamp <= end; timestamp += 3600) hours.push(timestamp);
    const labeled: number[] = [];
    let previousLabel = -Infinity;
    for (const timestamp of hours) {
      const position = x(timestamp);
      if (position < left + 20 || position > right - 20 || position - previousLabel < 46) continue;
      labeled.push(timestamp);
      previousLabel = position;
    }
    const chart = <svg ref={svgRef} role="img" aria-label={`${t("chart.scrubAria")}${!hasPoints && hasSleep ? t("chart.scrubAriaSleep") : ""}`} viewBox={`0 0 ${plotWidth} 132`} style={{ width: "100%", height: 132, minHeight: 132, flexShrink: 0, display: "block", touchAction: "pan-y" }} onPointerDown={(event) => {
      gesture.current = { active: true, moved: false, startX: event.clientX, hover: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      if (gesture.current.active) {
        if (Math.abs(event.clientX - gesture.current.startX) >= 10) gesture.current.moved = true;
        if (!gesture.current.moved) return;
        gesture.current.hover = false;
        scrubAt(event.clientX);
        return;
      }
      if (event.pointerType !== "mouse" || event.buttons !== 0) return;
      gesture.current.hover = true;
      scrubAt(event.clientX);
    }} onPointerUp={(event) => {
      gesture.current.active = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onClick={(event) => { if (!gesture.current.moved) return; event.preventDefault(); event.stopPropagation(); }} onPointerCancel={() => { gesture.current.active = false; }} onPointerLeave={() => { if (gesture.current.hover && !gesture.current.active) { gesture.current.hover = false; setScrub(null); } }}>
      <title>{t("chart.scrubTitle")}</title>
      <text x="0" y="20" fill="#fff" fontSize="14">100%</text><text x="0" y="92" fill="#fff" fontSize="14">0%</text>
      {[20, 92].map((y) => <line key={y} x1={left} y1={y} x2={right} y2={y} stroke="#fff" opacity="0.15" />)}
      {gapBackgrounds(20, 92, 108)}
      {plot("battery_percent", 20, 92, 100, true)}
      <g fill="#fff" fontSize="11">
        {hours.map((timestamp) => <line key={timestamp} x1={x(timestamp)} x2={x(timestamp)} y1="92" y2="98" stroke="#fff" strokeOpacity="0.45" />)}
        {labeled.map((timestamp) => <text key={timestamp} x={x(timestamp)} y="114" textAnchor="middle">{clockLabel(timestamp)}</text>)}
      </g>
      {scrubbed && <g>
        <line x1={scrubX} y1="20" x2={scrubX} y2="92" stroke="#fff" strokeOpacity="0.35" />
        <circle cx={scrubX} cy={scrubY} r="3.5" fill="#fff" />
        <text x={labelLeft ? scrubX - 8 : scrubX + 8} y={Math.max(32, scrubY - 8)} textAnchor={labelLeft ? "end" : "start"} fill="#fff" fontSize="13" fontWeight="600">{`${Math.round(scrubbed.battery_percent!)}%`}</text>
        <text x={labelLeft ? scrubX - 8 : scrubX + 8} y={Math.max(46, scrubY + 8)} textAnchor={labelLeft ? "end" : "start"} fill="#fff" fontSize="11">{clockLabel(scrubbed.timestamp)}</text>
      </g>}
    </svg>;
    if (!onOpen) return chart;
    return <Focusable className="pt-qam-chart" onActivate={() => { if (gesture.current.moved) { gesture.current.moved = false; return; } onOpen(); }} onOKButton={() => { gesture.current.moved = false; onOpen(); }} onOKActionDescription={t("chart.openTimeline")} onGamepadBlur={() => { window.setTimeout(() => setScrub(null), 0); }} onGamepadDirection={(event) => {
      const button = event.detail.button;
      if (button !== GamepadButton.DIR_LEFT && button !== GamepadButton.DIR_RIGHT || batteryPoints.length === 0) return false;
      gesture.current.hover = false;
      setScrub((current) => {
        const middle = Math.floor((batteryPoints.length - 1) / 2);
        if (current === null) return batteryPoints[middle].timestamp;
        const index = batteryPoints.findIndex((point) => point.timestamp === current);
        const step = button === GamepadButton.DIR_LEFT ? -1 : 1;
        return batteryPoints[Math.max(0, Math.min(batteryPoints.length - 1, (index < 0 ? middle : index) + step))].timestamp;
      });
      return undefined;
    }}>{chart}</Focusable>;
  }
  return <>
    <style>{`
      .pt-fullpage .pt-chart-values { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 24px; }
      .pt-fullpage .pt-chart-auxiliary > .pt-chart-readout { display: block; margin: 0; font-variant-numeric: tabular-nums; }
      .pt-fullpage .pt-chart-context { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; margin-bottom: 8px; font-size: 13px; line-height: 18px; }
      .pt-fullpage .pt-chart-context .pt-muted { margin: 0; }
      .pt-fullpage .pt-chart-values > span { display: inline-flex; align-items: baseline; gap: 8px; }
      .pt-fullpage .pt-chart-primary { font-size: 16px; line-height: 24px; }
      .pt-fullpage .pt-chart-primary > span > .pt-color:last-child { font-size: 18px; }
      .pt-fullpage .pt-chart-readout p { margin: 6px 0 0; font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }
      .pt-fullpage .pt-chart-hardware { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 16px; margin-top: 10px; font-size: 13px; line-height: 18px; }
      .pt-fullpage .pt-chart-hardware > .pt-muted { margin: 0; }
      .pt-fullpage .pt-chart-hardware > .pt-chart-values { gap: 6px 20px; }
      .pt-fullpage .pt-chart-auxiliary > .pt-chart-guide { display: block; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--pt-border); }
      .pt-fullpage .pt-chart-guide-body { margin-top: 8px; padding-left: 12px; border-left: 1px solid var(--pt-border); }
      .pt-fullpage .pt-chart-guide-body p { display: block; margin: 6px 0; font-size: 13px; line-height: 18px; }
      .pt-timeline-chart { display: block; width: 100%; }
      .pt-timeline-chart.gpfocus, .pt-timeline-chart.gpfocuswithin, .pt-timeline-chart:focus-visible { background: transparent; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.55); outline: none; }
    `}</style>
    {/* @ts-expect-error Steam 的空容器必须带 focusableIfEmpty，否则手柄焦点树会跳过只含 SVG 的图。 */}
    <Focusable noFocusRing focusableIfEmpty className="pt-timeline-chart" preferredFocus={preferredFocus} onOKActionDescription={t("chart.selectSamples")} onGamepadDirection={(event) => {
      const button = event.detail.button;
      if (!onCursor || (button !== GamepadButton.DIR_LEFT && button !== GamepadButton.DIR_RIGHT) || points.length === 0) return false;
      const current = cursor ?? points[points.length - 1].timestamp;
      let index = 0;
      for (let i = 1; i < points.length; i += 1) if (Math.abs(points[i].timestamp - current) < Math.abs(points[index].timestamp - current)) index = i;
      const next = points[Math.max(0, Math.min(points.length - 1, index + (button === GamepadButton.DIR_LEFT ? -1 : 1)))];
      onCursor(next.timestamp);
      return true;
    }}><svg ref={svgRef} role="img" aria-label={`${t("chart.fullAria")}${showGames ? t("chart.fullAriaGames") : ""}${t("chart.fullAriaRest")}${data && !hasPoints ? t("chart.fullAriaEmpty") : ""}`} viewBox={`0 0 ${plotWidth} 260`} style={{ width: "100%", height: 260, minHeight: 260, flexShrink: 0, display: "block", touchAction: "pan-y" }} onPointerDown={(event) => {
      gesture.current = { active: true, moved: false, startX: event.clientX, hover: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      if (!gesture.current.active || !onCursor) return;
      if (Math.abs(event.clientX - gesture.current.startX) >= 10) gesture.current.moved = true;
      if (!gesture.current.moved) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width <= 0 || points.length === 0) return;
      const localX = (event.clientX - bounds.left) / bounds.width * plotWidth;
      let nearest = points[0];
      let best = Infinity;
      for (const point of points) {
        const distance = Math.abs(x(point.timestamp) - localX);
        if (distance < best) { best = distance; nearest = point; }
      }
      onCursor(nearest.timestamp);
    }} onPointerUp={(event) => {
      gesture.current.active = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onClick={(event) => { if (!gesture.current.moved) return; event.preventDefault(); event.stopPropagation(); }} onPointerCancel={() => { gesture.current.active = false; }}>
      <title>{t("chart.fullTitle")}</title>
      <desc>{t("chart.fullDesc")}</desc>
      {gameIntervals?.spans.map(({ event, from, to, lane, game }) => {
        const begin = x(from), finish = x(to);
        const name = displayGameName(game.name, game.id);
        const description = t("chart.gameInterval", { name, start: timeText(event.timestamp, true), end: timeText(event.end ?? event.last_seen, true) });
        return <g key={event.session_id} className="pt-game-interval" data-game-id={game.id} role="img" aria-label={description}>
          <title>{description}</title>
          <rect x={begin} y="16" width={finish - begin} height="221" fill={game.color} opacity="0.13" />
          <line x1={begin} x2={finish} y1={16 + lane * 3} y2={16 + lane * 3} stroke={game.color} strokeWidth="2" />
          {lane < 2 && finish - begin >= name.length * 13 + 30 && <g aria-hidden="true">
            <GameIcon gameId={game.id} svg x={begin + 4} y={112 + lane * 16} />
            <text x={begin + 27} y={126 + lane * 16} fill="currentColor" fontSize="12">{name}</text>
          </g>}
        </g>;
      })}
      <g fill="currentColor" fontSize="12">
        <text x="0" y="13">{t("chart.axisBattery")}</text><text x="14" y="28">100</text><text x="25" y="71">50</text><text x="33" y="113">0</text>
        <text x="0" y="137">{t("chart.axisPower")}</text><text x="12" y="150">{maxW}</text><text x="12" y="193">{maxW / 2}</text><text x="33" y="235">0</text>
        {axisTicks(start, end, left, right, x).map((tick) => {
          const position = x(tick.timestamp);
          return <g key={tick.timestamp}>
            <line x1={position} x2={position} y1="237" y2={tick.label ? "244" : "240"} stroke="currentColor" strokeOpacity={tick.label ? 0.5 : 0.28} />
            {tick.label && <text x={position} y="256" textAnchor={tick.anchor} fontSize="11">{tick.label}</text>}
          </g>;
        })}
      </g>
      {[24, 66.5, 109, 146, 188.5, 231].map((y) => <line key={y} x1={left} y1={y} x2={right} y2={y} stroke="currentColor" opacity="0.15" />)}
      {gapBackgrounds(16, 237, 126)}
      {plot("battery_percent", 24, 109, 100)}
      {series.map((item) => plot(item.key, 146, 231, maxW))}
      {selected && markerTime >= start && markerTime <= end && (() => {
        const markerX = x(markerTime);
        const placeLeft = markerX > (left + right) / 2;
        const textX = placeLeft ? markerX - 8 : markerX + 8;
        const anchor = placeLeft ? "end" : "start";
        const batteryY = selected.battery_percent === null ? 66.5 : 24 + (109 - 24) * (1 - Math.min(100, Math.max(0, selected.battery_percent)) / 100);
        const powerY = selected.system_w === null || maxW <= 0 ? 188.5 : 146 + (231 - 146) * (1 - Math.min(maxW, Math.max(0, selected.system_w)) / maxW);
        const date = new Date(markerTime * 1000);
        const when = span > 36 * 3600 ? `${date.getMonth() + 1}/${date.getDate()} ${padTime(date.getHours())}:${padTime(date.getMinutes())}` : `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
        const playing = (gameIntervals?.spans ?? []).filter((spanItem) => markerTime >= spanItem.from && markerTime <= spanItem.to).sort((a, b) => b.from - a.from)[0];
        const characters = playing ? Array.from(displayGameName(playing.game.name, playing.game.id)) : [];
        const gameName = characters.slice(0, 18).join("") + (characters.length > 18 ? "…" : "");
        const nameWidth = [...gameName].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 7), 0);
        const blockWidth = playing ? 22 + nameWidth : 0;
        const blockX = playing ? Math.max(left, Math.min(placeLeft ? textX - blockWidth : textX, right - blockWidth)) : textX;
        const labelY = Math.max(36, Math.min(batteryY, 76));
        const valueX = playing ? (placeLeft ? blockX + blockWidth : blockX) : textX;
        return <g fill="#fff" style={{ color: "#fff" }}>
          <line x1={markerX} y1="16" x2={markerX} y2="237" stroke="#fff" strokeOpacity="0.45" />
          {selected.battery_percent !== null && <circle cx={markerX} cy={batteryY} r="3.5" stroke="none" />}
          {selected.system_w !== null && <circle cx={markerX} cy={powerY} r="3.5" stroke="none" />}
          {playing && <>
            <GameIcon gameId={playing.game.id} svg x={blockX} y={labelY - 30} />
            <text x={blockX + 22} y={labelY - 16} textAnchor="start" fontSize="12" stroke="none">{gameName}</text>
          </>}
          <text x={valueX} y={labelY} textAnchor={playing ? (placeLeft ? "end" : "start") : anchor} fontSize="13" fontWeight="600" stroke="none">{selected.battery_percent === null ? "—" : `${Math.round(selected.battery_percent)}%`}</text>
          <text x={valueX} y={labelY + 16} textAnchor={playing ? (placeLeft ? "end" : "start") : anchor} fontSize="12" stroke="none">{selected.system_w === null ? t("chart.systemMissing") : t("chart.systemWatts", { value: selected.system_w.toFixed(2) })}</text>
          <text x={valueX} y={labelY + 32} textAnchor={playing ? (placeLeft ? "end" : "start") : anchor} fontSize="11" opacity="0.82" stroke="none">{when}</text>
        </g>;
      })()}
      {events.filter((event) => event.kind !== "gap" && (!showGames || event.kind !== "game" || (event.end ?? (event as GameTimelineEvent).last_seen) <= event.timestamp)).map((event, index) => <circle key={index} cx={Math.max(left, Math.min(right, x(event.timestamp)))} cy={event.kind === "game" ? 120 : showGames ? 141 : 127} r="3" fill="currentColor"><title>{`${timeText(event.timestamp)} ${timelineEventLabel(event)}`}</title></circle>)}
    </svg></Focusable>
    {data && <section className="pt-chart-auxiliary" aria-label={t("chart.readout")}>
      <div className="pt-chart-readout" aria-live="polite">
        <div className="pt-chart-context">
          <strong>{selected ? t("chart.sample", { time: timeText(markerTime, true) }) : t("chart.noSample")}</strong>
          {selected && <span className="pt-muted">{supplyText(selected.supply)} · {batteryStateText(selected.battery_state)}</span>}
        </div>
        <div className="pt-chart-values pt-chart-primary">
          <span><SeriesLabel seriesKey="battery_percent" /> {selected ? <SemanticValue value={selected.battery_percent} unit="%" role="battery" digits={0} /> : <span className="pt-muted">{t("chart.noReading")}</span>}</span>
          <span><SeriesLabel seriesKey="system_w" /> {selected ? <SemanticValue value={selected.system_w} unit="W" /> : <span className="pt-muted">{t("chart.noReading")}</span>}</span>
        </div>
        {systemRestriction && <p className="pt-chart-system-status" role="status">{systemReadingError ? <SemanticText role="error">{systemRestriction}</SemanticText> : systemRestriction}</p>}
        {hardware && <div className="pt-chart-hardware" aria-label={t("chart.hardwareAria")}>
          <span className="pt-muted">{t("chart.hardware")}</span>
          <div className="pt-chart-values">{hardwareSeries.map((item) => <span key={item.key}><SeriesLabel seriesKey={item.key} /> {selected ? <SemanticValue value={selected[item.key]} unit="W" /> : <span className="pt-muted">{t("chart.noReading")}</span>}</span>)}</div>
        </div>}
      </div>
      {gameIntervals && <GameLegend games={gameIntervals.games} />}
      <ChartGuide hardware={hardware} games={hasGameIntervals} sleep={hasSleep} gaps={gaps.some((event) => !isSleepEvent(event))} />
    </section>}
    {totals && data && <PageReading label={t("chart.coverage")} className="pt-inline-facts">{t("chart.coverageValue", { covered: durationText(data.coverage_seconds), span: durationText(end - start) })} <SemanticValue value={data.system_wh} unit="Wh" role="system" /></PageReading>}
    {selected && <Restrictions errors={selected.errors} label={t("chart.sampleStatus")} />}
  </>;
});
