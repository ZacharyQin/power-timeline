import { Focusable, GamepadButton } from "@decky/ui";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { t } from "./i18n";

const TEMP_MIN = 40;
const TEMP_MAX = 100;
const WATT_MAX = 20;
const RPM_MAX = 7300;
const CHIP = "#E6D58A";
const SSD_COLOR = "#7BDCC5";
const POWER = "#B5A0D4";
const WIDTH = 268;
const HEIGHT = 96;
const AXIS_L = 52;
const AXIS_R = 224;
const MEASURED_X = 256;
const PLOT_T = 16;
const PLOT_B = 80;

type CurveView = "chip" | "ssd" | "power";
type Overrides = { chip?: number; ssd?: number; watts?: number };

const chipOnly = (temp: number) => Math.trunc(0.762 * temp * temp - 26.7 * temp + 1257);
const diskOnly = (temp: number) => temp < 55 ? 0 : Math.trunc(4.57 * temp * temp - 531 * temp + 17394);
const bonus = (watts: number) => Math.trunc(225 * watts - 1575);
const deviceRequest = (temp: number, value: number) => temp > 90 ? RPM_MAX : Math.max(value, 0);
const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;
const clampRpm = (rpm: number) => Math.min(RPM_MAX, Math.max(0, rpm));
const yOf = (rpm: number) => PLOT_T + (RPM_MAX - clampRpm(rpm)) / RPM_MAX * (PLOT_B - PLOT_T);
const xT = (temp: number) => AXIS_L + (Math.min(TEMP_MAX, Math.max(TEMP_MIN, temp)) - TEMP_MIN) / (TEMP_MAX - TEMP_MIN) * (AXIS_R - AXIS_L);
const tOf = (x: number) => Math.min(TEMP_MAX, Math.max(TEMP_MIN, TEMP_MIN + (x - AXIS_L) / (AXIS_R - AXIS_L) * (TEMP_MAX - TEMP_MIN)));
const xP = (watts: number) => AXIS_L + Math.min(WATT_MAX, Math.max(0, watts)) / WATT_MAX * (AXIS_R - AXIS_L);
const pOf = (x: number) => Math.min(WATT_MAX, Math.max(0, (x - AXIS_L) / (AXIS_R - AXIS_L) * WATT_MAX));

function path(value: (input: number) => number, xOf: (input: number) => number, start: number, end: number, step: number) {
  const points: string[] = [];
  for (let input = start; input <= end + 1e-9; input += step) points.push(`${xOf(input).toFixed(2)},${yOf(value(input)).toFixed(2)}`);
  return points.join(" ");
}

function winningView(chip: number | null, ssd: number | null, watts: number): "chip" | "ssd" {
  const chipRpm = chip == null ? null : deviceRequest(chip, chipOnly(chip) + bonus(watts));
  const ssdRpm = ssd == null ? null : deviceRequest(ssd, diskOnly(ssd));
  if (ssdRpm == null || (chipRpm != null && chipRpm >= ssdRpm)) return "chip";
  return "ssd";
}

function nextView(current: CurveView): CurveView {
  if (current === "chip") return "ssd";
  if (current === "ssd") return "power";
  return "chip";
}

function formatTemp(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

export function QamFanCurve({ chip, ssd, watts, rpm, open }: { chip: number | null; ssd: number | null; watts: number | null; rpm: number | null; open: boolean }) {
  const [manual, setManual] = useState<CurveView | null>(null);
  const [override, setOverride] = useState<Overrides>({});
  const moved = useRef(false);
  const scrubView = useRef<CurveView>("chip");
  const gesture = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!open) return;
    setManual(null);
    setOverride({});
  }, [open]);

  const chipTemp = override.chip ?? chip;
  const ssdTemp = override.ssd ?? ssd;
  const wattValue = override.watts ?? watts;
  const usedWatts = wattValue ?? 7;
  const view = manual ?? winningView(chipTemp, ssdTemp, usedWatts);
  const chipAt = (temp: number) => deviceRequest(temp, chipOnly(temp) + bonus(usedWatts));
  const ssdAt = (temp: number) => deviceRequest(temp, diskOnly(temp));
  const chipRpm = chipTemp == null ? null : chipAt(chipTemp);
  const ssdRpm = ssdTemp == null ? null : ssdAt(ssdTemp);
  const powerOn = view === "power";
  const chipOn = view === "chip";
  const diskOn = view === "ssd";
  const chipOpacity = chipOn ? 1 : 0.18;
  const diskOpacity = diskOn ? 1 : 0.18;
  const powerOpacity = powerOn ? 1 : 0.18;
  const activeX = powerOn ? xP(usedWatts) : diskOn && ssdTemp != null ? xT(ssdTemp) : chipTemp != null ? xT(chipTemp) : AXIS_L;
  const shownRpm = powerOn ? bonus(usedWatts) : diskOn ? ssdRpm ?? 0 : chipRpm ?? 0;
  const activeColor = powerOn ? POWER : diskOn ? SSD_COLOR : CHIP;

  function scrubTo(x: number, target: CurveView, markMoved: boolean) {
    if (markMoved) moved.current = true;
    setManual(target);
    if (target === "power") setOverride((current) => ({ ...current, watts: Math.round(pOf(x) * 2) / 2 }));
    else if (target === "ssd") setOverride((current) => ({ ...current, ssd: Math.round(tOf(x)) }));
    else setOverride((current) => ({ ...current, chip: Math.round(tOf(x)) }));
  }
  function step(direction: number) {
    setManual(view);
    if (view === "power") {
      const base = wattValue ?? 0;
      setOverride((current) => ({ ...current, watts: Math.round(Math.min(WATT_MAX, Math.max(0, base + direction * 0.5)) * 2) / 2 }));
    } else if (view === "ssd") {
      const base = ssdTemp ?? TEMP_MIN;
      setOverride((current) => ({ ...current, ssd: Math.round(Math.min(TEMP_MAX, Math.max(TEMP_MIN, base + direction))) }));
    } else {
      const base = chipTemp ?? TEMP_MIN;
      setOverride((current) => ({ ...current, chip: Math.round(Math.min(TEMP_MAX, Math.max(TEMP_MIN, base + direction))) }));
    }
  }
  function pointerAt(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height };
  }
  const rows = powerOn
    ? [{ name: t("qam.fanApu"), color: POWER, text: wattValue == null ? "—" : `${wattValue.toFixed(1)}W → ${signed(bonus(wattValue))} RPM`, on: true }]
    : [
      { name: t("qam.fanProcessor"), color: CHIP, text: chipTemp == null || chipRpm == null ? "—" : `${formatTemp(chipTemp)}°C → ${chipRpm} RPM`, on: chipOn },
      { name: t("qam.fanSsd"), color: SSD_COLOR, text: ssdTemp == null || ssdRpm == null ? "—" : `${formatTemp(ssdTemp)}°C → ${ssdRpm} RPM`, on: diskOn },
    ];

  return <Focusable className="pt-qam-fan-focus" noFocusRing onOKActionDescription={t("qam.fanSwitch")} onOKButton={() => { moved.current = false; setManual(nextView(view)); }} onActivate={() => { if (moved.current) { moved.current = false; return; } setManual(nextView(view)); }} onGamepadDirection={(event) => {
    const button = event.detail.button;
    if (button !== GamepadButton.DIR_LEFT && button !== GamepadButton.DIR_RIGHT) return false;
    step(button === GamepadButton.DIR_RIGHT ? 1 : -1);
    return undefined;
  }}>
    <figure className="pt-qam-fan">
      <div className="pt-qam-fan-legend">
        <span className={chipOn ? undefined : "off"}><i className="pt-qam-fan-swatch" style={{ borderTopColor: CHIP }} />{t("qam.fanProcessor")}</span>
        <span className={diskOn ? undefined : "off"}><i className="pt-qam-fan-swatch pt-qam-fan-swatch-dash" style={{ borderTopColor: SSD_COLOR }} />{t("qam.fanSsd")}</span>
        <span className={powerOn ? undefined : "off"}><i className="pt-qam-fan-swatch" style={{ borderTopColor: POWER }} />{t("qam.fanPower")}</span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t("qam.fanCurve")} onPointerDown={(event) => {
        const pos = pointerAt(event);
        if (!pos || pos.x < AXIS_L - 8 || pos.x > AXIS_R + 8 || pos.y < 0 || pos.y > HEIGHT) return;
        moved.current = false;
        scrubView.current = pos.y <= PLOT_T ? "power" : view;
        const dragging = event.pointerType !== "touch";
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging };
        if (dragging) {
          scrubTo(pos.x, scrubView.current, false);
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }} onPointerMove={(event) => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        if (!current.dragging) {
          const dx = Math.abs(event.clientX - current.x);
          const dy = Math.abs(event.clientY - current.y);
          if (dy > 6 && dy >= dx) { gesture.current = null; return; }
          if (dx <= 6 || dx <= dy) return;
          current.dragging = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        const pos = pointerAt(event);
        if (!pos) return;
        scrubTo(pos.x, scrubView.current, true);
      }} onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }}>
        <text x="2" y="11" fill="currentColor" fillOpacity="0.55" fontSize="9">RPM</text>
        <text x="46" y="11" fill={POWER} fillOpacity={powerOn ? 1 : 0.35} fontSize="10" textAnchor="end">W</text>
        <line x1={AXIS_L} y1={PLOT_T} x2={AXIS_R} y2={PLOT_T} stroke="currentColor" strokeOpacity={powerOn ? 0.55 : 0.12} />
        {[0, 7, 15, 20].map((watt) => <text key={watt} x={xP(watt)} y="11" fill="currentColor" fillOpacity={powerOn ? 0.9 : 0.28} fontSize="10" textAnchor="middle">{watt}</text>)}
        {[0, 2000, 7300].map((mark) => <g key={mark}>
          <line x1={AXIS_L} y1={yOf(mark)} x2={AXIS_R} y2={yOf(mark)} stroke="currentColor" strokeOpacity="0.1" />
          {Math.abs(yOf(shownRpm) - yOf(mark)) >= 12 && <text x="46" y={yOf(mark)} dominantBaseline="middle" fill="currentColor" fillOpacity="0.55" fontSize="10" textAnchor="end">{mark}</text>}
        </g>)}
        <polyline points={path(chipAt, xT, 40, 100, 0.25)} fill="none" stroke={CHIP} strokeOpacity={chipOpacity} strokeWidth={chipOn ? 2.2 : 1.3} />
        <path d={`M${xT(40)},${yOf(0)} L${xT(55) - 2.2},${yOf(0)}`} fill="none" stroke={SSD_COLOR} strokeOpacity={diskOpacity} strokeWidth="1.5" strokeDasharray="4 3" />
        <circle cx={xT(55)} cy={yOf(0)} r="2.2" fill="none" stroke={SSD_COLOR} strokeOpacity={diskOpacity} />
        <polyline points={path(ssdAt, xT, 55, 100, 0.25)} fill="none" stroke={SSD_COLOR} strokeOpacity={diskOpacity} strokeWidth={diskOn ? 2.2 : 1.3} strokeDasharray="4 3" />
        <circle cx={xT(55)} cy={yOf(ssdAt(55))} r="2" fill={SSD_COLOR} fillOpacity={diskOpacity} />
        <polyline points={path(bonus, xP, 0, 20, 0.125)} fill="none" stroke={POWER} strokeOpacity={powerOpacity} strokeWidth={powerOn ? 2.2 : 1.3} />
        <line x1={AXIS_L - 2} y1={yOf(shownRpm)} x2={activeX} y2={yOf(shownRpm)} stroke={activeColor} strokeOpacity="0.7" />
        <line x1={activeX} y1={powerOn ? PLOT_T : PLOT_B} x2={activeX} y2={yOf(shownRpm)} stroke="currentColor" strokeOpacity="0.45" strokeDasharray="2 3" />
        {chipTemp != null && chipRpm != null && <circle cx={xT(chipTemp)} cy={yOf(chipRpm)} r={chipOn ? 3 : 2} fill={CHIP} fillOpacity={chipOpacity} />}
        {ssdTemp != null && ssdRpm != null && <circle cx={xT(ssdTemp)} cy={yOf(ssdRpm)} r={diskOn ? 3 : 2} fill={SSD_COLOR} fillOpacity={diskOpacity} />}
        {powerOn && <circle cx={xP(usedWatts)} cy={yOf(bonus(usedWatts))} r="3" fill={POWER} />}
        <text x="46" y={yOf(shownRpm)} dominantBaseline="middle" fill={activeColor} fontSize="10" textAnchor="end">{powerOn ? signed(shownRpm) : shownRpm}</text>
        {rpm != null && <text x="266" y={yOf(rpm) - 8} fill="currentColor" fillOpacity="0.55" fontSize="9" textAnchor="end">{t("qam.fanMeasured")}</text>}
        {rpm != null && <circle cx={MEASURED_X} cy={yOf(rpm)} r="2.5" fill="#fff" />}
        <line x1={AXIS_L} y1={PLOT_B} x2={AXIS_R} y2={PLOT_B} stroke="currentColor" strokeOpacity={powerOn ? 0.12 : 0.55} />
        {[40, 55, 70, 85, 100].map((temp) => <text key={temp} x={xT(temp)} y="94" fill="currentColor" fillOpacity={powerOn ? 0.28 : 0.9} fontSize="10" textAnchor="middle">{temp}</text>)}
        <text x="34" y="94" fill="currentColor" fillOpacity={powerOn ? 0.35 : 1} fontSize="10" textAnchor="end">°C</text>
      </svg>
      <div className="pt-qam-fan-read">
        {rows.map((row) => <span key={row.name} className={row.on ? "pt-qam-fan-read-row" : "pt-qam-fan-read-row off"}><span className="pt-qam-fan-read-name" style={{ color: row.color }}>{row.name}</span><span className="pt-qam-fan-read-value">{row.text}</span></span>)}
      </div>
    </figure>
  </Focusable>;
}


