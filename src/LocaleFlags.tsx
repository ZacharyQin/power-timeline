import { Focusable, GamepadButton } from "@decky/ui";
import { useRef } from "react";
import { setLocale, t, useLocale, type Locale } from "./i18n";

const flags: { locale: Locale; confirm: string }[] = [
  { locale: "zh-cn", confirm: "使用中文" },
  { locale: "en", confirm: "use English" },
];

function star(cx: number, cy: number, radius: number) {
  const points: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const outer = -Math.PI / 2 + i * (2 * Math.PI / 5);
    const inner = outer + Math.PI / 5;
    points.push(`${cx + Math.cos(outer) * radius},${cy + Math.sin(outer) * radius}`);
    points.push(`${cx + Math.cos(inner) * radius * 0.382},${cy + Math.sin(inner) * radius * 0.382}`);
  }
  return points.join(" ");
}

function ChinaFlag() {
  return <svg viewBox="0 0 30 20" aria-hidden="true">
    <rect width="30" height="20" fill="#DE2910" />
    <polygon points={star(5, 5, 3)} fill="#FFDE00" />
    <polygon points={star(10.2, 2.2, 1)} fill="#FFDE00" />
    <polygon points={star(12.2, 4.4, 1)} fill="#FFDE00" />
    <polygon points={star(12.2, 7.2, 1)} fill="#FFDE00" />
    <polygon points={star(10.2, 9.2, 1)} fill="#FFDE00" />
  </svg>;
}

function UsFlag() {
  return <svg viewBox="0 0 30 20" aria-hidden="true">
    {Array.from({ length: 13 }, (_, index) => <rect key={index} y={(index * 20) / 13} width="30" height={20 / 13 + 0.2} fill={index % 2 === 0 ? "#B22234" : "#fff"} />)}
    <rect width="12" height={(20 * 7) / 13} fill="#3C3B6E" />
    {[0, 1, 2, 3, 4].map((row) => [0, 1, 2].slice(0, row % 2 === 0 ? 3 : 2).map((column) => {
      const x = 1.6 + column * 3.4 + (row % 2 === 0 ? 0 : 1.7);
      const y = 1.1 + row * 1.7;
      return <polygon key={`${row}-${column}`} points={star(x, y, 0.55)} fill="#fff" />;
    }))}
  </svg>;
}

export function LocaleFlags() {
  const locale = useLocale();
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  const gesture = useRef({ x: 0, index: 0, moved: false });
  const focusFlag = (index: number) => nodes.current[Math.max(0, Math.min(flags.length - 1, index))]?.focus();
  return <div className="pt-locale-row" onPointerDown={(event) => {
    const hit = event.target instanceof Element ? event.target.closest("[data-index]") : null;
    gesture.current = { x: event.clientX, index: hit ? Number(hit.getAttribute("data-index")) : 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }} onPointerMove={(event) => {
    const distance = event.clientX - gesture.current.x;
    if (Math.abs(distance) < 28) return;
    gesture.current.moved = true;
    gesture.current.x = event.clientX;
    gesture.current.index = Math.max(0, Math.min(flags.length - 1, gesture.current.index + (distance < 0 ? 1 : -1)));
    focusFlag(gesture.current.index);
  }} onPointerUp={(event) => {
    if (gesture.current.moved) return;
    const hit = event.target instanceof Element ? event.target.closest("[data-index]") : null;
    const index = hit ? Number(hit.getAttribute("data-index")) : gesture.current.index;
    if (Number.isInteger(index)) setLocale(flags[index].locale);
  }}>
    <style>{`
      .pt-locale-row { display: block; margin-top: 20px; touch-action: pan-y; }
      .pt-locale-flags { display: flex; align-items: center; gap: 12px; width: max-content; }
      .pt-locale-flag { position: relative; width: 32px; height: 22px; border-radius: 3px; overflow: hidden; }
      .pt-locale-flag svg { display: block; width: 100%; height: 100%; }
      .pt-locale-flag-current::after { content: ""; position: absolute; left: 3px; right: 3px; bottom: 2px; height: 2px; background: currentColor; }
      .pt-locale-flag.gpfocus, .pt-locale-flag.gpfocuswithin { outline: 2px solid currentColor; outline-offset: 3px; }
    `}</style>
    <Focusable className="pt-locale-flags" flow-children="row" aria-label={t("lang.row")}>
      {flags.map((flag, index) => <Focusable key={flag.locale} className={`pt-locale-flag${locale === flag.locale ? " pt-locale-flag-current" : ""}`} data-index={index} ref={(node: HTMLDivElement | null) => { nodes.current[index] = node; }} onOKButton={() => setLocale(flag.locale)} onActivate={() => { if (gesture.current.moved) { gesture.current.moved = false; return; } setLocale(flag.locale); }} onOKActionDescription={flag.confirm} onGamepadDirection={(event) => {
        const button = event.detail.button;
        if (button !== GamepadButton.DIR_LEFT && button !== GamepadButton.DIR_RIGHT) return false;
        const next = index + (button === GamepadButton.DIR_LEFT ? -1 : 1);
        if (next < 0 || next >= flags.length) return true;
        focusFlag(next);
        return true;
      }}>
        {flag.locale === "zh-cn" ? <ChinaFlag /> : <UsFlag />}
      </Focusable>)}
    </Focusable>
  </div>;
}
