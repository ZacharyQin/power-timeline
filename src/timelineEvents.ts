import { displayGameName, t } from "./i18n";
import type { MessageKey } from "./locales/en";
import { supplyText } from "./components";
import type { GameTimelineEvent, Sample, Timeline, TimelineEvent } from "./types";

export interface SleepEvent extends TimelineEvent {
  kind: "gap";
  label: "suspend";
  end: number;
  before: Sample;
  after: Sample;
}

export function isSleepEvent(event: TimelineEvent): event is SleepEvent {
  return event.kind === "gap" && event.label === "suspend" && event.end !== null && event.before !== undefined && event.after !== undefined;
}

const gapLabel: Record<string, MessageKey> = {
  suspend: "events.sleep",
  clock_discontinuity: "events.clock",
  sampling_gap: "events.samplingGap",
};

export function timelineEventLabel(event: TimelineEvent): string {
  if (event.kind === "gap") return t(gapLabel[event.label] ?? "events.gap");
  if (event.kind === "supply") return supplyText(event.label);
  return displayGameName(event.label, event.kind === "game" ? (event as GameTimelineEvent).game_id : undefined);
}

export interface TimelineGame {
  id: string;
  name: string;
  color: string;
}

export function getGameIntervals(timeline: Timeline) {
  const spans: { event: GameTimelineEvent; from: number; to: number; lane: number; game: TimelineGame }[] = [];
  const games = new Map<string, TimelineGame>();
  const laneEnds: number[] = [];
  for (const event of timeline.events) {
    if (event.kind !== "game") continue;
    const gameEvent = event as GameTimelineEvent;
    const from = Math.max(timeline.start, event.timestamp);
    const to = Math.min(timeline.end, event.end ?? gameEvent.last_seen);
    if (to <= from) continue;
    let game = games.get(gameEvent.game_id);
    if (!game) {
      let hash = 2166136261;
      for (let i = 0; i < gameEvent.game_id.length; i += 1) hash = Math.imul(hash ^ gameEvent.game_id.charCodeAt(i), 16777619);
      game = { id: gameEvent.game_id, name: event.label, color: `hsl(${((hash >>> 0) / 4294967296 * 360).toFixed(2)} 60% 65%)` };
      games.set(game.id, game);
    }
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] > from) lane += 1;
    laneEnds[lane] = to;
    spans.push({ event: gameEvent, from, to, lane, game });
  }
  return { spans, games: [...games.values()] };
}
