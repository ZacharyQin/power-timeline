"""Real legacy SQLite files: lossless upgrade, rollback, and continued recording."""

from contextlib import closing
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from py_modules.recorder import Recorder
from py_modules.storage import StorageFullError


LEGACY_SCHEMA = """
CREATE TABLE samples(id INTEGER PRIMARY KEY,timestamp REAL NOT NULL,monotonic REAL NOT NULL,
 boottime REAL NOT NULL,segment INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE INDEX samples_time ON samples(timestamp);
CREATE TABLE games(game_id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE sessions(session_id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(game_id),
 started_at REAL NOT NULL,last_seen REAL NOT NULL,ended_at REAL,status TEXT NOT NULL,
 partial_start INTEGER NOT NULL,battery_start REAL,battery_end REAL,reasons TEXT NOT NULL);
CREATE INDEX sessions_game ON sessions(game_id,started_at);
CREATE INDEX sessions_time ON sessions(started_at,last_seen);
CREATE TABLE intervals(id INTEGER PRIMARY KEY,previous_id INTEGER NOT NULL REFERENCES samples(id),
 sample_id INTEGER NOT NULL UNIQUE REFERENCES samples(id),start REAL NOT NULL,end REAL NOT NULL,
 seconds REAL NOT NULL,system_start_w REAL,system_end_w REAL);
CREATE INDEX intervals_time ON intervals(start,end);
CREATE TABLE session_intervals(interval_id INTEGER NOT NULL REFERENCES intervals(id),
 session_id TEXT NOT NULL REFERENCES sessions(session_id),system_wh REAL,cpu_wh REAL,gpu_wh REAL,
 PRIMARY KEY(interval_id,session_id));
CREATE INDEX session_intervals_session ON session_intervals(session_id);
"""


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.path = self.root / "timeline.sqlite3"
        self.power = 12.123456789012345
        self.points = []
        self.reasons = ["z-reason", "observed_mid_run", "a-reason"]
        self.recorder = None
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.executescript(LEGACY_SCHEMA)
            for index, (timestamp, mono, boot, supply, state, watts, segment, reason) in enumerate([
                (1000, 100, 100, "external", "Charging", None, 1, "recording_start"),
                (1001, 101, 101, "external", "Not charging", None, 1, None),
                (1002, 102, 102, "battery", "Discharging", 0.0, 1, None),
                (1003, 103, 103, "battery", "Discharging", self.power, 1, None),
                (2000, 104, 1100, "battery", "Discharging", 20.0, 2, "clock_discontinuity"),
            ], 1):
                point = {"timestamp": float(timestamp), "battery_percent": 80.0,
                         "battery_w": watts, "system_w": watts, "apu_w": 5.0,
                         "cpu_w": None if index == 3 else 0.0, "soc_w": 1.0, "gpu_w": 2.0,
                         "supply": supply, "battery_state": state,
                         "errors": {"cpu_w": "未知 µW \"quoted\"\nline"} if index in (3, 4) else {},
                         "segment": segment, "break_reason": reason}
                self.points.append(point)
                connection.execute("INSERT INTO samples VALUES (?,?,?,?,?,?)",
                                   (index, timestamp, mono, boot, segment, json.dumps(point)))
            connection.execute("INSERT INTO games VALUES ('10','游戏名')")
            connection.execute("INSERT INTO sessions VALUES ('session','10',1002,1003,1003,'ended',0,80,80,?)",
                               (json.dumps(self.reasons),))
            connection.executemany("INSERT INTO intervals VALUES (?,?,?,?,?,?,?,?)", [
                (1, 1, 2, 1000, 1001, 1, None, None),
                (2, 2, 3, 1001, 1002, 1, None, None),
                (3, 3, 4, 1002, 1003, 1, 0.0, self.power),
            ])
            connection.execute("INSERT INTO session_intervals VALUES (3,'session',?,0.001,0.002)",
                               (self.power * .5 / 3600,))
        self.original = self.path.read_bytes()

    def tearDown(self):
        if self.recorder is not None:
            self.recorder.close()
        self.folder.cleanup()

    def start(self, **kwargs):
        self.recorder = Recorder(self.root, **kwargs)
        self.recorder.start()
        return self.recorder

    def test_upgrade_preserves_history_and_restart_keeps_recording(self):
        recorder = self.start()
        timeline = recorder.timeline(1000, 2000)
        self.assertEqual(timeline["points"], self.points)
        self.assertEqual(timeline["coverage_seconds"], 1)
        self.assertEqual(timeline["system_wh"], self.power * .5 / 3600)
        sleep = next(event for event in timeline["events"] if event["label"] == "suspend")
        self.assertEqual((sleep["before"], sleep["after"]), tuple(self.points[3:5]))
        session = recorder.session_detail("session")["session"]
        self.assertEqual(session["name"], "游戏名")
        self.assertEqual(session["reasons"], self.reasons)
        self.assertEqual((session["cpu_wh"], session["gpu_wh"]), (.001, .002))
        clipped = recorder.game_history("10", start=1002.25, end=1002.75)["sessions"][0]
        self.assertEqual(clipped["system_seconds"], .5)
        self.assertAlmostEqual(clipped["cpu_wh"], .0005)
        self.assertEqual(recorder.charging.ended["timestamp"], 1001)
        self.assertEqual(recorder.charging.reason, "suspend")
        backups = list(self.root.glob("timeline.pre-typed-*.sqlite3"))
        self.assertEqual(len(backups), 1)
        with closing(sqlite3.connect(backups[0])) as backup:
            self.assertEqual([json.loads(row[0]) for row in backup.execute("SELECT payload FROM samples ORDER BY id")], self.points)
        historical = recorder.timeline(1000, 1999)
        for timestamp in (2001, 2002):
            point = dict(self.points[-1], timestamp=float(timestamp), monotonic=105.0 + timestamp - 2001,
                         boottime=1101.0 + timestamp - 2001)
            recorder.ingest(point, [], {})
        self.assertEqual(recorder.timeline(2000, 2002)["coverage_seconds"], 1)
        recorder.close()
        recorder.start()
        self.assertEqual(recorder.snapshot()["sample"]["timestamp"], 2002)
        self.assertEqual(recorder.timeline(1000, 1999), historical)
        self.assertEqual(list(self.root.glob("timeline.pre-typed-*.sqlite3")), backups)

    def test_failed_cutover_leaves_original_readable_and_retryable(self):
        replace = os.replace

        def interrupt(source, destination):
            if Path(destination) == self.path:
                raise OSError("interrupted before cutover")
            return replace(source, destination)

        with patch("py_modules.storage.os.replace", side_effect=interrupt):
            with self.assertRaisesRegex(OSError, "interrupted before cutover"):
                self.start()
        self.assertEqual(self.path.read_bytes(), self.original)
        self.recorder.start()
        self.assertEqual(self.recorder.timeline(1000, 2000)["points"], self.points)

    def test_migration_cannot_fit_does_not_damage_old_history(self):
        with self.assertRaises(StorageFullError):
            self.start(max_bytes=4096)
        self.assertEqual(self.path.read_bytes(), self.original)
        self.recorder = None
        self.assertEqual(self.start().timeline(1000, 2000)["points"], self.points)

    def test_future_schema_is_not_downgraded(self):
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("PRAGMA user_version=99")
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "unsupported history schema version"):
            self.start()
        self.assertEqual(self.path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
