import { Focusable, GamepadButton, PanelSectionRow, Toggle } from "@decky/ui";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FaBolt } from "react-icons/fa";
import { t } from "./i18n";

const MIN = 20;
const MAX = 100;

type ClientSettingWriter = (value: boolean | number) => void;
type Pending<T> = { value: T; until: number };

function readClientSetting(key: string): [unknown, ClientSettingWriter | null] {
  const host: object = globalThis;
  if (!("settingsStore" in host)) return [undefined, null];
  const store = host.settingsStore;
  if (!store || typeof store !== "object" || !("GetClientSetting" in store) || typeof store.GetClientSetting !== "function") return [undefined, null];
  try {
    const result = store.GetClientSetting(key);
    if (!Array.isArray(result)) return [undefined, null];
    const [value, write] = result;
    const writeSetting: ClientSettingWriter | null = typeof write === "function" ? write : null;
    return [value, writeSetting];
  } catch {
    return [undefined, null];
  }
}

function clampLimit(value: number) {
  return Math.round(Math.min(MAX, Math.max(MIN, value)));
}
const navAudio: { player: { PlayNavSound: (id: number) => void } | null; ids: { up: number; down: number; decade: number; confirm: number } | null } = { player: null, ids: null };

function loadNavAudio() {
  if (navAudio.ids) return;
  const root = globalThis as { webpackChunksteamui?: unknown[]; SteamUIStore?: { m_GamepadUIAudioStore?: { PlayNavSound?: (id: number) => void } } };
  const chunk = root.webpackChunksteamui;
  const player = root.SteamUIStore?.m_GamepadUIAudioStore;
  if (!chunk || !player?.PlayNavSound) return;
  chunk.push([["pt-nav-audio"], {}, (require: { m: Record<string, unknown> }) => {
    for (const factory of Object.values(require.m)) {
      const source = Function.prototype.toString.call(factory);
      if (!source.includes("SliderUp=") || !source.includes("ChangeTabs=") || !source.includes("DefaultOk=")) continue;
      const read = (name: string) => {
        const match = source.match(new RegExp(`${name}=(\\d+)`));
        return match ? Number(match[1]) : null;
      };
      const up = read("SliderUp");
      const down = read("SliderDown");
      const decade = read("ChangeTabs");
      const confirm = read("DefaultOk");
      if (up == null || down == null || decade == null || confirm == null || !player.PlayNavSound) continue;
      const play = player.PlayNavSound.bind(player);
      navAudio.player = { PlayNavSound: play };
      navAudio.ids = { up, down, decade, confirm };
      return;
    }
  }]);
}

function playNav(id: number | null | undefined) {
  if (id == null || !navAudio.player) return;
  try { navAudio.player.PlayNavSound(id); } catch { /* a missing UI sound should not block the limit */ }
}

function playLimitStep(previous: number, next: number) {
  if (previous === next) return;
  loadNavAudio();
  const right = next > previous;
  const decade = Math.floor(previous / 10) !== Math.floor(next / 10);
  if (decade) playNav(navAudio.ids?.decade);
  else playNav(right ? navAudio.ids?.up : navAudio.ids?.down);
  pulseDeck(right ? 1 : 0, decade ? 2 : 1, decade ? 3 : 2, decade ? -3 : -2);
}

function playLimitConfirm() {
  loadNavAudio();
  playNav(navAudio.ids?.confirm);
  pulseDeck(2, 2, 4, -5);
}

const NEPTUNE = 4;
let deckIndex: number | null = null;
let sawControllers = false;
let controllerWatch: { unregister: () => void } | null = null;

function deckController(): number | null {
  const input = (globalThis as { SteamClient?: { Input?: { TriggerSimpleHapticEvent?: (index: number, location: number, hapticType: number, intensity: number, gainDb: number) => void; RegisterForControllerListChanges?: (callback: (list: { nControllerIndex: number; eControllerType: number }[]) => void) => { unregister: () => void } } } }).SteamClient?.Input;
  if (!input?.TriggerSimpleHapticEvent) return null;
  if (!controllerWatch && input.RegisterForControllerListChanges) {
    controllerWatch = input.RegisterForControllerListChanges((list) => {
      sawControllers = true;
      deckIndex = list.find((item) => item.eControllerType === NEPTUNE)?.nControllerIndex ?? null;
    });
  }
  if (deckIndex != null) return deckIndex;
  return sawControllers ? null : 0;
}

function pulseDeck(location: number, hapticType: number, intensity: number, gainDb: number) {
  const input = (globalThis as { SteamClient?: { Input?: { TriggerSimpleHapticEvent?: (index: number, location: number, hapticType: number, intensity: number, gainDb: number) => void } } }).SteamClient?.Input;
  const index = deckController();
  if (!input?.TriggerSimpleHapticEvent || index == null) return;
  try { input.TriggerSimpleHapticEvent(index, location, hapticType, intensity, gainDb); } catch { /* haptic must not block the limit */ }
}


function ChargeGlyph({ name }: { name: "plug" | "plus" | "pause" | "dash" }) {
  if (name === "plug") return <svg width="11" height="16" viewBox="4 1 8 12" aria-hidden="true"><path fill="currentColor" d="M6 1h1.6v3.2H6V1zm2.4 0H10v3.2H8.4V1zM4 4.6h8v1.4a4 4 0 0 1-3.2 3.9V13H7.2V9.9A4 4 0 0 1 4 6V4.6z" /></svg>;
  if (name === "plus") return <svg width="12" height="12" viewBox="2 1 10 10" aria-hidden="true"><path fill="currentColor" d="M6 1h2v4h4v2H8v4H6V7H2V5h4V1z" /></svg>;
  if (name === "pause") return <svg width="11" height="16" viewBox="1 1 10 14" aria-hidden="true"><path fill="currentColor" d="M1 1h3.2v14H1V1zm6.8 0H11v14H7.8V1z" /></svg>;
  return <svg width="14" height="4" viewBox="2 7 12 2" aria-hidden="true"><path fill="currentColor" d="M2 7h12v2H2z" /></svg>;
}

export function ChargeLimit({ active, percent, charging }: { active: boolean; percent: number | null; charging: boolean }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const writeEnabled = useRef<ClientSettingWriter | null>(null);
  const writeLimit = useRef<ClientSettingWriter | null>(null);
  const pendingEnabled = useRef<Pending<boolean> | null>(null);
  const pendingLimit = useRef<Pending<number> | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const shownLimit = useRef(limit);
  const baseline = useRef<number | null>(null);
  const editingRef = useRef(false);
  const aLatch = useRef(false);
  const [editing, setEditing] = useState(false);
  shownLimit.current = gesture.current?.dragging || editingRef.current ? shownLimit.current : limit;
  editingRef.current = editing;
  const barRef = useRef<HTMLDivElement>(null);
  const iconsRef = useRef<HTMLDivElement>(null);
  const level = percent == null ? null : Math.min(100, Math.max(0, percent));
  const held = charging && on === true && level != null && limit != null && level >= limit;
  const tone = !charging ? "idle" : level != null && level < 20 ? "low" : "charge";
  const glyphs: Array<"plug" | "plus" | "pause" | "dash"> = !charging ? ["dash"] : held ? ["plug", "pause"] : ["plug", "plus"];

  useEffect(() => {
    if (!active) return;
    const read = () => {
      const [enabled, setEnabled] = readClientSetting("steamos_charge_limit_enabled");
      const [value, setValue] = readClientSetting("steamos_charge_limit");
      if (setEnabled) writeEnabled.current = setEnabled;
      if (setValue) writeLimit.current = setValue;
      const enabledPending = pendingEnabled.current;
      if (!(enabledPending && Date.now() < enabledPending.until && enabled !== enabledPending.value)) {
        pendingEnabled.current = null;
        setOn(typeof enabled === "boolean" ? enabled : null);
      }
      const limitPending = pendingLimit.current;
      if (!(limitPending && Date.now() < limitPending.until && value !== limitPending.value)) {
        pendingLimit.current = null;
        setLimit(typeof value === "number" ? value : null);
      }
    };
    read();
    const timer = window.setInterval(read, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const icons = iconsRef.current;
    if (!bar || !icons || level == null) return;
    icons.classList.remove("pt-qam-charge-icons-hide");
    const fillWidth = bar.clientWidth * level / 100;
    icons.classList.toggle("pt-qam-charge-icons-hide", fillWidth < icons.offsetWidth + 16);
  }, [level, glyphs.join()]);

  function preview(next: number) {
    const value = clampLimit(next);
    pendingLimit.current = { value, until: Date.now() + 3000 };
    shownLimit.current = value;
    setLimit(value);
  }
  function commit(next: number) {
    const value = clampLimit(next);
    pendingLimit.current = { value, until: Date.now() + 3000 };
    shownLimit.current = value;
    setLimit(value);
    writeLimit.current?.(value);
  }
  function point(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return (event.clientX - rect.left) / rect.width * 100;
  }

  if (on === null || !writeEnabled.current) return null;
  return <>
    <style>{`
      .pt-qam-charge-bar { position: relative; height: 36px; margin: 6px 0 22px; border-radius: 0; background: none; box-shadow: none; overflow: visible; }
      .pt-qam-charge-bar.gpfocus, .pt-qam-charge-bar.gpfocuswithin, .pt-qam-charge-bar:focus-visible { outline: 1px solid rgba(255, 255, 255, 0.5); outline-offset: 2px; }
      .pt-qam-charge-hit { position: absolute; inset: 0; border-radius: 18px; border: 0; background: rgba(255,255,255,0.16); box-shadow: 0 6px 16px rgba(0,0,0,0.45); backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2); touch-action: pan-y; cursor: pointer; user-select: none; -webkit-user-select: none; overflow: visible; }
      .pt-qam-charge-fill { position: absolute; inset: 0 auto 0 0; border-radius: 18px; background: rgba(123,220,197,0.72); box-shadow: inset 0 1px 0 rgba(255,255,255,0.35); }
      .pt-qam-charge-fill-low { background: rgba(229,72,77,0.88); }
      .pt-qam-charge-fill-idle { background: rgba(255,255,255,0.18); box-shadow: inset 0 1px 0 rgba(255,255,255,0.16); }
      .pt-qam-charge-icons { position: absolute; top: 0; bottom: 0; z-index: 1; display: flex; align-items: center; gap: 2px; transform: translateX(-50%); pointer-events: none; color: #fff; }
      .pt-qam-charge-icons-hide { display: none; }
      .pt-qam-charge-icons svg { display: block; }
      .pt-qam-charge-bar-off .pt-qam-charge-thumb { display: none; }
      .pt-qam-charge-thumb { position: absolute; z-index: 2; top: -3px; bottom: -3px; width: 6px; margin-left: -3px; border-radius: 3px; background: rgba(255,255,255,0.28); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.35); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
      .pt-qam-limit { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; background: transparent; }
      .pt-qam-limit-copy { min-width: 0; }
      .pt-qam-limit-title { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; }
      .pt-qam-limit-note { font-size: 11px; line-height: 15px; color: color-mix(in srgb, #fff 62%, transparent); }
    `}</style>
    {level != null && <PanelSectionRow>
      {/* @ts-expect-error Steam 导航树要显式 focusable，Decky 的 Focusable 类型没声明这个属性。 */}
      <Focusable focusable
        noFocusRing
        tabIndex={0}
        className={on ? "pt-qam-charge-bar" : "pt-qam-charge-bar pt-qam-charge-bar-off"}
        onOKActionDescription={editing ? t("qam.chargeConfirm") : t("qam.chargeEnter")}
        onOptionsActionDescription={editing ? t("qam.chargeRevert") : t("qam.chargeReset")}
        onOKButton={() => {
          if (!on || shownLimit.current == null || aLatch.current) return;
          aLatch.current = true;
          queueMicrotask(() => { aLatch.current = false; });
          if (!editingRef.current) {
            baseline.current = shownLimit.current;
            editingRef.current = true;
            setEditing(true);
            return;
          }
          commit(shownLimit.current);
          playLimitConfirm();
          baseline.current = shownLimit.current;
          editingRef.current = false;
          setEditing(false);
        }}
        onActivate={() => {
          if (!on || shownLimit.current == null || aLatch.current) return;
          aLatch.current = true;
          queueMicrotask(() => { aLatch.current = false; });
          if (!editingRef.current) {
            baseline.current = shownLimit.current;
            editingRef.current = true;
            setEditing(true);
          }
        }}
        onOptionsButton={() => {
          if (!on) return;
          if (editingRef.current) {
            const back = baseline.current;
            editingRef.current = false;
            setEditing(false);
            if (back != null) preview(back);
            return;
          }
          baseline.current = 80;
          commit(80);
          playLimitConfirm();
        }}
        onGamepadBlur={() => {
          if (!editingRef.current) return;
          const back = baseline.current;
          editingRef.current = false;
          setEditing(false);
          if (back != null) preview(back);
        }}
        onGamepadDirection={(event) => {
          const button = event.detail.button;
          if (!on || !editingRef.current || shownLimit.current == null || (button !== GamepadButton.DIR_LEFT && button !== GamepadButton.DIR_RIGHT)) return false;
          const previous = shownLimit.current;
          preview(shownLimit.current + (button === GamepadButton.DIR_RIGHT ? 1 : -1));
          playLimitStep(previous, shownLimit.current);
          return true;
        }}
        onKeyDown={(event) => {
          if (!on || !editingRef.current || shownLimit.current == null || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
          event.preventDefault();
          const previous = shownLimit.current;
          preview(shownLimit.current + (event.key === "ArrowRight" ? 1 : -1));
          playLimitStep(previous, shownLimit.current);
        }}
      >
        <div
          className="pt-qam-charge-hit"
          ref={barRef}
          role="slider"
          aria-label={t("qam.chargeLimit")}
          aria-valuemin={MIN}
          aria-valuemax={MAX}
          aria-valuenow={on && limit != null ? limit : Math.round(level)}
          aria-disabled={!on}
          onPointerDown={(event) => {
            if (!on || !event.isPrimary || event.button !== 0) return;
            const dragging = event.pointerType !== "touch";
            gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging };
            if (!dragging) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const next = point(event);
            if (next != null && shownLimit.current != null) { const previous = shownLimit.current; preview(next); playLimitStep(previous, shownLimit.current); }
          }}
          onPointerMove={(event) => {
            const current = gesture.current;
            if (!on || !current || current.id !== event.pointerId) return;
            if (!current.dragging) {
              const dx = Math.abs(event.clientX - current.x);
              const dy = Math.abs(event.clientY - current.y);
              if (dy > 6 && dy >= dx) { gesture.current = null; return; }
              if (dx <= 6 || dx <= dy) return;
              current.dragging = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            const next = point(event);
            if (next != null && shownLimit.current != null) { const previous = shownLimit.current; preview(next); playLimitStep(previous, shownLimit.current); }
          }}
          onPointerUp={() => {
            if (gesture.current?.dragging && shownLimit.current != null) {
              commit(shownLimit.current);
              playLimitConfirm();
              baseline.current = shownLimit.current;
              editingRef.current = false;
              setEditing(false);
            }
            gesture.current = null;
          }}
          onPointerCancel={() => { gesture.current = null; }}
        >
          <div className={tone === "charge" ? "pt-qam-charge-fill" : `pt-qam-charge-fill pt-qam-charge-fill-${tone}`} style={{ width: `${level}%` }} />
          <div ref={iconsRef} className="pt-qam-charge-icons" style={{ left: `${level / 2}%` }}>
            {glyphs.map((name) => <ChargeGlyph key={name} name={name} />)}
          </div>
          {limit != null && <i className="pt-qam-charge-thumb" style={{ left: `${limit}%` }} />}
        </div>
      </Focusable>
    </PanelSectionRow>}
    <PanelSectionRow>
      <Focusable className="pt-qam-limit">
        <div className="pt-qam-limit-copy">
          <div className="pt-qam-limit-title"><FaBolt aria-hidden="true" />{t("qam.chargeLimit")}</div>
          <div className="pt-qam-limit-note">{on ? t("qam.chargeStop", { limit: limit ?? "—" }) : t("qam.chargeUnlimited")}</div>
        </div>
        <Toggle aria-label={t("qam.chargeLimit")} value={on} onChange={(value) => { pendingEnabled.current = { value, until: Date.now() + 3000 }; setOn(value); writeEnabled.current?.(value); }} />
      </Focusable>
    </PanelSectionRow>
  </>;
}
