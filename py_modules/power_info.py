"""Live battery metadata and bounded, lifecycle-owned UPower reads."""

import asyncio
import math
import os
import shlex
import time
from pathlib import Path

from .battery_health import capacity_ratio


UP_PROPERTIES = (
    ("NativePath", "s"), ("UpdateTime", "t"), ("State", "u"),
    ("TimeToFull", "x"), ("Capacity", "d"), ("ChargeCycles", "i"),
)


def charge_estimate(current, upower, now, error=None):
    state = current["battery_state"].lower()
    updated = upower.get("UpdateTime") or None
    result = {"status": "unknown", "seconds": None, "updated_at": updated,
              "source": "upower", "error": error}
    if state == "full":
        result["status"] = "full"
    elif current["supply"] == "battery" and state == "discharging":
        result["status"] = "discharging"
    elif current["supply"] == "external" and state == "not charging":
        result["status"] = "not_charging"
    elif current["supply"] == "external" and state == "charging":
        if error:
            return result
        if not updated or updated > now or now - updated > 90:
            result["status"] = "stale"
        elif upower.get("State") == 1 and upower.get("TimeToFull", 0) > 0:
            result.update(status="available", seconds=upower["TimeToFull"])
    return result


def _milli_celsius(path):
    try:
        value = int(path.read_text().strip())
    except (OSError, ValueError):
        return None
    if value < -1000 or value > 150000:
        return None
    return value / 1000


def _labeled_celsius(hwmon, label):
    for path in hwmon.glob("temp*_label"):
        try:
            if path.read_text().strip() != label:
                continue
            return _milli_celsius(path.with_name(path.name.replace("_label", "_input")))
        except OSError:
            continue
    return None


def read_thermals(sys_root):
    """Temperatures and fan speed already exposed by hwmon. Missing sensors stay null."""
    reading = {"chip_c": None, "battery_c": None, "wireless_c": None, "ssd_c": None, "fan_rpm": None}
    root = sys_root / "class/hwmon"
    if not root.is_dir():
        return reading
    for hwmon in root.glob("hwmon*"):
        try:
            name = (hwmon / "name").read_text().strip()
        except OSError:
            continue
        if name == "steamdeck_hwmon":
            reading["battery_c"] = _labeled_celsius(hwmon, "Battery Temp")
            try:
                rpm = int((hwmon / "fan1_input").read_text())
            except (OSError, ValueError):
                rpm = None
            if rpm is not None and 0 <= rpm <= 20000:
                reading["fan_rpm"] = rpm
        elif name == "acpitz":
            reading["chip_c"] = _milli_celsius(hwmon / "temp1_input")
        elif name == "ath11k_hwmon":
            reading["wireless_c"] = _milli_celsius(hwmon / "temp1_input")
        elif name == "nvme":
            reading["ssd_c"] = _labeled_celsius(hwmon, "Composite") or _milli_celsius(hwmon / "temp1_input")
        elif name == "amdgpu" and reading["chip_c"] is None:
            reading["chip_c"] = _labeled_celsius(hwmon, "edge")
    return reading


class PowerInfo:
    def __init__(self, telemetry):
        self.telemetry = telemetry
        self._lock = asyncio.Lock()
        self._closed = False
        self._process = None
        self._device = None
        self._upower = {}
        self._upower_error = None
        self._next_upower = 0.0
        self._state = None
        self._pd_voltage = None
        self._pd_current = None
        self._next_pd = 0.0
        # PyInstaller's bundled OpenSSL must not shadow system busctl libraries.
        self._system_env = os.environ.copy()
        original_library_path = self._system_env.pop("LD_LIBRARY_PATH_ORIG", None)
        if original_library_path is None:
            self._system_env.pop("LD_LIBRARY_PATH", None)
        else:
            self._system_env["LD_LIBRARY_PATH"] = original_library_path

    async def _run(self, *arguments):
        if self._closed:
            raise RuntimeError("Power information is stopping")
        process = await asyncio.create_subprocess_exec(
            "busctl", "--system", *arguments,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env=self._system_env)
        self._process = process
        try:
            if self._closed:
                raise asyncio.CancelledError()
            stdout, stderr = await asyncio.wait_for(process.communicate(), 3)
            if process.returncode:
                raise RuntimeError(stderr.decode(errors="replace").strip()[:512] or "UPower query failed")
            return stdout.decode()
        except (asyncio.CancelledError, asyncio.TimeoutError):
            if process.returncode is None:
                process.kill()
            await process.communicate()
            raise
        finally:
            if self._process is process:
                self._process = None

    async def _properties(self, path, properties):
        output = await self._run("get-property", "org.freedesktop.UPower", path,
                                 "org.freedesktop.UPower.Device", *(name for name, _ in properties))
        lines = output.splitlines()
        if len(lines) != len(properties):
            raise ValueError("UPower property response is incomplete")
        result = {}
        for (name, signature), line in zip(properties, lines):
            fields = shlex.split(line)
            if len(fields) != 2 or fields[0] != signature:
                raise ValueError("Invalid UPower property: " + name)
            value = fields[1] if signature == "s" else float(fields[1]) if signature == "d" else int(fields[1])
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("Non-finite UPower property: " + name)
            result[name] = value
        return result

    async def _refresh_upower(self, battery_name):
        if self._device is None:
            output = await self._run("call", "org.freedesktop.UPower", "/org/freedesktop/UPower",
                                     "org.freedesktop.UPower", "EnumerateDevices")
            fields = shlex.split(output)
            if len(fields) < 2 or fields[0] != "ao" or int(fields[1]) != len(fields) - 2 or len(fields) > 66:
                raise ValueError("Invalid UPower device list")
            for path in fields[2:]:
                identity = await self._properties(path, (("NativePath", "s"), ("Type", "u")))
                if identity["Type"] == 2 and Path(identity["NativePath"]).name == battery_name:
                    self._device = path
                    break
            if self._device is None:
                raise RuntimeError("UPower did not expose the current battery")
        values = await self._properties(self._device, UP_PROPERTIES)
        if Path(values["NativePath"]).name != battery_name:
            raise RuntimeError("UPower battery identity changed")
        self._upower, self._upower_error = values, None

    def _discover_pd(self):
        self._pd_voltage, self._pd_current = None, None
        for hwmon in (self.telemetry.sys_root / "class/hwmon").glob("hwmon*"):
            voltage, current = None, None
            for pattern in ("in*_label", "curr*_label"):
                for label in hwmon.glob(pattern):
                    try:
                        name = label.read_text().strip()
                    except OSError:
                        continue
                    source = label.with_name(label.name.removesuffix("_label") + "_input")
                    if name == "PD Contract Voltage":
                        voltage = source
                    elif name == "PD Contract Current":
                        current = source
            if voltage and current:
                self._pd_voltage, self._pd_current = voltage, current
                break
        self._next_pd = time.monotonic() + 30

    async def read(self, refresh_contract=True):
        if self._closed:
            raise RuntimeError("Power information is stopping")
        current = self.telemetry.read_battery(include_details=True)
        errors = dict(current["errors"])
        if errors.get("system_w") == "not_confirmed_battery_discharge":
            errors.pop("system_w")
        battery = self.telemetry.batteries[0] if len(self.telemetry.batteries) == 1 else None
        signature = (battery.name if battery else None, current["supply"], current["battery_state"])
        async with self._lock:
            if self._closed:
                raise RuntimeError("Power information is stopping")
            if signature != self._state:
                if self._state is not None and signature[0] != self._state[0]:
                    self._device = None
                self._state, self._next_upower = signature, 0.0
            if time.monotonic() >= self._next_upower:
                self._next_upower = time.monotonic() + 30
                try:
                    if battery is None:
                        raise RuntimeError("Battery is missing or ambiguous")
                    await self._refresh_upower(battery.name)
                except (OSError, ValueError, RuntimeError, asyncio.TimeoutError) as exc:
                    self._upower = {}
                    self._device = None
                    self._upower_error = str(exc) or "UPower query timed out"
        if self._closed:
            raise RuntimeError("Power information is stopping")

        def text(path, field):
            if path is None:
                return None
            try:
                return path.read_text().strip() or None
            except FileNotFoundError:
                return None
            except OSError as exc:
                errors[field] = str(exc)
                return None

        def numeric(path, field, positive=False, scale=1):
            value = text(path, field)
            if value is None:
                return None
            try:
                number = int(value)
                if number < 0 or positive and number == 0:
                    return None
                return number / scale
            except ValueError:
                errors[field] = "Invalid numeric battery value"
                return None

        def attribute(name):
            return battery / name if battery else None

        now = time.time()
        charge_now = numeric(attribute("charge_now"), "charge_now_mah", scale=1000)
        charge_full = numeric(attribute("charge_full"), "charge_full_mah", True, 1000)
        charge_design = numeric(attribute("charge_full_design"), "charge_design_mah", True, 1000)
        design_voltage = numeric(attribute("voltage_min_design"), "design_voltage_v", True, 1e6)
        energy_sources = []

        def energy(name, charge):
            reported = numeric(attribute(name), name, name != "energy_now", 1e6)
            if reported is not None:
                energy_sources.append("reported")
                return reported
            if charge is not None and design_voltage is not None:
                energy_sources.append("design_voltage")
                return charge * design_voltage / 1000
            return None

        energy_now = energy("energy_now", charge_now)
        energy_full = energy("energy_full", charge_full)
        energy_design = energy("energy_full_design", charge_design)
        if refresh_contract and time.monotonic() >= self._next_pd:
            self._discover_pd()
        pd_voltage = numeric(self._pd_voltage, "pd_voltage_v", True, 1000) if current["supply"] == "external" else None
        pd_current = numeric(self._pd_current, "pd_current_a", True, 1000) if current["supply"] == "external" else None
        upower_fresh = 0 <= now - self._upower.get("UpdateTime", 0) <= 90
        cycles = self._upower.get("ChargeCycles", -1) if upower_fresh else -1
        raw_cycles = numeric(attribute("cycle_count"), "cycle_count", True)
        cycles = int(cycles) if cycles >= 0 else int(raw_cycles) if raw_cycles is not None else None
        capacity = self._upower.get("Capacity") if upower_fresh else None
        if capacity is not None and not 0 < capacity <= 100:
            capacity = None
        ratio = capacity_ratio(charge_full, charge_design, energy_full, energy_design)
        return {
            "timestamp": current["timestamp"],
            "battery": {"model": text(attribute("model_name"), "model"),
                        "manufacturer": text(attribute("manufacturer"), "manufacturer"),
                        "technology": text(attribute("technology"), "technology"),
                        "supply": current["supply"], "state": current["battery_state"],
                        "percent": current["battery_percent"], "voltage_v": current["voltage_v"],
                        "current_a": current["current_a"], "net_w": current["battery_w"],
                        "system_w": current["system_w"], "charge_now_mah": charge_now,
                        "charge_full_mah": charge_full, "charge_design_mah": charge_design,
                        "energy_now_wh": energy_now, "energy_full_wh": energy_full,
                        "energy_design_wh": energy_design,
                        "energy_basis": "mixed" if "reported" in energy_sources and "design_voltage" in energy_sources else energy_sources[0] if energy_sources else None,
                        "capacity_ratio_percent": ratio, "system_capacity_percent": capacity,
                        "cycle_count": cycles},
            "adapter": {"voltage_v": pd_voltage, "current_a": pd_current,
                        "limit_w": pd_voltage * pd_current if pd_voltage is not None and pd_current is not None else None},
            "estimate": charge_estimate(current, self._upower, now, self._upower_error),
            "thermals": read_thermals(self.telemetry.sys_root),
            "errors": errors,
        }

    async def close(self):
        self._closed = True
        process = self._process
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()
        async with self._lock:
            pass
