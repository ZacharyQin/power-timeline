export interface RailReading { w: number | null; voltage_v: number | null; current_a: number | null }
export interface PowerFlowReading {
  timestamp: number;
  mode: "battery" | "external" | "unknown";
  battery_state: string;
  input_w: number | null;
  input_v: number | null;
  input_a: number | null;
  battery_net_w: number | null;
  battery_v: number | null;
  battery_a: number | null;
  apu_w: number | null;
  apu_source: "gpu_metrics" | "hwmon" | null;
  peripheral_w: number | null;
  difference_w: number | null;
  pd_voltage_v: number | null;
  pd_current_a: number | null;
  rails: Record<"cpu" | "soc" | "gpu", RailReading>;
  cores_w: (number | null)[];
  read_span_ms: number;
  errors: Record<string, string>;
}

export interface Sample {
  timestamp: number;
  battery_percent: number | null;
  supply: string;
  battery_state: string;
  battery_w: number | null;
  system_w: number | null;
  apu_w: number | null;
  cpu_w: number | null;
  soc_w: number | null;
  gpu_w: number | null;
  errors: Record<string, string>;
  segment: number;
  break_reason: string | null;
}

export interface Session {
  session_id: string;
  game_id: string;
  name: string;
  started_at: number;
  last_seen: number;
  ended_at: number | null;
  status: "active" | "ended" | "interrupted";
  partial_start: boolean;
  system_wh: number | null;
  system_seconds: number;
  cpu_wh: number | null;
  cpu_seconds: number;
  gpu_wh: number | null;
  gpu_seconds: number;
  process_wh: number | null;
  battery_start: number | null;
  battery_end: number | null;
  model: string;
  reasons: string[];
}

export interface HistorySession extends Session {
  average_w: number | null;
}

export interface Snapshot {
  epoch: string;
  revision: number;
  status: "recording" | "error" | "stopped";
  error: string | null;
  sample: Sample | null;
  power_flow: PowerFlowReading | null;
  sessions: Session[];
  model: string;
  storage_bytes: number;
  storage_limit_bytes: number;
}

export interface TimelineEvent {
  kind: "game" | "supply" | "gap";
  timestamp: number;
  end: number | null;
  label: string;
  session_id?: string;
  before?: Sample;
  after?: Sample;
}

export interface GameTimelineEvent extends TimelineEvent {
  kind: "game";
  game_id: string;
  last_seen: number;
}

export interface Timeline {
  start: number;
  end: number;
  points: Sample[];
  events: TimelineEvent[];
  coverage_seconds: number;
  system_wh: number | null;
}

export interface GameSummary {
  game_id: string;
  name: string;
  session_count: number;
  last_seen: number;
  system_wh: number | null;
  system_seconds: number;
  cpu_wh: number | null;
  gpu_wh: number | null;
  process_wh: number | null;
  model: string;
  average_w: number | null;
}

export interface History {
  games: GameSummary[];
  sessions: HistorySession[];
  total: number;
}

export interface Detail {
  session: Session;
  timeline: Timeline;
}

export type Metric = "system" | "process" | "cpu" | "gpu";
export type Sort = "recent" | "energy" | "power";
export type Range = "30m" | "6h" | "today";

export interface ChargeEstimate {
  status: "available" | "unknown" | "full" | "not_charging" | "discharging" | "stale";
  seconds: number | null;
  updated_at: number | null;
  source: "upower";
  error: string | null;
}

export interface PowerInfo {
  timestamp: number;
  battery: {
    model: string | null;
    manufacturer: string | null;
    technology: string | null;
    supply: string;
    state: string;
    percent: number | null;
    voltage_v: number | null;
    current_a: number | null;
    net_w: number | null;
    system_w: number | null;
    charge_now_mah: number | null;
    charge_full_mah: number | null;
    charge_design_mah: number | null;
    energy_now_wh: number | null;
    energy_full_wh: number | null;
    energy_design_wh: number | null;
    energy_basis: "reported" | "design_voltage" | "mixed" | null;
    capacity_ratio_percent: number | null;
    system_capacity_percent: number | null;
    cycle_count: number | null;
  };
  adapter: { voltage_v: number | null; current_a: number | null; limit_w: number | null };
  last_charge: { ended_at: number | null; elapsed_seconds: number | null; uncertainty_seconds: number | null; reason: string | null };
  estimate: ChargeEstimate;
  errors: Record<string, string>;
}
