export const semanticColors = {
  battery: "#7BDCC5",
  system: "#62D9F5",
  process: "#E6B6D5",
  apu: "#E5EAF0",
  cpu: "#78B9FF",
  soc: "#A7B8C8",
  gpu: "#C2A5FF",
  warning: "#E6D58A",
  error: "#F28F8F",
} as const;
export type SemanticRole = keyof typeof semanticColors;

export const powerBands = [
  { min: 0, max: 5, label: "很低", range: "0–<5 W", color: "#78B9FF" },
  { min: 5, max: 10, label: "低", range: "5–<10 W", color: "#62D9F5" },
  { min: 10, max: 15, label: "中", range: "10–<15 W", color: "#7BDCC5" },
  { min: 15, max: 20, label: "较高", range: "15–<20 W", color: "#E6D58A" },
  { min: 20, max: null, label: "高", range: "≥20 W", color: "#F2B179" },
] as const;
export type PowerBand = typeof powerBands[number];

// Use the raw W value, never a rounded string or a chart's dynamic axis maximum.
export function getPowerBand(value: number | null): PowerBand | null {
  if (value === null) return null;
  if (value < 5) return powerBands[0];
  if (value < 10) return powerBands[1];
  if (value < 15) return powerBands[2];
  if (value < 20) return powerBands[3];
  return powerBands[4];
}

export const chartSeries = {
  battery_percent: { key: "battery_percent", label: "电量", role: "battery", dash: "", line: "实线" },
  system_w: { key: "system_w", label: "整机", role: "system", dash: "", line: "实线" },
  apu_w: { key: "apu_w", label: "APU", role: "apu", dash: "8 3", line: "长虚线" },
  cpu_w: { key: "cpu_w", label: "CPU", role: "cpu", dash: "3 3", line: "短虚线" },
  soc_w: { key: "soc_w", label: "SoC", role: "soc", dash: "1 3", line: "点线" },
  gpu_w: { key: "gpu_w", label: "GPU", role: "gpu", dash: "8 3 2 3", line: "点划线" },
} as const;
export type SeriesKey = keyof typeof chartSeries;
export const hardwareSeries = [chartSeries.apu_w, chartSeries.cpu_w, chartSeries.soc_w, chartSeries.gpu_w] as const;
