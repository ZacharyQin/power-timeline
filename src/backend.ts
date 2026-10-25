import { callable } from "@decky/api";
import type { Detail, FanStatus, History, Metric, PowerInfo, SailingStatus, Snapshot, Sort, Timeline } from "./types";

export const getFanStatus = callable<[], FanStatus>("get_fan_status");
export const setFanMode = callable<[mode: "automatic" | "maximum"], FanStatus>("set_fan_mode");

export const getSailingStatus = callable<[], SailingStatus>("get_sailing_status");
export const updateNativeChargeSettings = callable<[enabled: boolean, limit: number], SailingStatus>("update_native_charge_settings");
export const setSailingMode = callable<[enabled: boolean, delta_percent: number], SailingStatus>("set_sailing_mode");

export const getSnapshot = callable<[], Snapshot>("get_snapshot");
export const getPowerInfo = callable<[refresh_contract?: boolean], PowerInfo>("get_power_info");
export const getTimeline = callable<[start: number, end: number, max_points?: number, bucket_seconds?: number], Timeline>("get_timeline");
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
