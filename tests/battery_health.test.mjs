import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyHealthSeries, healthDay } from "../src/batteryHealth.ts";

const point = (day, health = 96) => ({ day, observed_at: 1, health_percent: health, full_capacity: 48, design_capacity: 50, capacity_unit: "Wh" });

test("daily health dates use calendar spacing across DST and reject invalid dates", () => {
  assert.equal(healthDay("2026-03-09") - healthDay("2026-03-08"), 1);
  for (const value of ["2026-02-30", "2026-13-01", "yesterday", "2026-1-1"]) assert.ok(Number.isNaN(healthDay(value)));
});

test("health curves retain real daily points and break across unobserved days", () => {
  const history = [point("2026-10-27", 96), point("2026-10-25", 98), point("2026-10-26", 97), point("2026-10-23", 99)];
  const plot = dailyHealthSeries(history, 30, "2026-10-27");
  assert.deepEqual(plot.points.map((value) => value.day), ["2026-10-23", "2026-10-25", "2026-10-26", "2026-10-27"]);
  assert.deepEqual(plot.segments.map((values) => values.map((value) => value.day)), [["2026-10-23"], ["2026-10-25", "2026-10-26", "2026-10-27"]]);
  assert.equal(history[0].day, "2026-10-27");
});

test("health ranges include their first and last days and omit future or invalid points", () => {
  const history = [point("2026-09-27"), point("2026-09-28"), point("2026-10-27"), point("2026-10-28"), point("2026-10-20", NaN), point("2026-02-30"), point("2026-10-21", 0)];
  const recent = dailyHealthSeries(history, 30, "2026-10-27");
  assert.deepEqual(recent.points.map((value) => value.day), ["2026-09-28", "2026-10-27"]);
  assert.equal(dailyHealthSeries(history, null, "2026-10-27").points.length, 3);
});

test("above-design health remains visible and a single day has a finite position", () => {
  const plot = dailyHealthSeries([point("2026-10-27", 103.7)], null, "2026-10-27");
  assert.equal(plot.points[0].health_percent, 103.7);
  assert.ok(plot.maximum >= 103.7);
  assert.ok(plot.end > plot.start);
  assert.ok(plot.maximum > plot.minimum);
  const empty = dailyHealthSeries([], null, "2026-10-27");
  assert.deepEqual(empty.points, []);
  assert.deepEqual(empty.segments, []);
  assert.ok(Number.isFinite(empty.end - empty.start));
});
