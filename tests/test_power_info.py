"""Battery units, estimate precedence and durable charge-end boundaries."""

import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from py_modules.power_info import PowerInfo, charge_estimate, read_thermals
from py_modules.recorder import Recorder
from py_modules.telemetry import Telemetry
from test_recorder import sample


class EstimateTests(unittest.TestCase):
    def test_estimate_requires_charging_matching_state_and_fresh_source(self):
        current = {"supply": "external", "battery_state": "Charging"}
        source = {"UpdateTime": 100, "State": 1, "TimeToFull": 2108}
        self.assertEqual(charge_estimate(current, source, 120)["seconds"], 2108)
        for changes, now, expected in (({"TimeToFull": 0}, 120, "unknown"),
                                       ({"TimeToFull": -1}, 120, "unknown"),
                                       ({"State": 2}, 120, "unknown"),
                                       ({}, 191, "stale"), ({}, 99, "stale")):
            with self.subTest(changes=changes, now=now):
                result = charge_estimate(current, {**source, **changes}, now)
                self.assertEqual(result["status"], expected)
                self.assertIsNone(result["seconds"])
        self.assertEqual(charge_estimate(current, source, 190)["seconds"], 2108)
        self.assertIsNone(charge_estimate(current, source, 120, "UPower unavailable")["seconds"])

    def test_physical_states_do_not_turn_into_zero_minute_predictions(self):
        source = {"UpdateTime": 100, "State": 1, "TimeToFull": 2108}
        for supply, state, expected in (("battery", "Discharging", "discharging"),
                                        ("external", "Full", "full"),
                                        ("external", "Not charging", "not_charging"),
                                        ("external", "Discharging", "unknown"),
                                        ("unknown", "Charging", "unknown")):
            result = charge_estimate({"supply": supply, "battery_state": state}, source, 120)
            self.assertEqual(result["status"], expected)
            self.assertIsNone(result["seconds"])

    def test_unset_source_timestamp_is_unknown_not_unix_epoch(self):
        result = charge_estimate({"supply": "external", "battery_state": "Charging"},
                                 {"UpdateTime": 0, "State": 1, "TimeToFull": 120}, 100)
        self.assertIsNone(result["seconds"])
        self.assertIsNone(result["updated_at"])


class PowerMetadataTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.enterContext(patch.object(time, "CLOCK_BOOTTIME", getattr(time, "CLOCK_BOOTTIME", time.CLOCK_MONOTONIC), create=True))
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.battery = self.root / "class/power_supply/BAT4"
        self.adapter = self.root / "class/power_supply/AC0"
        self.hwmon = self.root / "class/hwmon/hwmon8"
        for directory in (self.battery, self.adapter, self.hwmon):
            directory.mkdir(parents=True)
        self.write(self.battery, type="Battery", status="Charging", capacity="60",
                   voltage_now="8400000", current_now="-3000000", voltage_min_design="7760000",
                   charge_now="3900000", charge_full="6632000", charge_full_design="6470000",
                   cycle_count="0", model_name="Battery fixture")
        self.write(self.adapter, type="Mains", online="1")
        self.write(self.hwmon, in2_label="PD Contract Voltage", in2_input="15000",
                   curr3_label="PD Contract Current", curr3_input="3000")
        self.info = PowerInfo(Telemetry(self.root))
        self.info._refresh_upower = AsyncMock(side_effect=RuntimeError("UPower unavailable"))

    async def asyncTearDown(self):
        await self.info.close()
        self.folder.cleanup()

    def write(self, directory, **values):
        for name, value in values.items():
            (directory / name).write_text(value)

    async def test_units_contract_and_capacity_do_not_create_whole_system_power(self):
        result = await self.info.read()
        battery = result["battery"]
        self.assertEqual((battery["voltage_v"], battery["current_a"], battery["net_w"]), (8.4, 3, 25.2))
        self.assertIsNone(battery["system_w"])
        self.assertEqual(result["adapter"], {"voltage_v": 15, "current_a": 3, "limit_w": 45})
        self.assertEqual((battery["charge_full_mah"], battery["charge_design_mah"]), (6632, 6470))
        self.assertAlmostEqual(battery["energy_design_wh"], 50.2072)
        self.assertGreater(battery["capacity_ratio_percent"], 100)
        self.assertEqual(battery["energy_basis"], "design_voltage")
        self.assertIsNone(battery["cycle_count"])
        self.assertIsNone(result["estimate"]["seconds"])
        self.assertNotIn("system_w", result["errors"])

    async def test_reported_energy_zero_and_disconnected_contract_are_not_fabricated(self):
        for name in ("charge_now", "charge_full", "charge_full_design"):
            (self.battery / name).unlink()
        self.write(self.battery, status="Discharging", energy_now="0", energy_full="48000000",
                   energy_full_design="50000000", cycle_count="14")
        self.write(self.adapter, online="0")
        result = await self.info.read()
        self.assertEqual(result["battery"]["energy_now_wh"], 0)
        self.assertEqual(result["battery"]["capacity_ratio_percent"], 96)
        self.assertEqual(result["battery"]["cycle_count"], 14)
        self.assertIsNone(result["battery"]["charge_now_mah"])
        self.assertEqual(result["battery"]["system_w"], 25.2)
        self.assertEqual(result["adapter"], {"voltage_v": None, "current_a": None, "limit_w": None})
        self.assertEqual(result["estimate"]["status"], "discharging")
    async def test_thermals_use_labeled_hwmon_and_ignore_unlabeled_noise(self):
        deck = self.root / "class/hwmon/hwmon1"
        zone = self.root / "class/hwmon/hwmon2"
        radio = self.root / "class/hwmon/hwmon3"
        disk = self.root / "class/hwmon/hwmon4"
        for directory in (deck, zone, radio, disk):
            directory.mkdir()
        self.write(deck, name="steamdeck_hwmon", temp2_label="Battery Temp", temp2_input="29000", fan1_input="2083")
        self.write(zone, name="acpitz", temp1_input="54000")
        self.write(radio, name="ath11k_hwmon", temp1_input="51000")
        self.write(disk, name="nvme", temp1_label="Composite", temp1_input="39900", temp2_input="999000")
        self.assertEqual(read_thermals(self.root), {
            "chip_c": 54, "battery_c": 29, "wireless_c": 51, "ssd_c": 39.9, "fan_rpm": 2083,
        })
        result = await self.info.read()
        self.assertEqual(result["thermals"]["fan_rpm"], 2083)



class ChargeHistoryTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.recorder = Recorder(Path(self.folder.name))
        self.recorder.start()

    def tearDown(self):
        self.recorder.close()
        self.folder.cleanup()

    def ingest(self, t, state, supply="external", **changes):
        self.recorder.ingest(sample(t, battery_state=state, supply=supply, **changes), [], {})

    def status(self, now, state="Discharging"):
        return self.recorder.charging.status(now, state)

    def test_charge_end_is_not_unplug_and_survives_recorder_restart(self):
        self.ingest(0, "Charging")
        self.ingest(1, "Full")
        self.ingest(2, "Full", "battery")
        self.ingest(3, "Discharging", "battery")
        self.assertEqual(self.status(1004)["ended_at"], 1001)
        self.assertEqual(self.status(1004)["elapsed_seconds"], 3)
        self.recorder.close()
        self.recorder = Recorder(Path(self.folder.name))
        self.recorder.start()
        self.ingest(4, "Discharging", "battery")
        self.assertEqual(self.status(1005)["ended_at"], 1001)
        self.assertEqual(self.status(1005)["elapsed_seconds"], 4)

    def test_missing_charge_or_unknown_transition_never_uses_startup_as_end(self):
        self.ingest(0, "Full")
        self.assertIsNone(self.status(1001, "Full")["ended_at"])
        self.ingest(1, "Charging")
        self.ingest(2, "Unknown")
        self.ingest(3, "Discharging", "battery")
        self.assertIsNone(self.status(1004)["elapsed_seconds"])
        self.assertIsNone(self.status(1004)["ended_at"])

    def test_sampling_gap_after_confirmed_end_keeps_elapsed(self):
        self.ingest(0, "Charging")
        self.ingest(1, "Full")
        self.ingest(10, "Discharging", "battery")
        result = self.status(1011)
        self.assertEqual(result["ended_at"], 1001)
        self.assertEqual(result["elapsed_seconds"], 10)
        self.assertIsNone(result["reason"])
        self.ingest(11, "Charging")
        self.ingest(12, "Not charging")
        self.assertEqual(self.status(1013, "Not charging")["elapsed_seconds"], 1)

    def test_suspend_after_confirmed_end_still_hides_elapsed(self):
        self.ingest(0, "Charging")
        self.ingest(1, "Full")
        self.ingest(2, "Discharging", "battery", boottime=132)
        result = self.status(1003)
        self.assertEqual(result["ended_at"], 1001)
        self.assertIsNone(result["elapsed_seconds"])
        self.assertEqual(result["reason"], "suspend")

    def test_gap_during_charge_cannot_invent_an_end(self):
        self.ingest(0, "Charging")
        self.ingest(10, "Full")
        self.assertIsNone(self.status(1011, "Full")["ended_at"])

    def test_stale_sampling_and_clock_jump_do_not_run_a_confident_timer(self):
        self.ingest(0, "Charging")
        self.ingest(1, "Full")
        self.assertIsNone(self.status(1012, "Full")["elapsed_seconds"])
        self.ingest(2, "Discharging", "battery", timestamp=1010)
        self.assertIsNone(self.status(1011)["elapsed_seconds"])
        self.assertEqual(self.status(1011)["reason"], "clock_discontinuity")

    def test_live_full_state_ahead_of_recorder_does_not_claim_still_charging(self):
        self.ingest(0, "Charging")
        result = self.status(1001, "Full")
        self.assertIsNone(result["elapsed_seconds"])
        self.assertEqual(result["reason"], "charge_end_unobserved")

    def test_live_unknown_state_invalidates_duration_before_recorder_catches_up(self):
        self.ingest(0, "Charging")
        self.ingest(1, "Full")
        result = self.status(1002, "Unknown")
        self.assertEqual(result["ended_at"], 1001)
        self.assertIsNone(result["elapsed_seconds"])
        self.assertEqual(result["reason"], "battery_state_unknown")


if __name__ == "__main__":
    unittest.main()
