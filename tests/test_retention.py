"""Bounded retention with real SQLite allocation, rollback and restart."""

from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from py_modules.recorder import Recorder
from py_modules.storage import StorageFullError
from test_recorder import estimate, game, sample


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.recorder = Recorder(Path(self.folder.name), max_bytes=128 * 1024)
        self.recorder.start()

    def tearDown(self):
        self.recorder.close()
        self.folder.cleanup()

    def assert_integrity(self):
        self.assertLessEqual(self.recorder.storage.path.stat().st_size, 128 * 1024)
        self.assertEqual(self.recorder.db.execute("PRAGMA quick_check").fetchone()[0], "ok")
        self.assertEqual(self.recorder.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(self.recorder.db.execute("PRAGMA foreign_keys").fetchone()[0], 1)

    def test_repeated_rolls_preserve_live_session_and_exact_retained_energy(self):
        first_ids = set()
        for tick in range(1600):
            self.recorder.ingest(sample(tick, battery_percent=80 - tick / 100), [game()], estimate())
            if tick % 100 == 0:
                first_ids.add(self.recorder.db.execute("SELECT MIN(id) FROM samples").fetchone()[0])
                self.assert_integrity()
        self.assertGreater(len(first_ids), 3)
        first = self.recorder.db.execute("SELECT * FROM samples ORDER BY id LIMIT 1").fetchone()
        last = self.recorder.snapshot()["sample"]
        self.assertGreater(first["id"], 1)
        self.assertEqual(last["timestamp"], 2599)
        detail = self.recorder.session_detail(self.recorder.snapshot()["sessions"][0]["session_id"])
        session = detail["session"]
        seconds = last["timestamp"] - first["timestamp"]
        self.assertEqual(session["status"], "active")
        self.assertEqual(session["started_at"], first["timestamp"])
        self.assertEqual(session["battery_start"], first["battery_percent"])
        self.assertTrue(session["partial_start"])
        self.assertIn("history_trimmed", session["reasons"])
        self.assertEqual(session["system_seconds"], seconds)
        self.assertAlmostEqual(session["system_wh"], seconds * 12 / 3600)
        self.assertAlmostEqual(session["cpu_wh"], seconds * .001)
        self.assertAlmostEqual(session["gpu_wh"], seconds * .002)
        self.assertAlmostEqual(detail["timeline"]["system_wh"], session["system_wh"])
        self.recorder.close()
        self.recorder.start()
        self.recorder.ingest(sample(1600), [game()], estimate())
        self.recorder.ingest(sample(1601), [game()], estimate())
        self.assertEqual(self.recorder.snapshot()["sessions"][0]["system_seconds"], 1)
        self.assert_integrity()

    def test_eviction_uses_sample_order_across_repeated_wall_clock_resets(self):
        first_session = None
        for tick in range(1200):
            self.recorder.ingest(sample(tick, timestamp=1000.0 + tick % 4), [game()], estimate())
            if first_session is None:
                first_session = self.recorder.snapshot()["sessions"][0]["session_id"]
        minimum = self.recorder.db.execute("SELECT MIN(id) FROM samples").fetchone()[0]
        self.assertGreater(minimum, 1)
        self.assertEqual(self.recorder.db.execute("SELECT COUNT(*) FROM sessions WHERE last_sample_id<?", (minimum,)).fetchone()[0], 0)
        with self.assertRaisesRegex(ValueError, "session not found"):
            self.recorder.session_detail(first_session)
        self.assertEqual(self.recorder.snapshot()["sample"]["timestamp"], 1003)
        self.assert_integrity()

    def test_unused_error_sets_and_strings_do_not_accumulate(self):
        for tick in range(600):
            self.recorder.ingest(sample(tick, cpu_w=None, errors={"cpu_w": f"sensor-{tick}-" + "x" * 400}), [], {})
        self.assertIsNone(self.recorder.db.execute("SELECT 1 FROM strings WHERE value=?", ("sensor-0-" + "x" * 400,)).fetchone())
        rows = self.recorder.db.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
        self.assertEqual(self.recorder.db.execute("SELECT COUNT(*) FROM error_sets").fetchone()[0], rows)
        latest = self.recorder.timeline(1599, 1599)["points"][0]
        self.assertIsNone(latest["cpu_w"])
        self.assertEqual(latest["errors"], {"cpu_w": "sensor-599-" + "x" * 400})
        self.assert_integrity()

    def test_unfittable_write_rolls_back_all_attempted_evictions(self):
        for tick in range(100):
            self.recorder.ingest(sample(tick), [game()], estimate())
        tables = ("samples", "intervals", "session_intervals", "strings", "error_sets", "error_set_entries", "session_reasons")
        before = {table: [tuple(row) for row in self.recorder.db.execute("SELECT * FROM " + table)] for table in tables}
        with self.assertRaises(StorageFullError):
            self.recorder.ingest(sample(100, errors={"sensor": "x" * 200000}), [game()], estimate())
        after = {table: [tuple(row) for row in self.recorder.db.execute("SELECT * FROM " + table)] for table in tables}
        self.assertEqual(after, before)
        self.assertEqual(self.recorder.snapshot()["sample"]["timestamp"], 1099)
        self.assert_integrity()

    def test_name_observations_can_reclaim_space_without_breaking_next_sample(self):
        for tick in range(600):
            self.recorder.ingest(sample(tick), [], {})
            self.recorder.observe_games([{"game_id": str(tick), "name": "name-" + "x" * 400}])
        self.recorder.ingest(sample(600), [game("599")], {})
        self.recorder.ingest(sample(601), [game("599")], estimate("599"))
        session = self.recorder.snapshot()["sessions"][0]
        self.assertEqual(session["name"], "name-" + "x" * 400)
        self.assertEqual(session["system_seconds"], 1)
        self.assertGreater(self.recorder.db.execute("SELECT MIN(id) FROM samples").fetchone()[0], 1)
        self.assert_integrity()

    def test_expired_charge_boundary_is_not_kept_only_in_memory(self):
        self.recorder.ingest(sample(0, supply="external", battery_state="Charging"), [], {})
        self.recorder.ingest(sample(1), [], {})
        self.assertEqual(self.recorder.charging.ended["timestamp"], 1001)
        for tick in range(2, 600):
            self.recorder.ingest(sample(tick), [], {})
        self.assertIsNone(self.recorder.charging.status(1599, "Discharging")["ended_at"])
        self.recorder.close()
        self.recorder.start()
        self.assertIsNone(self.recorder.charging.status(1599, "Discharging")["ended_at"])
        self.assert_integrity()

    def test_full_typed_v1_upgrade_preserves_readable_history_and_resumes(self):
        for tick in range(600):
            self.recorder.ingest(sample(tick), [game(start=tick // 20 + 1)], estimate())
        old_points = self.recorder.timeline(1000, 1599)["points"]
        self.recorder.close()
        with closing(sqlite3.connect(self.recorder.storage.path)) as connection, connection:
            connection.execute("ALTER TABLE sessions DROP COLUMN first_sample_id")
            connection.execute("ALTER TABLE sessions DROP COLUMN last_sample_id")
            connection.execute("PRAGMA user_version=1")
        self.recorder.start()
        self.assertEqual(self.recorder.timeline(1000, 1599)["points"], old_points)
        self.recorder.ingest(sample(600), [game()], {})
        self.recorder.ingest(sample(601), [game()], estimate())
        self.assertEqual(self.recorder.snapshot()["sample"]["timestamp"], 1601)
        self.assertEqual(self.recorder.snapshot()["sessions"][0]["system_seconds"], 1)
        self.assert_integrity()


if __name__ == "__main__":
    unittest.main()
