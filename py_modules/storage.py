"""Single-owner, crash-safe SQLite storage for the power timeline."""

import fcntl
import json
import os
import sqlite3
import tempfile
import time
from pathlib import Path


SCHEMA_VERSION = 2
NUMERIC_FIELDS = ("battery_percent", "battery_w", "system_w", "apu_w", "cpu_w", "soc_w", "gpu_w")
SAMPLE_COLUMNS = ("timestamp", "monotonic", "boottime", "segment", *NUMERIC_FIELDS,
                  "supply_id", "battery_state_id", "errors_id", "break_reason_id")
INSERT_SAMPLE = "INSERT INTO samples(" + ",".join(SAMPLE_COLUMNS) + ") VALUES (" + ",".join("?" for _ in SAMPLE_COLUMNS) + ")"


SCHEMA = """
CREATE TABLE IF NOT EXISTS strings (
    id INTEGER PRIMARY KEY,
    value TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS error_sets (id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS error_set_entries (
    error_set_id INTEGER NOT NULL REFERENCES error_sets(id),
    field_id INTEGER NOT NULL REFERENCES strings(id),
    message_id INTEGER NOT NULL REFERENCES strings(id),
    PRIMARY KEY(error_set_id, field_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY,
    timestamp REAL NOT NULL,
    monotonic REAL NOT NULL,
    boottime REAL NOT NULL,
    segment INTEGER NOT NULL,
    battery_percent REAL,
    battery_w REAL,
    system_w REAL,
    apu_w REAL,
    cpu_w REAL,
    soc_w REAL,
    gpu_w REAL,
    supply_id INTEGER NOT NULL REFERENCES strings(id),
    battery_state_id INTEGER NOT NULL REFERENCES strings(id),
    errors_id INTEGER REFERENCES error_sets(id),
    break_reason_id INTEGER REFERENCES strings(id)
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
    first_sample_id INTEGER REFERENCES samples(id),
    last_sample_id INTEGER REFERENCES samples(id)
);
CREATE INDEX IF NOT EXISTS sessions_game ON sessions(game_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_time ON sessions(started_at, last_seen);
CREATE TABLE IF NOT EXISTS session_reasons (
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    position INTEGER NOT NULL,
    reason_id INTEGER NOT NULL REFERENCES strings(id),
    PRIMARY KEY(session_id, position)
) WITHOUT ROWID;
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


def intern_string(connection, value):
    if value is None:
        return None
    row = connection.execute("SELECT id FROM strings WHERE value=?", (value,)).fetchone()
    if row is not None:
        return row[0]
    return connection.execute("INSERT INTO strings(value) VALUES (?)", (value,)).lastrowid


def sample_values(connection, sample, cache=None):
    """All dictionary writes belong to the caller's sample transaction.

    Only the one-transaction migration supplies a cache; live writes must not
    retain IDs from a transaction that can roll back or be retried after BUSY.
    """
    def string(value):
        if cache is None:
            return intern_string(connection, value)
        strings = cache.setdefault("strings", {})
        if value not in strings:
            strings[value] = intern_string(connection, value)
        return strings[value]

    entries = tuple(sorted((string(field), string(message)) for field, message in sample["errors"].items()))
    errors_id = None
    if entries:
        sets = cache.setdefault("errors", {}) if cache is not None else {}
        errors_id = sets.get(entries)
        if errors_id is None:
            matches = " OR ".join("(field_id=? AND message_id=?)" for _ in entries)
            params = (len(entries), *(value for entry in entries for value in entry), len(entries))
            row = connection.execute(
                "SELECT error_set_id FROM error_set_entries GROUP BY error_set_id "
                "HAVING COUNT(*)=? AND SUM(" + matches + ")=? LIMIT 1", params).fetchone()
            if row is not None:
                errors_id = row[0]
            else:
                errors_id = connection.execute("INSERT INTO error_sets DEFAULT VALUES").lastrowid
                connection.executemany("INSERT INTO error_set_entries VALUES (?,?,?)",
                                       ((errors_id, field, message) for field, message in entries))
            sets[entries] = errors_id
    return (sample["timestamp"], sample["monotonic"], sample["boottime"], sample["segment"],
            *(sample[key] for key in NUMERIC_FIELDS), string(sample["supply"]),
            string(sample["battery_state"]), errors_id, string(sample["break_reason"]))


class SampleReader:
    """A reader-local dictionary snapshot; no SQLite JSON decoding or writer cache."""
    def __init__(self, connection):
        self.strings = dict(connection.execute("SELECT id,value FROM strings"))
        self.errors = {}
        for set_id, field, message in connection.execute("SELECT error_set_id,field_id,message_id FROM error_set_entries"):
            self.errors.setdefault(set_id, {})[self.strings[field]] = self.strings[message]

    def decode(self, row):
        return {"timestamp": row["timestamp"], **{key: row[key] for key in NUMERIC_FIELDS},
                "supply": self.strings[row["supply_id"]], "battery_state": self.strings[row["battery_state_id"]],
                "errors": dict(self.errors[row["errors_id"]]) if row["errors_id"] is not None else {},
                "segment": row["segment"],
                "break_reason": self.strings[row["break_reason_id"]] if row["break_reason_id"] is not None else None}


def set_session_reasons(connection, session_id, reasons):
    connection.execute("DELETE FROM session_reasons WHERE session_id=?", (session_id,))
    connection.executemany("INSERT INTO session_reasons VALUES (?,?,?)",
                           ((session_id, position, intern_string(connection, reason))
                            for position, reason in enumerate(reasons)))


def merge_session_reasons(connection, session_id, reasons):
    previous = [row[0] for row in connection.execute(
        "SELECT d.value FROM session_reasons r JOIN strings d ON d.id=r.reason_id "
        "WHERE r.session_id=? ORDER BY r.position", (session_id,))]
    merged = sorted(set(previous) | set(reasons))
    if previous != merged:
        set_session_reasons(connection, session_id, merged)


class StorageFullError(RuntimeError):
    pass


def legacy_session_bounds(connection):
    """Resolve old session endpoints before deleting any of their samples."""
    rows = connection.execute(
        "SELECT s.session_id,s.last_seen,MIN(i.previous_id),MAX(i.sample_id) "
        "FROM sessions s LEFT JOIN session_intervals si USING(session_id) "
        "LEFT JOIN intervals i ON i.id=si.interval_id GROUP BY s.session_id")
    for session_id, last_seen, first, last in rows:
        if last is None:
            # An isolated legacy observation has no interval link. On repeated
            # wall times, the latest possible endpoint conservatively retains it.
            last = connection.execute("SELECT MAX(id) FROM samples WHERE timestamp=?", (last_seen,)).fetchone()[0]
            first = last
        if last is None:
            raise RuntimeError("history session has no retained sample")
        yield first, last, session_id


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
            version = self.connection.execute("PRAGMA user_version").fetchone()[0]
            columns = {row[1] for row in self.connection.execute("PRAGMA table_info(samples)")}
            if version == 0 and "payload" in columns:
                self._migrate()
            elif version not in (0, 1, SCHEMA_VERSION) or (columns and version not in (1, SCHEMA_VERSION)):
                raise RuntimeError(f"unsupported history schema version: {version}")
            self._configure(self.connection)
            if not columns:
                self.connection.executescript(SCHEMA)
                self.connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
                self.connection.commit()
            elif version == 1:
                self.write(self._upgrade_sessions)
        except Exception as exc:
            self.close()
            if getattr(exc, "sqlite_errorcode", None) == sqlite3.SQLITE_FULL:
                raise StorageFullError("storage-full: database schema cannot fit within the storage limit") from exc
            raise
        return self.connection

    def _configure(self, connection):
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("PRAGMA synchronous=FULL")
        page_size = connection.execute("PRAGMA page_size").fetchone()[0]
        pages = self.max_bytes // page_size
        if pages < 1:
            raise StorageFullError("storage-full: limit is smaller than one database page")
        connection.execute(f"PRAGMA max_page_count={pages}")

    @staticmethod
    def _sync(path):
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _migrate(self):
        """Build beside the old database; retain a durable backup before atomic cutover."""
        source = self.connection
        original_stat = self.path.stat()
        mode = original_stat.st_mode & 0o777
        expected = {"timestamp", "segment", *NUMERIC_FIELDS,
                    "supply", "battery_state", "errors", "break_reason"}
        with tempfile.TemporaryDirectory(prefix=".typed-migration-", dir=self.directory) as folder:
            staged = Path(folder) / "timeline.sqlite3"
            target = sqlite3.connect(staged, uri=True)
            try:
                self._configure(target)
                target.executescript(SCHEMA)
                target.execute("ATTACH DATABASE ? AS legacy", (self.path.resolve().as_uri() + "?mode=ro",))
                with target:
                    target.execute("INSERT INTO games SELECT * FROM legacy.games")
                    session_columns = ",".join(row[1] for row in target.execute("PRAGMA table_info(sessions)")
                                               if row[1] not in ("first_sample_id", "last_sample_id"))
                    target.execute(f"INSERT INTO sessions({session_columns}) SELECT {session_columns} FROM legacy.sessions")
                    for session_id, wire in source.execute("SELECT session_id,reasons FROM sessions"):
                        reasons = json.loads(wire)
                        if not isinstance(reasons, list) or not all(isinstance(value, str) for value in reasons):
                            raise ValueError("invalid legacy session reasons")
                        set_session_reasons(target, session_id, reasons)
                    cache = {}

                    def rows():
                        for row in source.execute("SELECT * FROM samples ORDER BY id"):
                            sample = json.loads(row["payload"])
                            if (set(sample) != expected or sample["timestamp"] != row["timestamp"]
                                    or sample["segment"] != row["segment"]):
                                raise ValueError(f"inconsistent legacy sample {row['id']}")
                            sample.update(monotonic=row["monotonic"], boottime=row["boottime"])
                            yield (row["id"], *sample_values(target, sample, cache))

                    target.executemany("INSERT INTO samples(id," + ",".join(SAMPLE_COLUMNS) + ") VALUES ("
                                       + ",".join("?" for _ in range(len(SAMPLE_COLUMNS) + 1)) + ")", rows())
                    for table in ("intervals", "session_intervals"):
                        target.execute(f"INSERT INTO {table} SELECT * FROM legacy.{table}")
                    target.executemany("UPDATE sessions SET first_sample_id=?,last_sample_id=? WHERE session_id=?",
                                       legacy_session_bounds(target))
                    target.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
                for table in ("samples", "games", "sessions", "intervals", "session_intervals"):
                    if target.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] != source.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]:
                        raise RuntimeError(f"history migration count mismatch: {table}")
                if target.execute("PRAGMA quick_check").fetchone()[0] != "ok" or target.execute("PRAGMA foreign_key_check").fetchone():
                    raise RuntimeError("history migration integrity check failed")
                if staged.stat().st_size > self.max_bytes:
                    raise StorageFullError("storage-full: migrated history exceeds the storage limit")
            finally:
                target.close()
            backup_staged = Path(folder) / "legacy.sqlite3"
            backup = sqlite3.connect(backup_staged)
            try:
                source.backup(backup, pages=256)
            finally:
                backup.close()
            os.chmod(backup_staged, mode)
            os.chmod(staged, mode)
            if os.geteuid() == 0:
                os.chown(backup_staged, original_stat.st_uid, original_stat.st_gid)
                os.chown(staged, original_stat.st_uid, original_stat.st_gid)
            self._sync(backup_staged)
            self._sync(staged)
            backup_path = self.directory / f"timeline.pre-typed-{time.time_ns()}.sqlite3"
            os.replace(backup_staged, backup_path)
            self._sync(self.directory)
            source.close()
            self.connection = None
            os.replace(staged, self.path)
            self._sync(self.directory)
            self.connection = sqlite3.connect(self.path, timeout=5)

    def size(self):
        # DELETE journaling leaves no retained WAL outside the configured page cap.
        return sum(path.stat().st_size for path in (
            self.path, Path(str(self.path) + "-journal"),
            Path(str(self.path) + "-wal"), Path(str(self.path) + "-shm"),
        ) if path.exists())

    def _upgrade_sessions(self):
        self.connection.execute("ALTER TABLE sessions ADD COLUMN first_sample_id INTEGER REFERENCES samples(id)")
        self.connection.execute("ALTER TABLE sessions ADD COLUMN last_sample_id INTEGER REFERENCES samples(id)")
        self.connection.executemany("UPDATE sessions SET first_sample_id=?,last_sample_id=? WHERE session_id=?",
                                    legacy_session_bounds(self.connection))
        self.connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    def write(self, operation):
        """Eviction and the new write commit together; failed attempts lose nothing."""
        remove = 0
        count = None
        while True:
            try:
                if remove:
                    # Per-row parent checks would rescan unindexed child columns
                    # for every deleted sample. Validate the entire result once,
                    # inside this same transaction, before anything can commit.
                    self.connection.execute("PRAGMA foreign_keys=OFF")
                with self.connection:
                    self.connection.execute("BEGIN IMMEDIATE")
                    if remove:
                        self._prune(remove)
                    result = operation()
                    if remove and self.connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
                        raise sqlite3.IntegrityError("rolling history would leave invalid references")
                return result, bool(remove)
            except sqlite3.OperationalError as exc:
                if exc.sqlite_errorcode != sqlite3.SQLITE_FULL:
                    raise
                if count is None:
                    count = self.connection.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
                # Keep the live integrator's previous sample and its dictionary IDs.
                if remove >= count - 1:
                    raise StorageFullError("storage-full: one write cannot fit while retaining the latest sample") from exc
                remove = min(count - 1, max(remove * 2, (count + 99) // 100))
            finally:
                if remove:
                    self.connection.execute("PRAGMA foreign_keys=ON")

    def _prune(self, count):
        connection = self.connection
        boundary = connection.execute(
            "SELECT id,timestamp,battery_percent FROM samples ORDER BY id LIMIT 1 OFFSET ?", (count,)).fetchone()
        first_id = boundary["id"]
        linked = "first_sample_id" in {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}
        bounds = (connection.execute("SELECT first_sample_id,last_sample_id,session_id FROM sessions WHERE first_sample_id<?", (first_id,))
                  if linked else legacy_session_bounds(connection))
        expired, partial = [], []
        for first, last, session_id in bounds:
            if last < first_id:
                expired.append((session_id,))
            elif first < first_id:
                partial.append((session_id,))
        # The interval ending at the first kept sample still needs a deleted endpoint.
        connection.execute("DELETE FROM session_intervals WHERE interval_id IN (SELECT id FROM intervals WHERE sample_id<=?)", (first_id,))
        connection.execute("DELETE FROM intervals WHERE sample_id<=?", (first_id,))
        connection.executemany("DELETE FROM session_reasons WHERE session_id=?", expired)
        connection.executemany("DELETE FROM sessions WHERE session_id=?", expired)
        for (session_id,) in partial:
            connection.execute("UPDATE sessions SET started_at=?,battery_start=?,partial_start=1" +
                               (",first_sample_id=?" if linked else "") + " WHERE session_id=?",
                               (boundary["timestamp"], boundary["battery_percent"], *((first_id,) if linked else ()), session_id))
        connection.execute("DELETE FROM samples WHERE id<?", (first_id,))
        for (session_id,) in partial:
            merge_session_reasons(connection, session_id, ["history_trimmed"])
        connection.execute("DELETE FROM games WHERE game_id NOT IN (SELECT game_id FROM sessions)")
        connection.execute("DELETE FROM error_set_entries WHERE error_set_id NOT IN (SELECT errors_id FROM samples WHERE errors_id IS NOT NULL)")
        connection.execute("DELETE FROM error_sets WHERE id NOT IN (SELECT errors_id FROM samples WHERE errors_id IS NOT NULL)")
        connection.execute(
            "DELETE FROM strings WHERE id NOT IN ("
            "SELECT supply_id FROM samples UNION SELECT battery_state_id FROM samples "
            "UNION SELECT break_reason_id FROM samples WHERE break_reason_id IS NOT NULL "
            "UNION SELECT field_id FROM error_set_entries UNION SELECT message_id FROM error_set_entries "
            "UNION SELECT reason_id FROM session_reasons)")

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
