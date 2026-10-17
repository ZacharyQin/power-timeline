"""Read-only Steam Deck telemetry. Values are watts, not TDP limits."""

import struct
import time
from pathlib import Path


def decode_gpu_metrics(data: bytes) -> dict:
    if len(data) < 4:
        raise ValueError("gpu_metrics header truncated")
    size, major, minor = struct.unpack_from("<HBB", data)
    if major != 2 or minor != 4 or size < 168 or len(data) < size:
        raise ValueError(f"unsupported gpu_metrics {major}.{minor}/{size}")
    values = struct.unpack_from("<4H", data, 40)
    return {name: None if value == 0xFFFF else value / 1000
            for name, value in zip(("apu_w", "cpu_w", "soc_w", "gpu_w"), values)}

def _gpu_details(data, powers):
    # The caller has already validated the v2.4 ABI with decode_gpu_metrics.
    rails = struct.unpack_from("<6H", data, 152)
    def value(raw):
        return None if raw == 0xFFFF else raw / 1000
    return {
        "rails": {name: {"w": powers[name + "_w"], "voltage_v": value(rails[i]),
                         "current_a": value(rails[i + 3])}
                  for i, name in enumerate(("cpu", "soc", "gpu"))},
        "cores_w": [value(raw) for raw in struct.unpack_from("<4H", data, 48)],
    }



class Telemetry:
    def __init__(self, sys_root: Path = Path("/sys")):
        self.sys_root = sys_root
        self.batteries = []
        self.supplies = []
        self.gpu_metrics = None
        self.apu_power = None
        self._next_discovery = 0.0

    def _discover(self):
        self.batteries = []
        self.supplies = []
        for path in (self.sys_root / "class/power_supply").glob("*"):
            try:
                kind = (path / "type").read_text().strip()
                if kind == "Battery":
                    self.batteries.append(path)
                elif (path / "online").exists():
                    self.supplies.append(path)
            except OSError:
                continue
        self.gpu_metrics = None
        self.apu_power = None
        for path in (self.sys_root / "class/drm").glob("card*/device"):
            try:
                if (path / "vendor").read_text().strip() != "0x1002":
                    continue
                if (path / "gpu_metrics").exists():
                    self.gpu_metrics = path / "gpu_metrics"
                for hwmon in (path / "hwmon").glob("hwmon*"):
                    for label in hwmon.glob("power*_label"):
                        if label.read_text().strip().lower() == "slowppt":
                            prefix = label.name.removesuffix("_label")
                            for suffix in ("average", "input"):
                                candidate = hwmon / f"{prefix}_{suffix}"
                                if candidate.exists():
                                    self.apu_power = candidate
                                    break
            except OSError:
                continue
        self._next_discovery = time.monotonic() + 30

    def read_battery(self, include_details=False) -> dict:
        mono = time.monotonic()
        if mono >= self._next_discovery:
            self._discover()
        result = dict(timestamp=time.time(), monotonic=mono,
                      boottime=time.clock_gettime(time.CLOCK_BOOTTIME),
                      battery_percent=None, supply="unknown", battery_state="Unknown",
                      battery_w=None, system_w=None, apu_w=None,
                      cpu_w=None, soc_w=None, gpu_w=None, errors={})
        errors = result["errors"]
        try:
            online = [int((p / "online").read_text()) for p in self.supplies]
            if online:
                result["supply"] = "external" if any(online) else "battery"
            else:
                errors["supply"] = "external_supply_unavailable"
        except (OSError, ValueError) as exc:
            errors["supply"] = str(exc)
        if len(self.batteries) == 1:
            battery = self.batteries[0]
            try:
                result["battery_state"] = (battery / "status").read_text().strip()
                percent = int((battery / "capacity").read_text())
                if not 0 <= percent <= 100:
                    raise ValueError("battery capacity outside 0..100")
                result["battery_percent"] = percent
            except (OSError, ValueError) as exc:
                errors["battery_percent"] = str(exc)
            voltage, current = None, None
            try:
                voltage = int((battery / "voltage_now").read_text())
                current = int((battery / "current_now").read_text())
                if voltage <= 0:
                    raise ValueError("battery voltage must be positive")
                watts = abs(current * voltage) / 1e12
                result["battery_w"] = watts
                if result["supply"] == "battery" and result["battery_state"] == "Discharging":
                    result["system_w"] = watts
                else:
                    errors["system_w"] = "not_confirmed_battery_discharge"
            except (OSError, ValueError) as exc:
                errors["battery_w"] = str(exc)
                errors["system_w"] = str(exc)
        else:
            errors["battery_percent"] = "battery_missing_or_ambiguous"
            errors["system_w"] = "battery_missing_or_ambiguous"
        if include_details:
            result["voltage_v"] = voltage / 1e6 if len(self.batteries) == 1 and voltage is not None and voltage > 0 else None
            result["current_a"] = abs(current) / 1e6 if len(self.batteries) == 1 and current is not None else None
        return result

    def read(self) -> dict:
        result = self.read_battery(include_details=True)
        errors = result["errors"]
        result["apu_source"] = None
        result["cores_w"] = [None] * 4
        result["rails"] = {name: {"w": None, "voltage_v": None, "current_a": None}
                           for name in ("cpu", "soc", "gpu")}
        if self.gpu_metrics:
            try:
                raw = self.gpu_metrics.read_bytes()
                result.update(decode_gpu_metrics(raw))
                result.update(_gpu_details(raw, result))
                if result["apu_w"] is not None:
                    result["apu_source"] = "gpu_metrics"
            except (OSError, ValueError) as exc:
                for name in ("apu_w", "cpu_w", "soc_w", "gpu_w"):
                    errors[name] = str(exc)
        else:
            for name in ("apu_w", "cpu_w", "soc_w", "gpu_w"):
                errors[name] = "amdgpu_metrics_unavailable"
        if result["apu_w"] is None and self.apu_power:
            try:
                power = int(self.apu_power.read_text())
                if power < 0:
                    raise ValueError("invalid APU power")
                result["apu_w"] = power / 1e6
                result["apu_source"] = "hwmon"
                errors.pop("apu_w", None)
            except (OSError, ValueError) as exc:
                errors["apu_w"] = str(exc)
        for name in ("cpu_w", "soc_w", "gpu_w"):
            if result[name] is None and name not in errors:
                errors[name] = "firmware_invalid_value"
        return result
