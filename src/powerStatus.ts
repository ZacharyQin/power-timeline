import { durationText } from "./components";
import type { PowerInfo } from "./types";

const chargeReasons: Record<string, string> = {
  charge_end_unobserved: "没有连续观测到充电结束，不从启用或重启时间起算。",
  sampling_gap: "充电结束后有采样缺口，不能确认期间是否再次充电。",
  suspend: "充电结束后有休眠缺口，不能确认期间是否再次充电。",
  clock_discontinuity: "记录时钟发生变化，不能给出可靠的经过时长。",
  battery_state_unknown: "期间存在未知电池状态，不能确认最近一次充电结束。",
  sampling_stale: "采样已停止或过期，不继续外推充电计时。",
};

export function lastChargeText(info: PowerInfo, now = Date.now() / 1000): string {
  if (now < info.timestamp || now - info.timestamp > 10) return "未知";
  if (info.battery.state.toLowerCase() === "charging") return "正在充电";
  return info.last_charge.elapsed_seconds === null ? "未知" : durationText(info.last_charge.elapsed_seconds);
}

export function lastChargeReason(info: PowerInfo): string | undefined {
  return info.last_charge.reason === "charging" ? "本次充电尚未结束。" : info.last_charge.reason ? chargeReasons[info.last_charge.reason] ?? "暂不能确认充电结束时间。" : undefined;
}

export function chargeEstimateText(info: PowerInfo | null, state: string, supply: string, sampleAt: number | null, now = Date.now() / 1000): string {
  if (sampleAt === null || now < sampleAt || now - sampleAt > 10) return "状态已过期";
  const normalized = state.toLowerCase();
  if (normalized === "full") return "已充满";
  if (normalized === "not charging" || normalized === "discharging") return "当前未充电";
  if (normalized !== "charging" || supply !== "external") return "暂无充满估计";
  if (!info || info.battery.state.toLowerCase() !== "charging") return "暂无充满估计";
  const estimate = info.estimate;
  if (now < info.timestamp || now - info.timestamp > 30 || estimate.updated_at === null || now < estimate.updated_at || now - estimate.updated_at > 90 || estimate.status === "stale") return "充满估计已过期";
  if (estimate.status !== "available" || estimate.seconds === null || estimate.seconds <= 0) return "暂无充满估计";
  const minutes = Math.ceil(estimate.seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `约${hours}小时${minutes % 60 ? `${minutes % 60}分钟` : ""}` : `约${minutes}分钟`;
}
