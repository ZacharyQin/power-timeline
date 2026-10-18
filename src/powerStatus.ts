import { durationText } from "./components";
import { t } from "./i18n";
import type { MessageKey } from "./locales/en";
import type { PowerInfo } from "./types";

const chargeReasons: Record<string, MessageKey> = {
  charge_end_unobserved: "charge.unobserved",
  sampling_gap: "charge.samplingGap",
  suspend: "charge.suspend",
  clock_discontinuity: "charge.clock",
  battery_state_unknown: "charge.unknownState",
  sampling_stale: "charge.stale",
};

export function lastChargeText(info: PowerInfo, now = Date.now() / 1000): string {
  if (now < info.timestamp || now - info.timestamp > 10) return t("charge.unknown");
  if (info.battery.state.toLowerCase() === "charging") return t("charge.charging");
  return info.last_charge.elapsed_seconds === null ? t("charge.unknown") : durationText(info.last_charge.elapsed_seconds);
}

export function lastChargeReason(info: PowerInfo): string | undefined {
  if (info.last_charge.reason === "charging") return t("charge.still");
  if (!info.last_charge.reason) return undefined;
  const key = chargeReasons[info.last_charge.reason];
  return key ? t(key) : t("charge.unconfirmed");
}

export function chargeEstimateText(info: PowerInfo | null, state: string, supply: string, sampleAt: number | null, now = Date.now() / 1000): string {
  if (sampleAt === null || now < sampleAt || now - sampleAt > 10) return t("charge.expired");
  const normalized = state.toLowerCase();
  if (normalized === "full") return t("charge.full");
  if (normalized === "not charging" || normalized === "discharging") return t("charge.notCharging");
  if (normalized !== "charging" || supply !== "external") return t("charge.noEstimate");
  if (!info || info.battery.state.toLowerCase() !== "charging") return t("charge.noEstimate");
  const estimate = info.estimate;
  if (now < info.timestamp || now - info.timestamp > 30 || estimate.updated_at === null || now < estimate.updated_at || now - estimate.updated_at > 90 || estimate.status === "stale") return t("charge.estimateStale");
  if (estimate.status !== "available" || estimate.seconds === null || estimate.seconds <= 0) return t("charge.noEstimate");
  const minutes = Math.ceil(estimate.seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return t("common.aboutHoursMinutes", { hours, minutes: rest });
  if (hours > 0) return t("common.aboutHours", { hours });
  return t("common.aboutMinutes", { minutes });
}
