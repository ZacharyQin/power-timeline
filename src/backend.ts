import { callable } from "@decky/api";
import type { Detail, History, Metric, Snapshot, Sort, Timeline } from "./types";

export const getSnapshot = callable<[], Snapshot>("get_snapshot");
export const getTimeline = callable<[start: number, end: number, max_points?: number], Timeline>("get_timeline");
export const getGameHistory = callable<[
  game_id?: string | null,
  start?: number | null,
  end?: number | null,
  metric?: Metric,
  sort?: Sort,
  offset?: number,
  limit?: number,
], History>("get_game_history");
export const getSessionDetail = callable<[session_id: string, max_points?: number], Detail>("get_session_detail");
export const observeGames = callable<[
  games: { game_id: string; name: string }[],
  source?: string,
  observed_at?: number,
], { accepted: boolean }>("observe_games");
