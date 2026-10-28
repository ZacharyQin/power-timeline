import asyncio
import importlib.util
import math
import sqlite3
import sys
import tempfile
import time
import types
import unittest
from contextlib import closing
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from py_modules.battery_health import BatteryHealth, capacity_ratio, read_capacity


def at(day, hour=12):
    return datetime.fromisoformat(f"{day}T{hour:02}:00:00").timestamp()


class BatteryHealthTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.battery = self.root / "BAT1"
        self.battery.mkdir()
        self.health = BatteryHealth(self.root / "history")
        self.write(charge_full=4800000, charge_full_design=5000000)

    def write(self, **values):
        for name, value in values.items():
            (self.battery / name).write_text(str(value))

    def test_one_row_per_day_uses_latest_valid_observation_and_survives_restart(self):
        self.health.record(self.battery, at("2026-10-27", 8))
        self.write(charge_full=4750000)
        self.health.record(self.battery, at("2026-10-27", 20))
        self.health.record(self.battery, at("2026-10-28", 8))
        restored = BatteryHealth(self.root / "history").history()
        self.assertEqual([row["day"] for row in restored], ["2026-10-27", "2026-10-28"])
        self.assertEqual(restored[0]["health_percent"], 95)
        self.assertEqual(restored[0]["observed_at"], at("2026-10-27", 20))
        self.assertEqual((restored[0]["full_capacity"], restored[0]["design_capacity"], restored[0]["capacity_unit"]), (4750, 5000, "mAh"))
        self.assertFalse((self.root / "history/timeline.sqlite3").exists())

    def test_bad_or_missing_readings_do_not_replace_good_days_or_fill_gaps(self):
        self.assertEqual(self.health.history(), [])
        self.health.record(self.battery, at("2026-10-27"))
        before = self.health.history()
        for value in ("invalid", 0, -1, "NaN", "inf"):
            self.write(charge_full=value)
            self.assertFalse(self.health.record(self.battery, at("2026-10-27", 20)))
            self.assertFalse(self.health.record(self.battery, at("2026-10-28")))
        self.assertFalse(self.health.record(None, at("2026-10-28")))
        self.assertEqual(self.health.history(), before)
        self.write(charge_full=4700000)
        self.health.record(self.battery, at("2026-10-29"))
        self.assertEqual([row["day"] for row in self.health.history()], ["2026-10-27", "2026-10-29"])

    def test_charge_pair_precedes_energy_and_values_above_100_are_preserved(self):
        self.write(charge_full=5100000, energy_full=48000000, energy_full_design=50000000)
        self.health.record(self.battery, at("2026-10-27"))
        self.assertEqual(self.health.history()[0]["health_percent"], 102)
        (self.battery / "charge_full_design").unlink()
        self.health.record(self.battery, at("2026-10-28"))
        result = self.health.history()[1]
        self.assertEqual((result["health_percent"], result["full_capacity"], result["design_capacity"], result["capacity_unit"]), (96, 48, 50, "Wh"))
        (self.battery / "energy_full_design").unlink()
        self.assertIsNone(read_capacity(self.battery))

    def test_voltage_converted_capacity_matches_the_live_profile_fallback(self):
        (self.battery / "charge_full_design").unlink()
        self.write(voltage_min_design=7500000, energy_full_design=40000000)
        self.health.record(self.battery, at("2026-10-27"))
        row = self.health.history()[0]
        self.assertEqual((row["health_percent"], row["full_capacity"], row["design_capacity"], row["capacity_unit"]), (90, 36, 40, "Wh"))

    def test_clock_rollback_does_not_replace_a_later_daily_observation(self):
        self.health.record(self.battery, at("2026-10-27", 20))
        before = self.health.history()
        self.write(charge_full=4700000)
        self.health.record(self.battery, at("2026-10-27", 8))
        self.assertEqual(self.health.history(), before)

    @unittest.skipUnless(hasattr(time, "tzset"), "requires local timezone support")
    def test_calendar_day_uses_device_local_time_not_utc(self):
        import os
        previous = os.environ.get("TZ")
        try:
            os.environ["TZ"] = "UTC-8"
            time.tzset()
            timestamp = datetime.fromisoformat("2026-10-27T17:00:00+00:00").timestamp()
            self.health.record(self.battery, timestamp)
            self.assertEqual(self.health.history()[0]["day"], "2026-10-28")
        finally:
            if previous is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = previous
            time.tzset()

    def test_nonfinite_inputs_and_future_schema_are_rejected(self):
        for value in (None, True, 0, -1, math.nan, math.inf):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.health.record(self.battery, value)
        self.health.record(self.battery, at("2026-10-27"))
        with closing(sqlite3.connect(self.health.path)) as connection:
            connection.execute("PRAGMA user_version=100")
        with self.assertRaisesRegex(RuntimeError, "unsupported battery health schema"):
            self.health.record(self.battery, at("2026-10-28"))
        with self.assertRaisesRegex(RuntimeError, "unsupported battery health schema"):
            self.health.history()

    def test_live_and_historical_capacity_ratio_share_positive_complete_pair_rules(self):
        self.assertEqual(capacity_ratio(5100, 5000, 48, 50), 102)
        self.assertEqual(capacity_ratio(None, 5000, 48, 50), 96)
        for value in (None, True, 0, -1, math.nan, math.inf):
            self.assertIsNone(capacity_ratio(value, 5000, None, 50))


class BackgroundHealthTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        spec = importlib.util.spec_from_file_location("health_test_plugin", Path(__file__).resolve().parents[1] / "main.py")
        self.module = importlib.util.module_from_spec(spec)
        self.decky = types.SimpleNamespace(logger=Mock(), emit=AsyncMock())
        with patch.dict(sys.modules, {"decky": self.decky}):
            spec.loader.exec_module(self.module)
        self.plugin = self.module.Plugin()
        self.plugin._stopping = False
        self.plugin._health_error = None
        self.plugin._require_recorder = AsyncMock()

    async def test_background_recording_needs_no_page_or_power_info_request(self):
        with tempfile.TemporaryDirectory() as folder:
            battery = Path(folder) / "BAT1"
            battery.mkdir()
            (battery / "energy_full").write_text("48000000")
            (battery / "energy_full_design").write_text("50000000")
            self.plugin._telemetry = types.SimpleNamespace(batteries=[battery])
            self.plugin._battery_health = BatteryHealth(Path(folder) / "history")
            saved = asyncio.Event()
            loop = asyncio.get_running_loop()
            record = self.plugin._battery_health.record

            def notify(*args):
                try:
                    return record(*args)
                finally:
                    loop.call_soon_threadsafe(saved.set)

            with patch.object(self.plugin._battery_health, "record", side_effect=notify):
                task = asyncio.create_task(self.plugin._record_health_loop())
                try:
                    await asyncio.wait_for(saved.wait(), 5)
                finally:
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
            result = await self.plugin.get_battery_health()
            self.assertEqual(len(result["points"]), 1)
            self.assertEqual(result["points"][0]["health_percent"], 96)
            self.assertIsNone(result["error"])

    async def test_health_write_failure_is_reported_without_failing_power_recorder(self):
        self.plugin._telemetry = types.SimpleNamespace(batteries=[Path("BAT1")])
        self.plugin._battery_health = Mock()
        self.plugin._battery_health.record.side_effect = sqlite3.OperationalError("health disk full")
        self.plugin._battery_health.history.return_value = []
        reported = asyncio.Event()
        self.decky.logger.exception.side_effect = lambda *args: reported.set()
        task = asyncio.create_task(self.plugin._record_health_loop())
        try:
            await asyncio.wait_for(reported.wait(), 5)
            self.assertFalse(task.done())
            self.assertEqual((await self.plugin.get_battery_health())["error"], "health disk full")
        finally:
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task


if __name__ == "__main__":
    unittest.main()
