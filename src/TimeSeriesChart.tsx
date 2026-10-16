import { DialogButtonSecondary, Focusable, SliderField } from "@decky/ui";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FaClock, FaInfoCircle } from "react-icons/fa";
import { IconLabel, PowerScaleLegend, Reading, Restrictions, SemanticText, SemanticValue, batteryStateText, durationText, reasonText, supplyText, timeText } from "./components";
import { PageReading } from "./FullPage";
import { GameIcon } from "./GameIcon";
import { GameLegend } from "./GameLegend";
import { chartSeries, hardwareSeries, semanticColors } from "./displaySemantics";
import type { SeriesKey } from "./displaySemantics";
import { getGameIntervals, isSleepEvent, timelineEventLabel } from "./timelineEvents";
import type { SleepEvent } from "./timelineEvents";
import type { GameTimelineEvent, Sample, Timeline } from "./types";

function SeriesLabel({ seriesKey }: { seriesKey: SeriesKey }) {
  const item = chartSeries[seriesKey];
  return <SemanticText role={item.role}><svg aria-hidden="true" width="24" height="10" viewBox="0 0 24 10" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 6 }}><line x1="0" y1="5" x2="24" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={item.dash} /></svg>{seriesKey === "system_w" ? "整机功率" : item.label}</SemanticText>;
}

function unavailableSystemReason(sample: Sample): string {
  const error = sample.errors.system_w;
  if (error && error !== "not_confirmed_battery_discharge") return `整机功率读取失败：${reasonText(error)}`;
  if (sample.supply === "external") return "外接供电，无法用电池读数计算整机功率。";
  if (sample.supply !== "battery") return "供电状态未确认，暂不能计算整机功率。";
  if (sample.battery_state.toLowerCase() !== "discharging") return "电池未处于确认放电状态，暂不能计算整机功率。";
  return "缺少可用的电池功率读数，暂不能计算整机功率。";
}

function ChartGuide({ hardware, games, sleep, gaps }: { hardware: boolean; games: boolean; sleep: boolean; gaps: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  return <Focusable className="pt-chart-guide" flow-children="column">
    <DialogButtonSecondary className="pt-compact-button" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded(!expanded)}>
      <IconLabel icon={FaInfoCircle}>{expanded ? "收起颜色与读图说明" : "颜色与读图说明"}</IconLabel>
    </DialogButtonSecondary>
    {expanded && <div id={bodyId} className="pt-chart-guide-body">
      <PowerScaleLegend />
      <p>线样与名称识别曲线；W数字颜色仅表示绝对功率大小，不随图表峰值变化。</p>
      {hardware && <p>硬件域为独立遥测，APU与CPU／SoC／GPU不相加，也不代替整机功率。</p>}
      {games && <p>游戏底色只标记进程观测区间，不代表前台独占或游戏整机耗电；颜色配合图标和名称识别。</p>}
      {sleep && <p>休眠底色与虚线仅连接真实端点，不生成期间样本、读数或能量。</p>}
      {gaps && <p>其他记录缺口保持断线，不补采样或能量。</p>}
      <p>曲线间的圆点标记事件；游标仅选择真实样本。</p>
    </div>}
  </Focusable>;
}

export function TimeSeriesChart({ timeline, cursor, onCursor, hardware = false, compact = false, showGames = false }: {
  timeline: Timeline;
  cursor?: number | null;
  onCursor?: (timestamp: number) => void;
  hardware?: boolean;
  compact?: boolean;
  showGames?: boolean;
}) {
  const series = useMemo(() => hardware ? [chartSeries.system_w, ...hardwareSeries] : [chartSeries.system_w], [hardware]);
  const { points, start, end } = timeline;
  const svgRef = useRef<SVGSVGElement>(null);
  const [plotWidth, setPlotWidth] = useState(compact ? 300 : 720);
  const hasPoints = points.length > 0;
  const gaps = useMemo(() => timeline.events.filter((event) => event.kind === "gap" && event.timestamp < end && (event.end ?? end) > start), [timeline.events, start, end]);
  const sleeps = useMemo(() => gaps.filter(isSleepEvent), [gaps]);
  const hasSleep = sleeps.length > 0;
  const gameIntervals = useMemo(() => showGames ? getGameIntervals(timeline) : null, [showGames, timeline.events, start, end]);
  const hasGameIntervals = Boolean(gameIntervals?.spans.length);
  const hasSystemReadings = compact || points.some((point) => point.system_w !== null);
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
      return "本段均为外接供电，无法用电池读数计算整机功率。";
    }
    return `${hasSystemReadings ? "" : "本段未取得整机功率。"}所选样本：${unavailableSystemReason(selected)}`;
  }, [compact, selected, points, hasSystemReadings]);
  const systemReadingError = Boolean(selected?.errors.system_w && selected.errors.system_w !== "not_confirmed_battery_discharge");
  const markerTime = selected?.timestamp ?? selectedTime;
  const sleepDescription = (event: SleepEvent) => `${timelineEventLabel(event)}：${timeText(event.timestamp, true)} — ${timeText(event.end, true)}（${durationText(event.end - event.timestamp)}）。虚线仅连接前后真实端点，不是休眠期间的实测或估算值，不补样本、不补算能量。`;
  const gapBackgrounds = (top: number, bottom: number, labelY: number) => gaps.map((event, index) => {
    const from = Math.max(left, Math.min(right, x(event.timestamp)));
    const to = Math.max(left, Math.min(right, x(event.end ?? end)));
    if (to <= from) return null;
    const sleep = event.label === "suspend";
    const description = isSleepEvent(event) ? sleepDescription(event) : `${timelineEventLabel(event)}：${timeText(event.timestamp, true)} — ${timeText(event.end ?? end, true)}（${durationText((event.end ?? end) - event.timestamp)}）；无采样，不连接、不补算能量。`;
    return <g key={index} role="img" aria-label={description}>
      <title>{description}</title>
      <rect x={from} y={top} width={to - from} height={bottom - top} fill={sleep ? semanticColors.soc : "currentColor"} opacity={sleep ? "0.18" : "0.07"} />
      {sleep && to - from >= 40 && <text x={(from + to) / 2} y={labelY} textAnchor="middle" fill="currentColor" fontSize="14" aria-hidden="true">休眠</text>}
    </g>;
  });
  const plot = (key: SeriesKey, top: number, bottom: number, maximum: number) => {
    const item = chartSeries[key];
    const paths: string[] = [];
    const dots: { x: number; y: number }[] = [];
    let path = "";
    let previous: Sample | null = null;
    for (const point of points) {
      const value = point[key];
      if (value === null) {
        if (path) paths.push(path);
        path = "";
        previous = null;
        continue;
      }
      const px = x(point.timestamp);
      const py = bottom - Math.min(maximum, Math.max(0, value)) / maximum * (bottom - top);
      if (!previous || previous.segment !== point.segment || point.break_reason !== null) {
        if (path) paths.push(path);
        path = `M ${px} ${py}`;
        dots.push({ x: px, y: py });
      } else path += ` L ${px} ${py}`;
      previous = point;
    }
    if (path) paths.push(path);
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
            <title>{`${item.label}：${sleepDescription(event)}`}</title>
          </line>;
        })}
      </svg>
      {paths.map((d, index) => <path key={index} d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={item.dash} vectorEffect="non-scaling-stroke" />)}
      {dots.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r="1.6" fill="currentColor" />)}
    </g>;
  };
  if (!hasPoints && !hasSleep && !hasGameIntervals) return compact ? <Reading icon={FaClock} label="此范围尚无样本" description="初次启用只记录之后的数据；缺失区间不补算。" /> : <PageReading label="此范围尚无样本" description="初次启用只记录之后的数据；缺失区间不补算。" />;
  if (compact) return <svg ref={svgRef} role="img" aria-label={`最近三十分钟电池百分比；休眠背景标注休眠，虚线仅连接真实端点；其他缺口断线；不补样本、不补算能量${!hasPoints ? "；休眠期间无采样" : ""}`} viewBox={`0 0 ${plotWidth} 112`} style={{ width: "100%", height: 112, minHeight: 112, flexShrink: 0, display: "block" }}>
    <title>电池百分比 · 最近三十分钟 · 休眠虚线仅连接真实端点，其他缺口不连接</title>
    <desc>休眠背景的时间和时长见区间提示；虚线是前后真实端点的视觉连接，不代表休眠期间的实测或估算值，不提供插值读数，不补算能量。</desc>
    <text x="0" y="20" fill="currentColor" fontSize="14">100%</text><text x="0" y="92" fill="currentColor" fontSize="14">0%</text>
    {[20, 92].map((y) => <line key={y} x1={left} y1={y} x2={right} y2={y} stroke="currentColor" opacity="0.15" />)}
    {gapBackgrounds(20, 92, 108)}
    {plot("battery_percent", 20, 92, 100)}
  </svg>;
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
    `}</style>
    <svg ref={svgRef} role="img" aria-label={`同时间轴电池百分比和功率；电池与瓦特分别标轴；${showGames ? "游戏底色为实际观测区间；" : ""}休眠虚线仅连接真实端点，其他缺口断线；不补样本、不补算能量${!hasPoints ? "；此范围无采样" : ""}`} viewBox={`0 0 ${plotWidth} 360`} style={{ width: "100%", height: 360, minHeight: 360, flexShrink: 0, display: "block" }}>
      <title>电池 % 与功率 W；共用时间轴；休眠虚线仅连接真实端点，其他缺口不连接</title>
      <desc>休眠背景的时间和时长见区间提示；虚线仅连接前后真实端点，不是休眠期间的实测或估算值。游标只选择实际样本，其他缺口保持断线，不补样本、不补算能量。</desc>
      {gameIntervals?.spans.map(({ event, from, to, lane, game }) => {
        const begin = x(from), finish = x(to);
        const description = `${game.name} · 游戏观测区间：${timeText(event.timestamp, true)} — ${timeText(event.end ?? event.last_seen, true)}`;
        return <g key={event.session_id} className="pt-game-interval" data-game-id={game.id} role="img" aria-label={description}>
          <title>{description}</title>
          <rect x={begin} y="25" width={finish - begin} height="298" fill={game.color} opacity="0.13" />
          <line x1={begin} x2={finish} y1={25 + lane * 3} y2={25 + lane * 3} stroke={game.color} strokeWidth="2" />
          {lane < 2 && finish - begin >= game.name.length * 13 + 30 && <g aria-hidden="true">
            <GameIcon gameId={game.id} svg x={begin + 4} y={148 + lane * 18} />
            <text x={begin + 27} y={162 + lane * 18} fill="currentColor" fontSize="13">{game.name}</text>
          </g>}
        </g>;
      })}
      <g fill="currentColor" fontSize="14">
        <text x="0" y="18">电池 %</text><text x="14" y="39">100</text><text x="25" y="94">50</text><text x="33" y="149">0</text>
        <text x="0" y="186">功率 W</text><text x="12" y="207">{maxW}</text><text x="12" y="262">{maxW / 2}</text><text x="33" y="317">0</text>
        <text x={left} y="351">{timeText(start)}</text><text x={(left + right) / 2} y="351" textAnchor="middle">{timeText(start + span / 2)}</text><text x={right} y="351" textAnchor="end">{timeText(end)}</text>
      </g>
      {[35, 90, 145, 203, 258, 313].map((y) => <line key={y} x1={left} y1={y} x2={right} y2={y} stroke="currentColor" opacity="0.15" />)}
      {gapBackgrounds(25, 323, 162)}
      {plot("battery_percent", 35, 145, 100)}
      {series.map((item) => plot(item.key, 203, 313, maxW))}
      {selected && markerTime >= start && markerTime <= end && <line x1={x(markerTime)} y1="25" x2={x(markerTime)} y2="323" stroke="currentColor" strokeDasharray="2 3" />}
      {timeline.events.filter((event) => event.kind !== "gap" && (!showGames || event.kind !== "game" || (event.end ?? (event as GameTimelineEvent).last_seen) <= event.timestamp)).map((event, index) => <circle key={index} cx={Math.max(left, Math.min(right, x(event.timestamp)))} cy={event.kind === "game" ? 162 : showGames ? 193 : 175} r="3" fill="currentColor"><title>{`${timeText(event.timestamp)} ${event.label}`}</title></circle>)}
    </svg>
    {(onCursor || !hasPoints) && <SliderField className={`pt-chart-cursor${points.length < 2 ? " pt-semantic-disabled" : ""}`} label="样本游标" value={selectedIndex} min={0} max={Math.max(1, points.length - 1)} step={1} minimumDpadGranularity={1} showValue={false} disabled={points.length < 2} onChange={(index) => { const point = points[Math.round(index)]; if (point) onCursor?.(point.timestamp); }} />}
    <section className="pt-chart-auxiliary" aria-label="样本读数与图例">
      <div className="pt-chart-readout" aria-live="polite">
        <div className="pt-chart-context">
          <strong>{selected ? `所选样本 · ${timeText(markerTime, true)}` : "此范围无采样"}</strong>
          {selected && <span className="pt-muted">{supplyText(selected.supply)} · {batteryStateText(selected.battery_state)}</span>}
        </div>
        <div className="pt-chart-values pt-chart-primary">
          <span><SeriesLabel seriesKey="battery_percent" /> {selected ? <SemanticValue value={selected.battery_percent} unit="%" role="battery" digits={0} /> : <span className="pt-muted">无采样</span>}</span>
          <span><SeriesLabel seriesKey="system_w" /> {selected ? <SemanticValue value={selected.system_w} unit="W" /> : <span className="pt-muted">无采样</span>}</span>
        </div>
        {systemRestriction && <p className="pt-chart-system-status" role="status">{systemReadingError ? <SemanticText role="error">{systemRestriction}</SemanticText> : systemRestriction}</p>}
        {hardware && <div className="pt-chart-hardware" aria-label="硬件功耗域遥测">
          <span className="pt-muted">硬件遥测</span>
          <div className="pt-chart-values">{hardwareSeries.map((item) => <span key={item.key}><SeriesLabel seriesKey={item.key} /> {selected ? <SemanticValue value={selected[item.key]} unit="W" /> : <span className="pt-muted">无采样</span>}</span>)}</div>
        </div>}
      </div>
      {gameIntervals && <GameLegend games={gameIntervals.games} />}
      <ChartGuide hardware={hardware} games={hasGameIntervals} sleep={hasSleep} gaps={gaps.some((event) => !isSleepEvent(event))} />
    </section>
    <PageReading label="电池供电有效覆盖" className="pt-inline-facts">{durationText(timeline.coverage_seconds)} / {durationText(end - start)} · 整机 <SemanticValue value={timeline.system_wh} unit="Wh" role="system" /></PageReading>
    {selected && <Restrictions errors={selected.errors} label="所选样本状态" />}
  </>;
}
