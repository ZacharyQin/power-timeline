import { Focusable, GamepadButton } from "@decky/ui";
import { useRef } from "react";
import { setLocale, t, useLocale, type Locale } from "./i18n";

const flags: { locale: Locale; confirm: string }[] = [
  { locale: "zh-cn", confirm: "使用中文" },
  { locale: "en", confirm: "use English" },
  { locale: "pt", confirm: "usar português" },
  { locale: "es", confirm: "usar español" },
  { locale: "ja", confirm: "日本語を使う" },
  { locale: "ko", confirm: "한국어 사용" },
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
function PortugalFlag() {
  return <svg viewBox="0 0 30 20" aria-hidden="true">
    <rect width="12" height="20" fill="#006600" />
    <rect x="12" width="18" height="20" fill="#FF0000" />
    <circle cx="12" cy="10" r="4.2" fill="#FFCC00" />
    <circle cx="12" cy="10" r="2.4" fill="#fff" />
    <circle cx="12" cy="10" r="1.2" fill="#003399" />
  </svg>;
}

function SpainFlag() {
  return <svg viewBox="0 0 30 20" aria-hidden="true">
    <rect width="30" height="20" fill="#AA151B" />
    <rect y="5" width="30" height="10" fill="#F1BF00" />
  </svg>;
}

function JapanFlag() {
  return <svg viewBox="0 0 30 20" aria-hidden="true">
    <rect width="30" height="20" fill="#fff" />
    <circle cx="15" cy="10" r="5.2" fill="#BC002D" />
  </svg>;
}

function KoreaFlag() {
  return <svg viewBox="0 0 30 20" aria-hidden="true">
    <rect width="30" height="20" fill="#fff" />
    <circle cx="15" cy="10" r="4.6" fill="#CD2E3A" />
    <path d="M15 5.4a4.6 4.6 0 0 1 0 9.2 2.3 2.3 0 0 1 0-4.6 2.3 2.3 0 0 0 0-4.6z" fill="#0047A0" />
    <g fill="#111" stroke="#111" strokeWidth="0.45">
      <path d="M4 3.2h3.2M4 4.4h3.2M4 5.6h1.2M6 5.6h1.2" />
      <path d="M22.8 3.2h3.2M22.8 4.4h1.2M25.2 4.4h.8M22.8 5.6h3.2" />
      <path d="M4 14.2h3.2M4 15.4h1.2M6 15.4h1.2M4 16.6h3.2" />
      <path d="M22.8 14.2h1.2M25.2 14.2h.8M22.8 15.4h3.2M22.8 16.6h1.2M25.2 16.6h.8" />
    </g>
  </svg>;
}

function FlagPicture({ locale }: { locale: Locale }) {
  if (locale === "zh-cn") return <ChinaFlag />;
  if (locale === "pt") return <PortugalFlag />;
  if (locale === "es") return <SpainFlag />;
  if (locale === "ja") return <JapanFlag />;
  if (locale === "ko") return <KoreaFlag />;
  return <UsFlag />;
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
      .pt-locale-row { display: block; margin-top: 20px; max-width: 100%; overflow-x: auto; touch-action: pan-y; }
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
        <FlagPicture locale={flag.locale} />
      </Focusable>)}
    </Focusable>
  </div>;
}
