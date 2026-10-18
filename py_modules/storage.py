"""Single-owner, crash-safe SQLite storage for the power timeline."""

import fcntl
import sqlite3
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY,
    timestamp REAL NOT NULL,
    monotonic REAL NOT NULL,
    boottime REAL NOT NULL,
    segment INTEGER NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS samples_time ON samples(timestamp);
CREATE TABLE IF NOT EXISTS games (
    game_id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES games(game_id),
    started_at REAL NOT NULL,
    last_seen REAL NOT NULL,
    ended_at REAL,
    status TEXT NOT NULL CHECK(status IN ('active', 'ended', 'interrupted')),
    partial_start INTEGER NOT NULL,
    battery_start REAL,
    battery_end REAL,
    reasons TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_game ON sessions(game_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_time ON sessions(started_at, last_seen);
CREATE TABLE IF NOT EXISTS intervals (
    id INTEGER PRIMARY KEY,
    previous_id INTEGER NOT NULL REFERENCES samples(id),
    sample_id INTEGER NOT NULL UNIQUE REFERENCES samples(id),
    start REAL NOT NULL,
    end REAL NOT NULL,
    seconds REAL NOT NULL,
    system_start_w REAL,
    system_end_w REAL
);
CREATE INDEX IF NOT EXISTS intervals_time ON intervals(start, end);
CREATE TABLE IF NOT EXISTS session_intervals (
    interval_id INTEGER NOT NULL REFERENCES intervals(id),
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    system_wh REAL,
    cpu_wh REAL,
    gpu_wh REAL,
    PRIMARY KEY(interval_id, session_id)
);
CREATE INDEX IF NOT EXISTS session_intervals_session ON session_intervals(session_id);
"""


class StorageFullError(RuntimeError):
    pass


class Storage:
    def __init__(self, runtime_dir: Path, max_bytes: int):
        self.directory = Path(runtime_dir)
        self.path = self.directory / "timeline.sqlite3"
        self.max_bytes = max_bytes
        self.connection = None
        self._lock = None

    def open(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        self._lock = (self.directory / "timeline.lock").open("a+b")
        try:
            fcntl.flock(self._lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.connection = sqlite3.connect(self.path, timeout=5)
            self.connection.row_factory = sqlite3.Row
            self.connection.execute("PRAGMA foreign_keys=ON")
            self.connection.execute("PRAGMA journal_mode=DELETE")
            self.connection.execute("PRAGMA synchronous=FULL")
            page_size = self.connection.execute("PRAGMA page_size").fetchone()[0]
            pages = self.max_bytes // page_size
            if pages < 1:
                raise StorageFullError("storage-full: limit is smaller than one database page")
            self.connection.execute(f"PRAGMA max_page_count={pages}")
            self.connection.executescript(SCHEMA)
            self.connection.commit()
        except Exception as exc:
            self.close()
            if getattr(exc, "sqlite_errorcode", None) == sqlite3.SQLITE_FULL:
                raise StorageFullError("storage-full: database schema cannot fit within the storage limit") from exc
            raise
        return self.connection

    def size(self):
        # DELETE journaling leaves no retained WAL outside the configured page cap.
        return sum(path.stat().st_size for path in (
            self.path, Path(str(self.path) + "-journal"),
            Path(str(self.path) + "-wal"), Path(str(self.path) + "-shm"),
        ) if path.exists())

    def ensure_room(self):
        if self.size() >= self.max_bytes:
            raise StorageFullError("storage-full: recording stopped; retained history is not deleted")

    def close(self):
        try:
            if self.connection is not None:
                self.connection.close()
                self.connection = None
        finally:
            if self._lock is not None:
                fcntl.flock(self._lock.fileno(), fcntl.LOCK_UN)
                self._lock.close()
                self._lock = None
