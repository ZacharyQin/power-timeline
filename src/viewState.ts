import { useSyncExternalStore } from "react";
import type { Metric, Range, Sort, TimelineEvent } from "./types";

export type Page = "timeline" | "power" | "games" | "sessions" | "detail" | "help";
interface ViewState {
  page: Page;
  range: Range;
  bounds: { start: number; end: number };
  live: boolean;
  cursor: number | null;
  detailCursors: Record<string, number>;
  hardware: boolean;
  metric: Metric;
  sort: Sort;
  gameId: string | null;
  gameName: string;
  sessionId: string | null;
  detailOrigin: "timeline" | "sessions";
  helpOrigin: Exclude<Page, "help">;
  event: TimelineEvent | null;
  focus: string;
  focusByPage: Record<Page, string>;
  gamesOffset: number;
  sessionsOffset: number;
}

export function rangeBounds(range: Range, now = Date.now() / 1000) {
  const midnight = new Date(now * 1000);
  midnight.setHours(0, 0, 0, 0);
  return { start: range === "today" ? midnight.getTime() / 1000 : now - (range === "30m" ? 1800 : 21600), end: now };
}

let state: ViewState = {
  page: "timeline", range: "30m", bounds: rangeBounds("30m"), live: true,
  cursor: null, detailCursors: {}, hardware: false, metric: "system", sort: "recent",
  gameId: null, gameName: "", sessionId: null, detailOrigin: "timeline", helpOrigin: "timeline",
  event: null, focus: "range", gamesOffset: 0, sessionsOffset: 0,
  focusByPage: { timeline: "range", power: "back", games: "history", sessions: "history", detail: "back", help: "back" },
};
const listeners = new Set<() => void>();
export function updateView(change: Partial<ViewState>) {
  const page = change.page ?? state.page;
  const focus = change.focus ?? state.focusByPage[page];
  state = { ...state, ...change, focus, focusByPage: { ...state.focusByPage, [state.page]: state.focus, [page]: focus } };
  listeners.forEach((listener) => listener());
}
export const getView = () => state;
export function useView() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getView);
}
export function openSession(sessionId: string, origin: "timeline" | "sessions") {
  updateView({ page: "detail", sessionId, detailOrigin: origin, live: false, focus: "back" });
}
export function openHelp() {
  const current = getView();
  if (current.page !== "help") updateView({ page: "help", helpOrigin: current.page, focus: "back" });
}
export function backPage() {
  const current = getView();
  if (current.page === "help") {
    updateView({ page: current.helpOrigin, focus: "help" });
  } else if (current.page === "detail") {
    updateView({ page: current.detailOrigin, focus: current.detailOrigin === "timeline" ? "event" : `session:${current.sessionId}` });
  } else if (current.page === "sessions") {
    updateView({ page: "games", focus: `game:${current.gameId}` });
  } else if (current.page === "games") {
    updateView({ page: "timeline", focus: "games" });
  } else if (current.page === "power") {
    updateView({ page: "timeline", focus: "power" });
  }
}
