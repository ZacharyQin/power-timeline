import { useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import type { PowerInfo } from "./types";
import { ART_LAYERS, createQamHeat, DECK_VIEW, EXHAUST_PERIOD, HEAT_RESOLUTION, REFERENCE_FAN_RPM, ROTOR, THERMAL_MARKS, thermalFrame, thermalHostMm, type QamHeat } from "./thermalField";

type Thermals = PowerInfo["thermals"];

const ART = "http://127.0.0.1:1337/plugins/Power%20Timeline/dist";
const PARTS: { key: "battery_c" | "chip_c" | "wireless_c" | "ssd_c"; mark: "battery" | "apu" | "wireless" | "ssd"; label: Parameters<typeof t>[0] }[] = [
  { key: "battery_c", mark: "battery", label: "qam.partBattery" },
  { key: "chip_c", mark: "apu", label: "qam.partChip" },
  { key: "wireless_c", mark: "wireless", label: "qam.partWifi" },
  { key: "ssd_c", mark: "ssd", label: "qam.partSsd" },
];

function text(celsius: number | null) {
  return celsius == null || Number.isNaN(celsius) ? "—" : `${celsius.toFixed(0)}°`;
}

function layerStyle(box: { x: number; y: number; w: number; h: number }) {
  return {
    left: `${(box.x - DECK_VIEW.x) / DECK_VIEW.w * 100}%`,
    top: `${(box.y - DECK_VIEW.y) / DECK_VIEW.h * 100}%`,
    width: `${box.w / DECK_VIEW.w * 100}%`,
    height: `${box.h / DECK_VIEW.h * 100}%`,
  };
}

function markStyle(mark: "battery" | "apu" | "wireless" | "ssd") {
  const part = THERMAL_MARKS.find((item) => item.key === mark)!;
  return {
    left: `${(part.x - DECK_VIEW.x) / DECK_VIEW.w * 100}%`,
    top: `${(part.y - DECK_VIEW.y) / DECK_VIEW.h * 100}%`,
  };
}

function placeOverlay(art: HTMLElement, overlay: HTMLElement, canvas: HTMLCanvasElement) {
  const width = art.clientWidth;
  if (width < 2 || canvas.width < 2) return;
  const scale = width / DECK_VIEW.w;
  overlay.style.left = `${art.offsetLeft + (thermalFrame.x - DECK_VIEW.x) * scale}px`;
  overlay.style.top = `${art.offsetTop + (thermalFrame.y - DECK_VIEW.y) * scale}px`;
  overlay.style.transform = `scale(${thermalFrame.width * scale / canvas.width})`;
}

function holdRpm(held: { current: number | null }, at: { current: number }, incoming: number | null, now: number) {
  const next = incoming ?? 0;
  const previous = held.current;
  if (previous === null || (previous === 0 && next > 0) || now - at.current >= 5000) {
    held.current = next;
    at.current = now;
  }
  return held.current ?? 0;
}

export function QamThermal({ thermals, active }: { thermals: Thermals | null; active: boolean }) {
  const art = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const exhaustCanvas = useRef<HTMLCanvasElement>(null);
  const exhaustMask = useRef<HTMLDivElement>(null);
  const exhaustGradient = useRef<HTMLDivElement>(null);
  const rotor = useRef<HTMLImageElement>(null);
  const heat = useRef<QamHeat | null>(null);
  const rotorMotion = useRef<Animation | null>(null);
  const exhaustMotion = useRef<Animation | null>(null);
  const maskKey = useRef("");
  const exhaustColor = useRef("");
  const heldRpm = useRef<number | null>(null);
  const heldAt = useRef(0);
  const latest = useRef({ thermals, active });
  latest.current = { thermals, active };
  const [failed, setFailed] = useState(false);

  function syncScene() {
    const engine = heat.current;
    const { thermals: reading, active: showing } = latest.current;
    const rpm = holdRpm(heldRpm, heldAt, reading?.fan_rpm ?? null, performance.now());
    if (engine && reading) {
      engine.setState({
        battery: reading.battery_c,
        apu: reading.chip_c,
        wireless: reading.wireless_c,
        ssd: reading.ssd_c,
      }, rpm);
      const maskChanged = engine.render();
      const bounds = engine.getExhaustBounds();
      const root = overlay.current?.querySelector(".pt-qam-exhaust");
      const mask = exhaustMask.current;
      const gradient = exhaustGradient.current;
      const shown = Boolean(bounds && showing && rpm > 0);
      if (root instanceof HTMLElement) root.style.visibility = shown ? "visible" : "hidden";
      if (shown && bounds && mask && gradient) {
        const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
        const crop = exhaustCanvas.current;
        if (crop && (maskChanged || key !== maskKey.current)) {
          const picture = document.createElement("canvas");
          picture.width = bounds.width;
          picture.height = bounds.height;
          const context = picture.getContext("2d");
          if (context) {
            context.drawImage(crop, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
            mask.style.left = `${bounds.x}px`;
            mask.style.top = `${bounds.y}px`;
            mask.style.width = `${bounds.width}px`;
            mask.style.height = `${bounds.height}px`;
            mask.style.maskImage = `url(${picture.toDataURL("image/png")})`;
            mask.style.setProperty("-webkit-mask-image", mask.style.maskImage);
            gradient.style.backgroundPosition = `0px ${-bounds.y}px`;
            maskKey.current = key;
          }
        }
        const color = engine.getExhaustColor();
        if (color !== exhaustColor.current) {
          gradient.style.setProperty("--flow-color", color);
          exhaustColor.current = color;
        }
      } else maskKey.current = "";
    }
    const spin = rotorMotion.current;
    const flow = exhaustMotion.current;
    if (spin) {
      const rotorRate = rpm * ROTOR.visualTimeScale / 60;
      if (rotorRate > 0 && spin.playbackRate !== rotorRate) spin.updatePlaybackRate(rotorRate);
      if (showing && rotorRate > 0) { if (spin.playState !== "running") spin.play(); }
      else if (spin.playState !== "paused") spin.pause();
    }
    if (flow) {
      const flowRate = 32 * (rpm / REFERENCE_FAN_RPM) * HEAT_RESOLUTION / EXHAUST_PERIOD;
      if (flowRate > 0 && flow.playbackRate !== flowRate) {
        flow.updatePlaybackRate(flowRate);
        const steps = Math.max(1, Math.round(30 / flowRate));
        flow.effect?.updateTiming({ easing: `steps(${steps}, end)` });
      }
      if (showing && rpm > 0) { if (flow.playState !== "running") flow.play(); }
      else if (flow.playState !== "paused") flow.pause();
    }
  }

  const syncRef = useRef(syncScene);
  syncRef.current = syncScene;

  useEffect(() => {
    const node = canvas.current;
    const mask = exhaustCanvas.current;
    const rotorNode = rotor.current;
    const gradient = exhaustGradient.current;
    if (!node || !mask || !rotorNode || !gradient) return;
    heat.current = createQamHeat(node, mask);
    const spin = rotorNode.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(-360deg)" }],
      { duration: 1000, iterations: Infinity },
    );
    spin.pause();
    spin.currentTime = 0;
    rotorMotion.current = spin;
    const flow = gradient.animate(
      [{ transform: "translateY(0px)" }, { transform: `translateY(${-EXHAUST_PERIOD}px)` }],
      { duration: 1000, iterations: Infinity },
    );
    flow.pause();
    flow.currentTime = 0;
    exhaustMotion.current = flow;
    syncRef.current();
    return () => {
      spin.cancel();
      flow.cancel();
      rotorMotion.current = null;
      exhaustMotion.current = null;
      heat.current = null;
    };
  }, []);

  useEffect(() => {
    const artNode = art.current;
    const overlayNode = overlay.current;
    const node = canvas.current;
    if (!artNode || !overlayNode || !node) return;
    const place = () => placeOverlay(artNode, overlayNode, node);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(artNode);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    syncRef.current();
  }, [thermals, active]);

  return <div aria-hidden={failed}>
    <div className="pt-qam-thermal" style={{ aspectRatio: `${DECK_VIEW.w} / ${thermalHostMm}` }}>
      <div className="pt-qam-thermal-art" ref={art}>
        <img alt="" className="pt-qam-hardware" src={`${ART}/front-hardware.png`} style={layerStyle(ART_LAYERS.hardware)} onError={() => setFailed(true)} />
        <img alt="" className="pt-qam-rotor" ref={rotor} src={`${ART}/front-rotor.png`} style={{ ...layerStyle(ART_LAYERS.rotor), transformOrigin: `${(ROTOR.x - ART_LAYERS.rotor.x) / ART_LAYERS.rotor.w * 100}% ${(ROTOR.y - ART_LAYERS.rotor.y) / ART_LAYERS.rotor.h * 100}%` }} />
        <img alt="" className="pt-qam-fan-front" src={`${ART}/front-fan-front.png`} style={layerStyle(ART_LAYERS.fan)} />
        {PARTS.map((part) => <span key={part.key} className={`pt-qam-thermal-tag pt-qam-thermal-tag-${part.mark}`} style={markStyle(part.mark)} aria-label={`${t(part.label)} ${text(thermals ? thermals[part.key] : null)}`}><span className="pt-qam-thermal-tag-name">{t(part.label)}</span>{text(thermals ? thermals[part.key] : null)}</span>)}
      </div>
      <div className="pt-qam-thermal-overlay" ref={overlay}>
        <canvas ref={canvas} />
        <canvas className="pt-qam-exhaust-buffer" ref={exhaustCanvas} />
        <div className="pt-qam-exhaust">
          <div className="pt-qam-exhaust-mask" ref={exhaustMask}>
            <div className="pt-qam-exhaust-gradient" ref={exhaustGradient} style={{ top: `${-EXHAUST_PERIOD}px`, height: `calc(100% + ${EXHAUST_PERIOD * 2}px)`, backgroundSize: `100% ${EXHAUST_PERIOD}px` }} />
          </div>
        </div>
      </div>
    </div>
  </div>;
}
