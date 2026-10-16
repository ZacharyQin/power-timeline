"""Boundary regressions using actual SQLite and recorder session transitions."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from py_modules.recorder import Recorder
from py_modules.storage import StorageFullError


def sample(t, power=12.0, **changes):
    result = {"timestamp": 1000.0 + t, "monotonic": 100.0 + t, "boottime": 100.0 + t,
              "battery_percent": 80.0, "supply": "battery", "battery_state": "Discharging",
              "battery_w": power, "system_w": power, "apu_w": 5.0, "cpu_w": 2.0,
              "soc_w": 1.0, "gpu_w": 2.0, "errors": {}}
    result.update(changes)
    return result


def game(game_id="10", pid=100, start=1):
    return {"game_id": game_id, "name": "Game " + game_id,
            "processes": [{"pid": pid, "start_ticks": start, "cpu_ticks": 1, "gpu_ns": 1}],
            "cpu_total_ticks": 100, "gpu_complete": True}


def estimate(game_id="10", cpu=0.001, gpu=0.002):
    return {game_id: {"cpu_wh": cpu, "gpu_wh": gpu, "model": "activity-weighted-v1", "reasons": []}}


class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.recorder = Recorder(Path(self.directory.name))
        self.recorder.start()

    def tearDown(self):
        self.recorder.close()
        self.directory.cleanup()

    def test_trapezoid_range_and_coverage_do_not_depend_on_downsampling(self):
        self.recorder.ingest(sample(0, 0), [game()], {})
        self.recorder.ingest(sample(1, 12), [game()], estimate())
        self.recorder.ingest(sample(2, 24), [game()], estimate())
        timeline = self.recorder.timeline(1000, 1002, max_points=2)
        self.assertEqual(len(timeline["points"]), 2)
        self.assertAlmostEqual(timeline["system_wh"], 24 / 3600)
        self.assertEqual(timeline["coverage_seconds"], 2)
        clipped = self.recorder.timeline(1000.5, 1001.5)
        self.assertAlmostEqual(clipped["system_wh"], 12 / 3600)
        self.assertEqual(clipped["coverage_seconds"], 1)
        session = self.recorder.game_history("10", start=1000.5, end=1001.5)["sessions"][0]
        self.assertAlmostEqual(session["system_wh"], clipped["system_wh"])
        self.assertAlmostEqual(session["cpu_wh"], 0.001)
        self.assertEqual(session["system_seconds"], 1)
        self.assertAlmostEqual(session["process_wh"], 0.003)

    def test_clock_discontinuities_never_integrate_or_claim_session_continuity(self):
        cases = [
            ({"monotonic": 99.0}, "clock_discontinuity"),
            ({"timestamp": 999.0, "boottime": 102.0}, "clock_discontinuity"),
            ({"boottime": 100.0}, "clock_discontinuity"),
            ({"timestamp": 1010.0}, "clock_discontinuity"),
            ({"timestamp": 1010.0, "monotonic": 110.0, "boottime": 101.0}, "clock_discontinuity"),
            ({"boottime": 102.0}, "suspend"),
            ({"timestamp": 1004.0, "monotonic": 104.0, "boottime": 104.0}, "sampling_gap"),
        ]
        for changes, expected_reason in cases:
            with self.subTest(changes=changes):
                with tempfile.TemporaryDirectory() as folder:
                    recorder = Recorder(Path(folder))
                    recorder.start()
                    try:
                        recorder.ingest(sample(0), [game()], {})
                        recorder.ingest(sample(1, **changes), [game()], estimate())
                        history = recorder.game_history("10")
                        self.assertEqual(history["total"], 2)
                        self.assertEqual({row["status"] for row in history["sessions"]}, {"active", "interrupted"})
                        self.assertTrue(all(row["system_wh"] is None for row in history["sessions"]))
                        timeline = recorder.timeline(990, 1020)
                        self.assertIsNone(timeline["system_wh"])
                        self.assertEqual(timeline["coverage_seconds"], 0)
                        self.assertEqual(len({point["segment"] for point in timeline["points"]}), 2)
                        self.assertEqual(recorder.snapshot()["sample"]["break_reason"], expected_reason)
                        event = next(event for event in timeline["events"]
                                     if event["kind"] == "gap" and event["end"] > event["timestamp"])
                        self.assertEqual(event["label"], expected_reason)
                        if expected_reason != "suspend":
                            self.assertNotIn("before", event)
                            self.assertNotIn("after", event)
                    finally:
                        recorder.close()

    def test_long_suspend_takes_precedence_without_integrating_sleep(self):
        self.recorder.ingest(sample(0), [game()], {})
        self.recorder.ingest(sample(1), [game()], estimate())
        old_session = self.recorder.snapshot()["sessions"][0]["session_id"]
        self.recorder.ingest(sample(18985.366, monotonic=104.434), [game()], estimate())
        self.assertEqual(self.recorder.snapshot()["sample"]["break_reason"], "suspend")
        self.recorder.ingest(sample(18986.366, monotonic=105.434), [game()], estimate())
        timeline = self.recorder.timeline(1000, 19986.366)
        self.assertEqual(len(timeline["points"]), 4)
        before, after = timeline["points"][1:3]
        self.assertEqual([event for event in timeline["events"] if event["label"] == "suspend"],
                         [{"kind": "gap", "timestamp": before["timestamp"], "end": after["timestamp"],
                           "label": "suspend", "before": before, "after": after}])
        self.assertEqual(timeline["coverage_seconds"], 2)
        self.assertAlmostEqual(timeline["system_wh"], 24 / 3600)
        history = self.recorder.game_history("10")["sessions"]
        self.assertEqual(len(history), 2)
        old = next(row for row in history if row["session_id"] == old_session)
        self.assertEqual((old["status"], old["last_seen"], old["ended_at"]), ("interrupted", 1001, 1001))
        for session in history:
            self.assertEqual(session["system_seconds"], 1)
            self.assertAlmostEqual(session["system_wh"], 12 / 3600)
            self.assertAlmostEqual(session["cpu_wh"], 0.001)

    def test_legacy_suspend_query_preserves_real_boundaries_and_ledger(self):
        self.recorder.ingest(sample(0), [game()], {})
        self.recorder.ingest(sample(1, 0, cpu_w=None, errors={"cpu": "unavailable"}), [game()], estimate())
        self.recorder.ingest(sample(18985.366, None, monotonic=104.434, cpu_w=0), [game()], estimate())
        after_id = self.recorder.previous_id
        # Reproduce the payload written by the old wall-first discontinuity rule.
        after = dict(self.recorder.snapshot()["sample"], break_reason="clock_discontinuity")
        with self.recorder.db:
            self.recorder.db.execute("UPDATE samples SET payload=? WHERE id=?", (json.dumps(after), after_id))
        self.recorder.ingest(sample(18986.366, monotonic=105.434), [game()], estimate())
        stored = [json.loads(row[0]) for row in self.recorder.db.execute("SELECT payload FROM samples ORDER BY id")]
        before, after = stored[1:3]
        history = self.recorder.game_history("10")
        database = list(self.recorder.db.iterdump())
        changes = self.recorder.db.total_changes
        full = self.recorder.timeline(1000, 19986.366)
        self.assertEqual(full["points"], stored)
        self.assertEqual(full["coverage_seconds"], 1)
        self.assertAlmostEqual(full["system_wh"], 6 / 3600)
        expected = {"kind": "gap", "timestamp": before["timestamp"], "end": after["timestamp"],
                    "label": "suspend", "before": before, "after": after}
        self.assertIn(expected, full["events"])
        windows = [
            (before["timestamp"], after["timestamp"], [before, after]),
            (before["timestamp"] - 0.5, before["timestamp"] + 20, [before]),
            (after["timestamp"] - 20, after["timestamp"] + 0.5, [after]),
            (before["timestamp"] + 20, after["timestamp"] - 20, []),
        ]
        for start, end, points in windows:
            with self.subTest(start=start, end=end):
                timeline = self.recorder.timeline(start, end)
                self.assertEqual(timeline["points"], points)
                sleep = next(event for event in timeline["events"] if event["label"] == "suspend")
                self.assertEqual(sleep, expected)
                self.assertEqual(sleep["before"]["system_w"], 0)
                self.assertIsNone(sleep["before"]["cpu_w"])
                self.assertIsNone(sleep["after"]["system_w"])
                self.assertEqual(sleep["after"]["cpu_w"], 0)
                self.assertEqual(sleep["after"]["break_reason"], "clock_discontinuity")
                self.assertNotIn("monotonic", sleep["after"])
                if start < before["timestamp"]:
                    self.assertEqual(timeline["coverage_seconds"], 0.5)
                    self.assertAlmostEqual(timeline["system_wh"], 1.5 / 3600)
                else:
                    self.assertEqual(timeline["coverage_seconds"], 0)
                    self.assertIsNone(timeline["system_wh"])
        self.assertEqual(self.recorder.game_history("10"), history)
        self.assertEqual(self.recorder.db.total_changes, changes)
        self.assertEqual(list(self.recorder.db.iterdump()), database)

    def test_legacy_negative_boot_minus_monotonic_is_not_sleep(self):
        self.recorder.ingest(sample(0), [], {})
        self.recorder.ingest(sample(10, boottime=101), [], {})
        after = dict(self.recorder.snapshot()["sample"], break_reason="suspend")
        with self.recorder.db:
            self.recorder.db.execute("UPDATE samples SET payload=? WHERE id=?",
                                     (json.dumps(after), self.recorder.previous_id))
        changes = self.recorder.db.total_changes
        timeline = self.recorder.timeline(1000, 1010)
        self.assertEqual(timeline["points"][-1], after)
        self.assertEqual(timeline["events"][-1], {"kind": "gap", "timestamp": 1000, "end": 1010,
                                                  "label": "clock_discontinuity"})
        self.assertEqual(timeline["coverage_seconds"], 0)
        self.assertIsNone(timeline["system_wh"])
        self.assertEqual(self.recorder.db.total_changes, changes)

    def test_sleep_boundary_uses_ingestion_predecessor_after_wall_clock_jump(self):
        self.recorder.ingest(sample(0), [], {})
        self.recorder.ingest(sample(10, monotonic=101, boottime=101), [], {})
        self.recorder.ingest(sample(1, monotonic=102, boottime=102), [], {})
        before = self.recorder.snapshot()["sample"]
        self.recorder.ingest(sample(21, monotonic=103, boottime=122), [], {})
        after = self.recorder.snapshot()["sample"]
        timeline = self.recorder.timeline(1000, 1021)
        sleep = next(event for event in timeline["events"] if event["label"] == "suspend")
        self.assertEqual(sleep, {"kind": "gap", "timestamp": 1001, "end": 1021,
                                 "label": "suspend", "before": before, "after": after})
        self.assertEqual(len([event for event in timeline["events"]
                              if event["label"] == "clock_discontinuity"]), 2)
        self.assertEqual(timeline["coverage_seconds"], 0)
        self.assertIsNone(timeline["system_wh"])

    def test_non_discharge_and_unknown_supply_cannot_be_system_power(self):
        self.recorder.ingest(sample(0), [game()], {})
        self.recorder.ingest(sample(1, supply="external"), [game()], estimate())
        self.assertIsNone(self.recorder.snapshot()["sample"]["system_w"])
        self.assertEqual(self.recorder.snapshot()["sample"]["battery_w"], 12)
        self.recorder.ingest(sample(2, battery_state="Charging"), [game()], estimate())
        self.recorder.ingest(sample(3, supply="unknown"), [game()], estimate())
        self.recorder.ingest(sample(4), [game()], estimate())
        self.recorder.ingest(sample(5), [game()], estimate())
        timeline = self.recorder.timeline(1000, 1005)
        self.assertEqual(timeline["coverage_seconds"], 1)
        self.assertAlmostEqual(timeline["system_wh"], 12 / 3600)
        session = self.recorder.game_history("10")["sessions"][0]
        self.assertEqual(session["cpu_seconds"], 5)
        self.assertEqual(session["system_seconds"], 1)

    def test_pid_reuse_replaces_session_but_surviving_child_keeps_it(self):
        first = game()
        second = game(pid=101, start=2)
        combined = dict(first, processes=first["processes"] + second["processes"])
        self.recorder.ingest(sample(0), [first], {})
        initial = self.recorder.snapshot()["sessions"][0]["session_id"]
        self.recorder.ingest(sample(1), [combined], estimate())
        self.recorder.ingest(sample(2), [second], estimate())
        self.assertEqual(self.recorder.snapshot()["sessions"][0]["session_id"], initial)
        self.recorder.ingest(sample(3), [game(pid=101, start=9)], estimate())
        history = self.recorder.game_history("10")["sessions"]
        self.assertEqual(len(history), 2)
        old = next(row for row in history if row["session_id"] == initial)
        self.assertEqual(old["status"], "ended")
        self.assertEqual(old["ended_at"], 1002)
        self.assertEqual(old["last_seen"], 1002)
        self.assertEqual(old["system_seconds"], 2)
        new = self.recorder.snapshot()["sessions"][0]
        self.assertEqual(new["started_at"], 1003)
        self.assertFalse(new["partial_start"])
        self.assertIsNone(new["system_wh"])

    def test_session_retains_first_and_last_valid_battery_readings(self):
        self.recorder.ingest(sample(0, battery_percent=None), [game()], {})
        self.recorder.ingest(sample(1, battery_percent=79), [game()], estimate())
        self.recorder.ingest(sample(2, battery_percent=None), [game()], estimate())
        self.recorder.ingest(sample(3), [], {})
        row = self.recorder.game_history("10")["sessions"][0]
        self.assertEqual((row["battery_start"], row["battery_end"]), (79, 79))
        self.assertEqual(row["last_seen"], 1002)

    def test_null_domains_are_not_zero_and_partial_domains_are_independent(self):
        self.recorder.ingest(sample(0), [game()], {})
        self.recorder.ingest(sample(1), [game()], estimate(cpu=0, gpu=None))
        row = self.recorder.game_history("10")["sessions"][0]
        self.assertEqual(row["cpu_wh"], 0)
        self.assertEqual(row["cpu_seconds"], 1)
        self.assertIsNone(row["gpu_wh"])
        self.assertEqual(row["gpu_seconds"], 0)
        self.assertIsNone(row["process_wh"])
        self.recorder.ingest(sample(2), [game()], estimate(cpu=None, gpu=0.002))
        row = self.recorder.game_history("10")["sessions"][0]
        self.assertEqual(row["gpu_seconds"], 1)
        self.assertEqual(row["cpu_seconds"], 1)
        self.assertEqual(row["process_wh"], 0.002)

    def test_observations_names_only_and_duplicates_do_not_duplicate_energy(self):
        self.recorder.observe_games([{"game_id": "10", "name": "Named"}] * 2)
        self.assertEqual(self.recorder.snapshot()["sessions"], [])
        self.assertEqual(self.recorder.game_history()["total"], 0)
        self.recorder.ingest(sample(0), [game(), game()], {})
        self.recorder.ingest(sample(1), [game(), game()], estimate())
        revision = self.recorder.snapshot()["revision"]
        self.recorder.ingest(sample(1), [game(), game()], estimate())
        self.assertEqual(self.recorder.snapshot()["revision"], revision)
        row = self.recorder.game_history()["games"][0]
        self.assertEqual(row["session_count"], 1)
        self.assertEqual(row["name"], "Named")
        self.assertAlmostEqual(row["system_wh"], 12 / 3600)
        self.assertEqual(row["cpu_wh"], 0.001)

    def test_concurrent_games_do_not_duplicate_measured_energy(self):
        games = [game(), game("20", pid=200)]
        self.recorder.ingest(sample(0), games, {})
        both = {**estimate(), **estimate("20")}
        self.recorder.ingest(sample(1), games, both)
        self.assertAlmostEqual(self.recorder.timeline(1000, 1001)["system_wh"], 12 / 3600)
        for summary in self.recorder.game_history()["games"]:
            self.assertIsNone(summary["system_wh"])
            self.assertEqual(summary["system_seconds"], 0)
            self.assertEqual(summary["process_wh"], 0.003)
        for game_id in ("10", "20"):
            session = self.recorder.game_history(game_id)["sessions"][0]
            self.assertIn("shared_system_unallocated", session["reasons"])

    def test_restart_marks_last_observed_boundary_without_connecting_history(self):
        self.recorder.ingest(sample(0), [game()], {})
        self.recorder.ingest(sample(1), [game()], estimate())
        old_id = self.recorder.snapshot()["sessions"][0]["session_id"]
        self.recorder.close()
        # Recreate a crash-left active row, exercising recovery rather than only close().
        db = sqlite3.connect(Path(self.directory.name) / "timeline.sqlite3")
        with db:
            db.execute("UPDATE sessions SET status='active',ended_at=NULL")
        db.close()
        self.recorder = Recorder(Path(self.directory.name))
        self.recorder.start()
        self.recorder.ingest(sample(2), [game()], estimate())
        rows = self.recorder.game_history("10")["sessions"]
        old = next(row for row in rows if row["session_id"] == old_id)
        self.assertEqual(old["status"], "interrupted")
        self.assertEqual(old["ended_at"], 1001)
        self.assertEqual(old["system_seconds"], 1)
        self.assertTrue(self.recorder.snapshot()["sessions"][0]["partial_start"])
        self.assertEqual(self.recorder.timeline(1000, 1002)["coverage_seconds"], 1)

    def test_exclusive_owner_releases_lock(self):
        other = Recorder(Path(self.directory.name))
        with self.assertRaises(BlockingIOError):
            other.start()
        self.recorder.close()
        other.start()
        other.close()

    def test_downsampling_retains_extrema_without_changing_energy(self):
        for t in range(40):
            self.recorder.ingest(sample(t, system_w=40 if t == 17 else 12,
                                        cpu_w=7 if t == 29 else 2), [], {})
        full = self.recorder.timeline(1000, 1039)
        reduced = self.recorder.timeline(1000, 1039, 8)
        self.assertEqual(max(p["system_w"] for p in reduced["points"]), 40)
        self.assertEqual(max(p["cpu_w"] for p in reduced["points"]), 7)
        self.assertEqual(reduced["coverage_seconds"], full["coverage_seconds"])
        self.assertEqual(reduced["system_wh"], full["system_wh"])

    def test_downsampling_preserves_null_pairs_and_gap_endpoints_or_rejects_cap(self):
        for t in range(5):
            self.recorder.ingest(sample(t, cpu_w=None if t == 2 else 2), [], {})
        self.recorder.ingest(sample(10), [], {})
        self.recorder.ingest(sample(11), [], {})
        full = self.recorder.timeline(1000, 1011)
        self.assertEqual(len(full["points"]), 7)
        with self.assertRaisesRegex(ValueError, "preserve"):
            self.recorder.timeline(1000, 1011, 3)
        points = self.recorder.timeline(1000, 1011, 7)["points"]
        self.assertIsNone(points[2]["cpu_w"])
        self.assertNotEqual(points[4]["segment"], points[5]["segment"])
        self.assertEqual(full["coverage_seconds"], 5)

    def test_history_sort_pagination_detail_and_bounds(self):
        self.recorder.ingest(sample(0), [game()], {})
        self.recorder.ingest(sample(1), [game()], estimate())
        self.recorder.ingest(sample(2), [game("20", pid=200)], {})
        self.recorder.ingest(sample(3, 24), [game("20", pid=200)], estimate("20", cpu=0.002))
        history = self.recorder.game_history(metric="system", sort="energy", limit=1)
        self.assertEqual(history["total"], 2)
        self.assertEqual(history["games"][0]["game_id"], "20")
        self.assertEqual(self.recorder.game_history(offset=1, limit=1)["games"][0]["game_id"], "10")
        row = self.recorder.game_history("10")["sessions"][0]
        detail = self.recorder.session_detail(row["session_id"])
        self.assertAlmostEqual(detail["timeline"]["system_wh"], row["system_wh"])
        for args in ({"offset": -1}, {"limit": 0}, {"limit": 201}, {"metric": "bogus"},
                     {"sort": "bogus"}, {"start": float("nan")}, {"start": 2, "end": 1}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.recorder.game_history(**args)
        with self.assertRaises(ValueError):
            self.recorder.timeline(1000, 1001, True)
        with self.assertRaises(ValueError):
            self.recorder.session_detail("missing")

    def test_history_power_matches_effective_coverage_and_preserves_unknown_and_zero(self):
        self.recorder.ingest(sample(0), [game()], {})
        self.recorder.ingest(sample(1), [game()], estimate())
        self.recorder.ingest(sample(2), [game()], estimate(gpu=None))
        self.recorder.ingest(sample(3), [game("20", pid=200)], {})
        self.recorder.ingest(sample(4), [game("20", pid=200)], estimate("20", cpu=0.004))
        self.recorder.ingest(sample(5), [game("30", pid=300)], {})
        self.recorder.ingest(sample(6), [game("30", pid=300)], estimate("30", cpu=0, gpu=None))
        self.recorder.ingest(sample(7), [game("40", pid=400)], {})
        self.recorder.ingest(sample(8), [game("40", pid=400)], estimate("40", cpu=None, gpu=None))
        rows = self.recorder.game_history(metric="cpu", sort="power")["games"]
        self.assertEqual([row["game_id"] for row in rows], ["20", "10", "30", "40"])
        self.assertAlmostEqual(rows[0]["average_w"], 14.4)
        self.assertAlmostEqual(rows[1]["average_w"], 3.6)
        self.assertEqual(rows[2]["average_w"], 0)
        self.assertIsNone(rows[3]["average_w"])
        gpu = self.recorder.game_history("10", metric="gpu", sort="power")["sessions"][0]
        self.assertAlmostEqual(gpu["average_w"], 7.2)
        process = self.recorder.game_history("10", metric="process", sort="power")["sessions"][0]
        self.assertIsNone(process["average_w"])
        grouped = self.recorder.game_history(metric="process", sort="power")["games"]
        self.assertEqual(grouped[0]["game_id"], "20")
        self.assertAlmostEqual(grouped[0]["average_w"], 21.6)
        self.assertTrue(all(row["average_w"] is None for row in grouped[1:]))

    def test_range_inside_gap_has_no_energy_but_retains_gap_event(self):
        self.recorder.ingest(sample(0), [], {})
        self.recorder.ingest(sample(10), [], {})
        timeline = self.recorder.timeline(1003, 1007)
        self.assertEqual(timeline["points"], [])
        self.assertIsNone(timeline["system_wh"])
        self.assertEqual(timeline["coverage_seconds"], 0)
        self.assertEqual(timeline["events"], [{"kind": "gap", "timestamp": 1000,
                                              "end": 1010, "label": "sampling_gap"}])

    def test_fail_keeps_history_readable_and_exclusive_until_close(self):
        self.recorder.ingest(sample(0), [game()], {})
        self.recorder.ingest(sample(1), [game()], estimate())
        session_id = self.recorder.snapshot()["sessions"][0]["session_id"]
        self.recorder.fail("telemetry stopped")
        snapshot = self.recorder.snapshot()
        self.assertEqual(snapshot["status"], "error")
        self.assertEqual(snapshot["error"], "telemetry stopped")
        self.assertEqual(snapshot["sessions"], [])
        detail = self.recorder.session_detail(session_id)
        self.assertEqual(detail["session"]["status"], "interrupted")
        self.assertEqual(detail["session"]["ended_at"], 1001)
        self.assertEqual(detail["session"]["system_seconds"], 1)
        self.assertEqual(detail["timeline"]["coverage_seconds"], 1)
        with self.assertRaises(BlockingIOError):
            Recorder(Path(self.directory.name)).start()
        with self.assertRaises(RuntimeError):
            self.recorder.ingest(sample(2), [], {})

    def test_storage_cap_rolls_back_entire_sample_and_preserves_history(self):
        self.recorder.close()
        self.recorder = Recorder(Path(self.directory.name), max_bytes=128 * 1024)
        self.recorder.start()
        self.recorder.ingest(sample(0), [game()], {})
        before = self.recorder.snapshot()
        with self.assertRaises((sqlite3.OperationalError, StorageFullError)):
            self.recorder.ingest(sample(1, errors={"sensor": "x" * 200000}), [game()], estimate())
        after = self.recorder.snapshot()
        self.assertLessEqual(after["storage_bytes"], 128 * 1024)
        self.assertEqual(after["status"], "error")
        self.assertIn("storage-full", after["error"])
        self.assertEqual(after["sample"], before["sample"])
        self.assertEqual(self.recorder.game_history("10")["sessions"][0]["last_seen"], 1000)
        self.assertEqual(len(self.recorder.timeline(1000, 1001)["points"]), 1)
        with self.assertRaises(RuntimeError):
            self.recorder.ingest(sample(2), [], {})


if __name__ == "__main__":
    unittest.main()
