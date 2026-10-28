import { DialogButtonSecondary, Focusable, GamepadButton } from "@decky/ui";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { FaChartLine } from "react-icons/fa";
import { getBatteryHealth } from "./backend";
import { dailyHealthSeries, healthDay } from "./batteryHealth";
import { IconLabel, SemanticValue, valueText } from "./components";
import { useQuery } from "./data";
import { semanticColors } from "./displaySemantics";
import { PageQueryStatus } from "./FullPage";
import { numberLocale, t, useLocale } from "./i18n";

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function BatteryHealthChart({ visible }: { visible: boolean }) {
  useLocale();
  const query = useQuery("battery-health", getBatteryHealth, visible, 60_000);
  const [days, setDays] = useState<number | null>(30);
  const [cursor, setCursor] = useState<string | null>(null);
  const gesture = useRef({ x: 0, y: 0, active: false, moved: false });
  const svgRef = useRef<SVGSVGElement>(null);
  const [plotWidth, setPlotWidth] = useState(720);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const view = svg?.ownerDocument.defaultView as typeof window | null;
    if (!svg || !view) return;
    const resize = () => {
      if (svg.clientWidth > 0) setPlotWidth(svg.clientWidth);
    };
    resize();
    const observer = new view.ResizeObserver(resize);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const today = localToday();
  const plot = useMemo(() => dailyHealthSeries(query.data?.points ?? [], days, today), [query.data, days, today]);
  const selectedIndex = Math.max(0, cursor === null ? plot.points.length - 1 : plot.points.findIndex((point) => point.day === cursor));
  const selected = plot.points[selectedIndex];
  const left = 54, right = plotWidth - 18, top = 10, bottom = 104;
  const x = (day: number) => left + (day - plot.start) / (plot.end - plot.start) * (right - left);
  const y = (health: number) => bottom - (health - plot.minimum) / (plot.maximum - plot.minimum) * (bottom - top);
  const formatter = new Intl.DateTimeFormat(numberLocale(), { year: plot.end - plot.start > 180 ? "numeric" : undefined, month: "short", day: "numeric", timeZone: "UTC" });
  const dateText = (day: number) => formatter.format(new Date(day * 86_400_000));
  const tickCount = plotWidth < 480 ? 2 : plotWidth < 720 ? 3 : 4;
  const ticks = Array.from(new Set(Array.from({ length: tickCount }, (_, index) => Math.round(plot.start + (plot.end - plot.start) * index / (tickCount - 1))))).filter((day) => day >= plot.start && day <= plot.end);
  const chooseAt = (clientX: number, svg: SVGSVGElement) => {
    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0 || plot.points.length === 0) return;
    const localX = (clientX - bounds.left) / bounds.width * plotWidth;
    let nearest = plot.points[0];
    for (const point of plot.points) if (Math.abs(x(healthDay(point.day)) - localX) < Math.abs(x(healthDay(nearest.day)) - localX)) nearest = point;
    setCursor(nearest.day);
  };
  return <section className="pt-health-history" aria-label={t("health.title")}>
    <style>{`
      .pt-fullpage .pt-health-history { padding: 10px 14px; border: 1px solid var(--pt-border); border-radius: 8px; }
      .pt-fullpage .pt-health-header, .pt-fullpage .pt-health-reading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 12px; }
      .pt-fullpage .pt-health-header h2 { margin: 0; font-size: 15px; line-height: 20px; font-weight: 600; }
      .pt-fullpage .pt-health-ranges { display: flex; flex-wrap: wrap; gap: 4px; }
      .pt-fullpage .pt-health-ranges button.pt-compact-button { min-width: 0; padding: 4px 8px; font-size: 12px; }
      .pt-fullpage .pt-health-range-selected:not(.gpfocus):not(:focus-visible) { box-shadow: inset 0 -2px 0 currentColor; }
      .pt-fullpage .pt-health-chart { display: block; margin-top: 8px; }
      .pt-fullpage .pt-health-chart.gpfocus { box-shadow: inset 0 0 0 1px currentColor; }
      .pt-fullpage .pt-health-reading { font-size: 14px; line-height: 22px; font-variant-numeric: tabular-nums; }
      .pt-fullpage .pt-health-reading strong { font-size: 20px; }
      .pt-fullpage .pt-health-empty { margin: 6px 0; font-size: 14px; }
    `}</style>
    <header className="pt-health-header">
      <h2><IconLabel icon={FaChartLine}>{t("health.title")}</IconLabel></h2>
      <Focusable className="pt-health-ranges" flow-children="row" aria-label={t("range.aria")}>
        {([[30, "health.30d"], [90, "health.90d"], [365, "health.365d"], [null, "health.all"]] as const).map(([range, label]) => <Focusable key={range ?? "all"}><DialogButtonSecondary className={`pt-compact-button${days === range ? " pt-health-range-selected" : ""}`} aria-pressed={days === range} onClick={() => { setDays(range); setCursor(null); }}>{t(label)}</DialogButtonSecondary></Focusable>)}
      </Focusable>
    </header>
    <PageQueryStatus loading={query.loading && !query.data} error={query.error ?? query.data?.error ?? null} retry={query.refresh} />
    {/* @ts-expect-error Steam must include an SVG-only container in the native focus tree. */}
    <Focusable focusableIfEmpty className="pt-health-chart" onGamepadDirection={(event) => {
      const button = event.detail.button;
      if ((button !== GamepadButton.DIR_LEFT && button !== GamepadButton.DIR_RIGHT) || !selected) return false;
      const index = Math.max(0, Math.min(plot.points.length - 1, selectedIndex + (button === GamepadButton.DIR_LEFT ? -1 : 1)));
      setCursor(plot.points[index].day);
      return true;
    }}><svg ref={svgRef} role="img" aria-label={t("health.aria")} viewBox={`0 0 ${plotWidth} 132`} style={{ display: "block", width: "100%", height: 132, flexShrink: 0, touchAction: "pan-y" }} onPointerDown={(event) => {
      gesture.current = { x: event.clientX, y: event.clientY, active: true, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      const state = gesture.current;
      if (!state.active) return;
      const dx = Math.abs(event.clientX - state.x), dy = Math.abs(event.clientY - state.y);
      if (!state.moved && (dx < 10 || dy > dx)) return;
      state.moved = true;
      chooseAt(event.clientX, event.currentTarget);
    }} onPointerUp={(event) => {
      if (gesture.current.active && (gesture.current.moved || Math.abs(event.clientY - gesture.current.y) < 10)) chooseAt(event.clientX, event.currentTarget);
      gesture.current.active = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={() => { gesture.current.active = false; }}>
      <title>{t("health.title")}</title>
      {[plot.minimum, (plot.minimum + plot.maximum) / 2, plot.maximum].map((value) => <g key={value}>
        <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="currentColor" opacity="0.15" />
        <text x={left - 8} y={y(value) + 4} textAnchor="end" fill="currentColor" fontSize="12">{valueText(value, "%", 1)}</text>
      </g>)}
      {ticks.map((day) => <text key={day} x={x(day)} y="124" textAnchor={x(day) < left + 40 ? "start" : x(day) > right - 40 ? "end" : "middle"} fill="currentColor" fontSize="12">{dateText(day)}</text>)}
      <g stroke={semanticColors.battery} fill={semanticColors.battery}>
        {plot.segments.filter((segment) => segment.length > 1).map((segment) => <path key={segment[0].day} d={segment.map((point, index) => `${index ? "L" : "M"} ${x(healthDay(point.day))} ${y(point.health_percent)}`).join(" ")} fill="none" strokeWidth="2" />)}
        {plot.points.map((point) => <circle key={point.day} cx={x(healthDay(point.day))} cy={y(point.health_percent)} r={point.day === selected?.day ? 4 : 2.5}><title>{point.day} · {valueText(point.health_percent, "%", 1)}</title></circle>)}
      </g>
      {selected && <line x1={x(healthDay(selected.day))} x2={x(healthDay(selected.day))} y1={top} y2={bottom} stroke="currentColor" opacity="0.35" strokeDasharray="3 3" />}
    </svg></Focusable>
    {selected ? <div className="pt-health-reading" aria-live="polite">
      <time dateTime={selected.day}>{dateText(healthDay(selected.day))}</time>
      <span>{valueText(selected.full_capacity, "", selected.capacity_unit === "mAh" ? 0 : 2).trimEnd()} / {valueText(selected.design_capacity, selected.capacity_unit, selected.capacity_unit === "mAh" ? 0 : 2)}</span>
      <strong><SemanticValue value={selected.health_percent} unit="%" role="battery" digits={1} /></strong>
    </div> : !query.loading && !query.error && <p className="pt-health-empty">{t("health.empty")}</p>}
  </section>;
}
