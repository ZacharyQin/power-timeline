import type { BatteryHealthPoint } from "./types";

const DAY_MS = 86_400_000;

export function healthDay(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day ? timestamp / DAY_MS : NaN;
}

export function dailyHealthSeries(history: BatteryHealthPoint[], days: number | null, today: string) {
  const end = healthDay(today);
  const valid = history.filter((point) => Number.isFinite(healthDay(point.day)) && healthDay(point.day) <= end && Number.isFinite(point.health_percent) && point.health_percent > 0).sort((a, b) => a.day.localeCompare(b.day));
  const start = days === null ? Math.min(end, ...valid.map((point) => healthDay(point.day))) : end - days + 1;
  const points = valid.filter((point) => healthDay(point.day) >= start);
  const segments: BatteryHealthPoint[][] = [];
  for (const point of points) {
    const segment = segments[segments.length - 1];
    if (!segment || healthDay(point.day) - healthDay(segment[segment.length - 1].day) !== 1) segments.push([point]);
    else segment.push(point);
  }
  const minimum = points.length ? Math.min(...points.map((point) => point.health_percent)) : 0;
  const maximum = points.length ? Math.max(...points.map((point) => point.health_percent)) : 100;
  return {
    points, segments,
    start: start === end ? start - 0.5 : start,
    end: start === end ? end + 0.5 : end,
    minimum: Math.max(0, Math.floor(minimum / 5) * 5 - 5),
    maximum: Math.max(100, Math.ceil(maximum / 5) * 5),
  };
}
