"""Explicit, uncalibrated domain-energy estimates weighted by process activity.

CPU includes only CPU-time fraction of the complete host scheduling interval;
GPU uses execution occupancy, not a claim of per-process physical wattage.
"""

import math

MODEL = "activity-weighted-v1"


def _domain_energy(previous, current, name, elapsed):
    a, b = previous.get(name), current.get(name)
    if a is None or b is None or not all(math.isfinite(v) and v >= 0 for v in (a, b)):
        return None
    return (a + b) * 0.5 * elapsed / 3600


class Attribution:
    def between(self, previous, current, previous_games, games):
        elapsed = current["monotonic"] - previous["monotonic"]
        if elapsed <= 0:
            return {}
        old = {g["game_id"]: g for g in previous_games}
        cpu_energy = _domain_energy(previous, current, "cpu_w", elapsed)
        gpu_energy = _domain_energy(previous, current, "gpu_w", elapsed)
        output = {}
        occupancy = {}
        cpu_shares = {}
        for game in games:
            identity = game["game_id"]
            result = dict(cpu_wh=None, gpu_wh=None, model=MODEL,
                          reasons=["uncalibrated_activity_weighting", "excludes_screen_soc_and_shared_system"])
            output[identity] = result
            before = old.get(identity)
            if before is None:
                result["reasons"].append("first_process_observation")
                continue
            old_procs = {(p["pid"], p["start_ticks"]): p for p in before["processes"]}
            new_procs = {(p["pid"], p["start_ticks"]): p for p in game["processes"]}
            complete = old_procs.keys() == new_procs.keys()
            if not complete:
                result["reasons"].append("process_set_changed")
            current_total, previous_total = game["cpu_total_ticks"], before["cpu_total_ticks"]
            total = current_total - previous_total if current_total is not None and previous_total is not None else None
            ticks = sum(p["cpu_ticks"] - old_procs[key]["cpu_ticks"]
                        for key, p in new_procs.items() if key in old_procs)
            if complete and total is not None and total > 0 and 0 <= ticks <= total and cpu_energy is not None:
                cpu_shares[identity] = ticks / total
            else:
                result["reasons"].append("cpu_interval_incomplete")
            old_clients, clients = before.get("gpu_clients", {}), game.get("gpu_clients", {})
            if (complete and before["gpu_complete"] and game["gpu_complete"]
                    and old_clients.keys() == clients.keys() and gpu_energy is not None):
                changes = [[engines[name] - old_clients[key][name] for name in ("gfx", "compute")]
                           for key, engines in clients.items()]
                if all(ns >= 0 for engines in changes for ns in engines):
                    # Engines can overlap; compare interval deltas, not lifetime maxima.
                    occupancy[identity] = min(1.0, sum(max(e) for e in changes) / (elapsed * 1e9))
                else:
                    result["reasons"].append("gpu_counter_reset")
            else:
                result["reasons"].append("gpu_interval_incomplete")
        cpu_scale = max(1.0, sum(cpu_shares.values()))
        for identity, weight in cpu_shares.items():
            output[identity]["cpu_wh"] = cpu_energy * weight / cpu_scale
            if cpu_scale > 1:
                output[identity]["reasons"].append("concurrent_cpu_activity_normalized")
        scale = max(1.0, sum(occupancy.values()))
        for identity, weight in occupancy.items():
            output[identity]["gpu_wh"] = gpu_energy * weight / scale
            if scale > 1:
                output[identity]["reasons"].append("concurrent_gpu_occupancy_normalized")
        return output
