"""Version-gated, read-only EC input and live power-flow snapshots (not a ledger)."""

import mmap
import os
import struct
import time
from pathlib import Path


EC_FIELDS = {"firmware": 0xC4C, "vbus_mv": 0x1E8, "ibus_ma": 0x1EA,
             "battery_mv": 0x387, "battery_ma": 0x383,
             "pd_voltage": 0xC56, "pd_current": 0xC58}


def read_ec_window(window):
    result = {}
    for name, offset in EC_FIELDS.items():
        first = struct.unpack_from("<H", window, offset)[0]
        if first != struct.unpack_from("<H", window, offset)[0]:
            raise ValueError("ec_torn_read")
        result[name] = first
    if result["firmware"] != 4352:
        raise ValueError("ec_firmware_mismatch")
    return result


class ECInput:
    def __init__(self, sys_root=Path("/sys")):
        self.window = None
        self.error = None
        ec = sys_root / "devices/pci0000:00/0000:00:14.3/PNP0C09:00/VLV0100:00"
        try:
            identity = ((sys_root / "class/dmi/id/board_name").read_text().strip(),
                        (sys_root / "class/dmi/id/bios_version").read_text().strip(),
                        int((ec / "board_id").read_text()),
                        int((ec / "firmware_version").read_text()))
            if identity != ("Galileo", "F7G0114", 5, 4352):
                self.error = "ec_unsupported_device"
                return
            if os.geteuid() != 0:
                self.error = "ec_permission_required"
                return
            fd = os.open("/dev/mem", os.O_RDONLY | os.O_CLOEXEC)
            try:
                self.window = mmap.mmap(fd, 0x1000, flags=mmap.MAP_SHARED,
                                        prot=mmap.PROT_READ, offset=0xFE700000)
            finally:
                os.close(fd)
            read_ec_window(self.window)
        except (OSError, ValueError) as exc:
            self.error = "ec_unavailable: " + str(exc)
            self.close()

    def read(self):
        if self.window is None:
            return None, self.error or "ec_unavailable"
        try:
            return read_ec_window(self.window), None
        except (OSError, ValueError) as exc:
            return None, str(exc)

    def close(self):
        if self.window is not None:
            self.window.close()
            self.window = None


def power_flow(sample, ec, ec_error=None, battery_aligned=True):
    supply, state = sample["supply"], sample["battery_state"]
    mode = "external" if supply == "external" else "battery" if supply == "battery" and state == "Discharging" else "unknown"
    watts = sample["battery_w"]
    net = watts if state == "Charging" else -watts if state == "Discharging" and watts is not None else 0.0 if state in ("Full", "Not charging") and watts == 0 else None
    errors = {}
    if net is None:
        errors["battery_net_w"] = sample["errors"].get("battery_w", "battery_direction_unknown")
    apu = sample["apu_w"]
    if apu is None:
        errors["apu_w"] = sample["errors"].get("apu_w", "firmware_invalid_value")
    pin, vin, iin, pdv, pdi = None, None, None, None, None
    if mode == "battery":
        pin = sample["system_w"]
    elif mode == "external":
        if ec is None:
            errors["input_w"] = ec_error or "ec_unavailable"
        elif ec["vbus_mv"] in (0, 0xFFFF) or ec["ibus_ma"] == 0xFFFF:
            errors["input_w"] = "ec_input_invalid"
        else:
            vin, iin = ec["vbus_mv"] / 1000, ec["ibus_ma"] / 1000
            pin = ec["vbus_mv"] * ec["ibus_ma"] / 1e6
        if ec is not None and 0 < ec["pd_voltage"] < 0xFFFF and 0 < ec["pd_current"] < 0xFFFF:
            pdv, pdi = ec["pd_voltage"] * .05, ec["pd_current"] * .01
    else:
        errors["input_w"] = "external_supply_unavailable"
    battery_term = net if mode == "external" and net is not None else 0.0
    difference = peripheral = None
    if pin is not None and apu is not None:
        difference = peripheral = pin - apu - battery_term
    elif "peripheral_w" not in errors:
        errors["peripheral_w"] = "flow_components_unavailable"
    return {
        "timestamp": sample["timestamp"], "mode": mode, "battery_state": state,
        "input_w": pin, "input_v": vin, "input_a": iin,
        "battery_net_w": net, "battery_v": sample.get("voltage_v"),
        "battery_a": sample.get("current_a"), "apu_w": apu,
        "apu_source": sample.get("apu_source"), "peripheral_w": peripheral,
        "difference_w": difference, "pd_voltage_v": pdv, "pd_current_a": pdi,
        "rails": sample.get("rails", {}), "cores_w": sample.get("cores_w", [None] * 4),
        "errors": errors,
    }


class PowerFlow:
    def __init__(self, telemetry):
        self.telemetry = telemetry
        self.ec = ECInput(telemetry.sys_root)

    def read(self):
        began = time.monotonic()
        before, before_error = self.ec.read()
        sample = self.telemetry.read()
        after, after_error = self.ec.read()
        ec = after if before is not None and before == after else None
        reason = after_error or before_error or ("ec_changed_during_sample" if ec is None else None)
        voltage, current = sample.get("voltage_v"), sample.get("current_a")
        aligned = ec is not None and voltage is not None and current is not None and ec["battery_mv"] == round(voltage * 1000) and ec["battery_ma"] == round(current * 1000)
        flow = power_flow(sample, ec, reason, aligned)
        flow["read_span_ms"] = (time.monotonic() - began) * 1000
        return sample, flow

    def close(self):
        self.ec.close()
