"""Observed sessions and measured intervals; graphs never drive the ledger."""

import json
import math
import sqlite3
import uuid
from pathlib import Path

from .storage import Storage, StorageFullError

MODEL = "activity-weighted-v1"
NUMERIC_FIELDS = ("battery_percent", "battery_w", "system_w", "apu_w", "cpu_w", "soc_w", "gpu_w")


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def discontinuity(previous, current, sample_interval=1.0):
    """The same continuity rule must gate estimation and measured integration."""
    dt = current["monotonic"] - previous["monotonic"]
    wall = current["timestamp"] - previous["timestamp"]
    boot = current["boottime"] - previous["boottime"]
    if dt <= 0 or wall <= 0 or boot <= 0:
        return "clock_discontinuity"
    if boot - dt > 0.5:
        return "suspend"
    if abs(wall - dt) > 2 or dt - boot > 0.5:
        return "clock_discontinuity"
    if dt > 3 * sample_interval:
        return "sampling_gap"
    return None


def validate_points(max_points):
    if isinstance(max_points, bool) or not isinstance(max_points, int) or not 2 <= max_points <= 10000:
        raise ValueError("max_points must be an integer between 2 and 10000")

def bucket_series(points, start, bucket_seconds):
    """One retained sample per bucket. Empty buckets and breaks stay disconnected."""
    result, segment, last_bucket, last_source, held = [], 0, None, None, None
    for point in points:
        bucket = int((point["timestamp"] - start) // bucket_seconds)
        gap = last_bucket is not None and bucket > last_bucket + 1
        broken = bool(point.get("break_reason")) or point.get("battery_percent") is None or (
            last_source is not None and point.get("segment") != last_source)
        if held is not None and (bucket != last_bucket or gap or broken):
            result.append(held)
            held = None
            if gap or broken:
                segment += 1
        if point.get("battery_percent") is not None and not point.get("break_reason"):
            kept = dict(point)
            kept["segment"] = segment
            held = kept
        last_bucket = bucket
        last_source = point.get("segment")
    if held is not None:
        result.append(held)
    return result


def downsample(read_points, max_points):
    """Bounded streaming selection retains segment breaks, nulls and extrema."""
    required, previous, count = {0}, None, 0
    extrema = {}

    def retain_extrema():
        required.update(index for pair in extrema.values() for _, index in pair)

    for index, point in enumerate(read_points()):
        count = index + 1
        if previous and previous["segment"] != point["segment"]:
            retain_extrema()
            extrema.clear()
        for key in NUMERIC_FIELDS:
            value = point[key]
            if value is None:
                continue
            if key not in extrema:
                extrema[key] = [(value, index), (value, index)]
            else:
                if value < extrema[key][0][0]:
                    extrema[key][0] = (value, index)
                if value > extrema[key][1][0]:
                    extrema[key][1] = (value, index)
        if previous and (previous["segment"] != point["segment"] or any(
            (previous[key] is None) != (point[key] is None) for key in NUMERIC_FIELDS
        )):
            required.update((index - 1, index))
        if len(required) > max_points:
            raise ValueError("max_points cannot preserve segment/null boundaries; increase the cap or narrow the range")
        previous = point
    if not count:
        return []
    retain_extrema()
    required.add(count - 1)
    if len(required) > max_points:
        raise ValueError("max_points cannot preserve segment/null boundaries; increase the cap or narrow the range")
    remaining = min(max_points, count) - len(required)
    candidates = count - len(required)
    chosen = {int((slot + 0.5) * candidates / remaining) for slot in range(remaining)} if remaining else set()
    result, candidate = [], 0
    for index, point in enumerate(read_points()):
        if index in required:
            result.append(point)
        else:
            if candidate in chosen:
                result.append(point)
            candidate += 1
    return result


class ChargeHistory:
    """Charge boundaries come from persisted samples, never UI uptime."""
    def __init__(self, sample_interval=1.0):
        self.sample_interval = sample_interval
        self.previous = None
        self.ended = None
        self.reason = "charge_end_unobserved"

    def restore(self, connection):
        self.previous, self.ended = None, None
        self.reason = "charge_end_unobserved"
        row = connection.execute("SELECT id FROM samples WHERE lower(json_extract(payload,'$.battery_state'))='charging' ORDER BY id DESC LIMIT 1").fetchone()
        if row:
            rows = connection.execute("SELECT timestamp,monotonic,boottime,json_extract(payload,'$.battery_state') AS battery_state FROM samples WHERE id>=? ORDER BY id", (row["id"],))
        else:
            rows = connection.execute("SELECT timestamp,monotonic,boottime,json_extract(payload,'$.battery_state') AS battery_state FROM samples ORDER BY id DESC LIMIT 1")
        for sample in rows:
            self.observe(sample)

    def observe(self, sample):
        state = str(sample["battery_state"]).lower()
        gap = discontinuity(self.previous, sample, self.sample_interval) if self.previous is not None else None
        if state == "charging":
            self.ended = None
            self.reason = "charging"
        elif self.previous is not None and str(self.previous["battery_state"]).lower() == "charging":
            if gap is None and state in ("full", "not charging", "discharging"):
                self.ended = {"timestamp": sample["timestamp"], "boottime": sample["boottime"],
                              "uncertainty_seconds": sample["timestamp"] - self.previous["timestamp"]}
                self.reason = None
            else:
                self.reason = gap or "charge_end_unobserved"
        elif self.ended is not None:
            # Elapsed is the boottime difference from the observed end, not an integral across samples.
            # A late sample does not hide that end; suspend and clock jumps still do.
            if gap not in (None, "sampling_gap"):
                self.reason = gap
            elif state not in ("full", "not charging", "discharging"):
                self.reason = "battery_state_unknown"
        self.previous = sample

    def status(self, now, current_state, recording=True):
        state = current_state.lower()
        charging = state == "charging"
        ended = None if charging else self.ended
        reason = self.reason
        if charging:
            reason = "charging"
        elif state not in ("full", "not charging", "discharging"):
            reason = "battery_state_unknown"
        elif reason == "charging":
            reason = "charge_end_unobserved"
        elapsed = None
        if ended is not None and reason is None:
            age = now - self.previous["timestamp"]
            if not recording or age > 10:
                reason = "sampling_stale"
            elif age < 0:
                reason = "clock_discontinuity"
            else:
                elapsed = self.previous["boottime"] - ended["boottime"] + age
        return {"ended_at": ended["timestamp"] if ended else None,
                "elapsed_seconds": elapsed,
                "uncertainty_seconds": ended["uncertainty_seconds"] if ended else None,
                "reason": reason or (None if ended else "charge_end_unobserved")}


class Recorder:
    def __init__(self, runtime_dir: Path, sample_interval=1.0, max_bytes=256 * 1024 * 1024):
        if not number(sample_interval) or sample_interval <= 0:
            raise ValueError("sample_interval must be positive")
        if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes <= 0:
            raise ValueError("max_bytes must be a positive integer")
        self.sample_interval = sample_interval
        self.storage = Storage(runtime_dir, max_bytes)
        self.db = None
        self.epoch = str(uuid.uuid4())
        self.revision = 0
        self.status = "stopped"
        self.error = None
        self.segment = 0
        self.previous = None
        self.previous_id = None
        self.active = {}
        self.names = {}
        self.latest = None
        self.charging = ChargeHistory(sample_interval)

    def start(self):
        if self.db is not None:
            raise RuntimeError("recorder already started")
        try:
            self.db = self.storage.open()
            with self.db:
                self.db.execute("UPDATE sessions SET status='interrupted', ended_at=last_seen WHERE status='active'")
            self.segment = self.db.execute("SELECT COALESCE(MAX(segment), 0) + 1 FROM samples").fetchone()[0]
            self.names = {row["game_id"]: row["name"] for row in self.db.execute("SELECT * FROM games")}
            row = self.db.execute("SELECT payload FROM samples ORDER BY id DESC LIMIT 1").fetchone()
            self.latest = json.loads(row[0]) if row else None
            self.charging.restore(self.db)
            self.previous = None
            self.previous_id = None
            self.active = {}
            self.status, self.error = "recording", None
            self.epoch = str(uuid.uuid4())
            self.revision = 0
        except Exception as exc:
            self.db = None
            self.storage.close()
            self.status, self.error = "error", str(exc)
            raise

    def _require_db(self):
        if self.db is None:
            raise RuntimeError("recorder is not started")

    def _storage_error(self, exc):
        message = ("storage-full: recording stopped; retained history is not deleted"
                   if isinstance(exc, StorageFullError) or getattr(exc, "sqlite_errorcode", None) == sqlite3.SQLITE_FULL
                   else str(exc))
        self.fail(message)
    def fail(self, message):
        """Stop writes without surrendering the readable ledger or ownership lock."""
        if not (self.error and self.error.startswith("storage-full")):
            self.error = str(message)
        self.status = "error"
        if self.db is not None:
            try:
                with self.db:
                    self.db.execute("UPDATE sessions SET status='interrupted', ended_at=last_seen WHERE status='active'")
            except sqlite3.Error as exc:
                # A full database may not have room even for the longer status string.
                # Query output remains interrupted; start() durably recovers these rows.
                self.error += "; interruption will be persisted on restart: " + str(exc)
        self.active = {}
        self.revision += 1


    def observe_games(self, games):
        self._require_db()
        names = {}
        for game in games:
            if not isinstance(game, dict):
                raise ValueError("game observations must be objects")
            game_id, name = game.get("game_id"), game.get("name")
            if not isinstance(game_id, str) or not game_id or len(game_id) > 128:
                raise ValueError("invalid game_id")
            if not isinstance(name, str) or not name or len(name) > 512:
                raise ValueError("invalid game name")
            if self.names.get(game_id) != name:
                names[game_id] = name
        if not names:
            return
        if self.status != "recording":
            raise RuntimeError(self.error or "recording stopped")
        try:
            self.storage.ensure_room()
            with self.db:
                self.db.executemany("INSERT INTO games VALUES (?,?) ON CONFLICT(game_id) DO UPDATE SET name=excluded.name", names.items())
            self.names.update(names)
            self.revision += 1
        except (sqlite3.Error, StorageFullError) as exc:
            self._storage_error(exc)
            raise

    def _normalize_sample(self, sample):
        for key in ("timestamp", "monotonic", "boottime"):
            if not number(sample.get(key)):
                raise ValueError(f"sample {key} must be finite")
        result = {key: float(sample[key]) for key in ("timestamp", "monotonic", "boottime")}
        for key in NUMERIC_FIELDS:
            value = sample.get(key)
            result[key] = float(value) if number(value) and value >= 0 else None
        if result["battery_percent"] is not None and result["battery_percent"] > 100:
            result["battery_percent"] = None
        result["supply"] = sample.get("supply") if sample.get("supply") in ("battery", "external", "unknown") else "unknown"
        result["battery_state"] = str(sample.get("battery_state", "unknown"))
        result["errors"] = {str(key): str(value) for key, value in sample.get("errors", {}).items()}
        if result["supply"] != "battery" or result["battery_state"].lower() != "discharging":
            result["system_w"] = None
        return result

    def _normalize_games(self, games):
        result = {}
        for game in games:
            game_id = game.get("game_id")
            if not isinstance(game_id, str) or not game_id or len(game_id) > 128:
                raise ValueError("invalid tracked game_id")
            identities = {(int(proc["pid"]), int(proc["start_ticks"])) for proc in game.get("processes", [])}
            if not identities:
                continue
            name = self.names.get(game_id, game.get("name") or game_id)
            if game_id in result:
                result[game_id]["identities"].update(identities)
            else:
                result[game_id] = {"identities": identities, "name": str(name)[:512]}
        return result

    def ingest(self, sample, games, estimates):
        self._require_db()
        if self.status != "recording":
            raise RuntimeError(self.error or "recording stopped")
        sample = self._normalize_sample(sample)
        games = self._normalize_games(games)
        if self.previous is not None and all(sample[key] == self.previous[key] for key in ("timestamp", "monotonic", "boottime")):
            return
        reason = discontinuity(self.previous, sample, self.sample_interval) if self.previous else "recording_start"
        segment = self.segment + (1 if reason and self.previous else 0)
        wire = {key: value for key, value in sample.items() if key not in ("monotonic", "boottime")}
        wire.update(segment=segment, break_reason=reason)
        active = {}
        try:
            self.storage.ensure_room()
            with self.db:
                sample_id = self.db.execute(
                    "INSERT INTO samples(timestamp,monotonic,boottime,segment,payload) VALUES (?,?,?,?,?)",
                    (sample["timestamp"], sample["monotonic"], sample["boottime"], segment, json.dumps(wire)),
                ).lastrowid
                for game_id, old in self.active.items():
                    surviving = game_id in games and bool(old["identities"] & games[game_id]["identities"])
                    if reason or not surviving:
                        self.db.execute("UPDATE sessions SET status=?, ended_at=last_seen WHERE session_id=?",
                                        ("interrupted" if reason else "ended", old["session_id"]))
                for game_id, game in games.items():
                    old = self.active.get(game_id)
                    surviving = old and not reason and bool(old["identities"] & game["identities"])
                    if surviving:
                        session_id = old["session_id"]
                        self.db.execute("UPDATE sessions SET last_seen=?,battery_start=COALESCE(battery_start,?),battery_end=COALESCE(?,battery_end) WHERE session_id=?",
                                        (sample["timestamp"], sample["battery_percent"], sample["battery_percent"], session_id))
                    else:
                        session_id = str(uuid.uuid4())
                        self.db.execute("INSERT INTO games VALUES (?,?) ON CONFLICT(game_id) DO NOTHING", (game_id, game["name"]))
                        self.db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)",
                                        (session_id, game_id, sample["timestamp"], sample["timestamp"], None,
                                         "active", int(bool(reason)), sample["battery_percent"], sample["battery_percent"],
                                         json.dumps(["observed_mid_run"] if reason else [])))
                    active[game_id] = {"session_id": session_id, "identities": game["identities"]}
                if self.previous is not None and not reason:
                    seconds = sample["monotonic"] - self.previous["monotonic"]
                    start_w, end_w = self.previous["system_w"], sample["system_w"]
                    valid_system = start_w is not None and end_w is not None
                    interval_id = self.db.execute(
                        "INSERT INTO intervals(previous_id,sample_id,start,end,seconds,system_start_w,system_end_w) VALUES (?,?,?,?,?,?,?)",
                        (self.previous_id, sample_id, self.previous["timestamp"], sample["timestamp"], seconds,
                         start_w if valid_system else None, end_w if valid_system else None),
                    ).lastrowid
                    sole = len(self.active) == len(active) == 1
                    for game_id, game in active.items():
                        old = self.active.get(game_id)
                        if not old or old["session_id"] != game["session_id"]:
                            continue
                        estimate = estimates.get(game_id, {})
                        values = []
                        reasons = set(estimate.get("reasons", []))
                        for domain in ("cpu", "gpu"):
                            value = estimate.get(domain + "_wh")
                            values.append(float(value) if number(value) and value >= 0 else None)
                            if values[-1] is None:
                                reasons.add(domain + "_estimate_unavailable")
                        if not sole:
                            reasons.add("shared_system_unallocated")
                        if not valid_system:
                            reasons.add("system_measurement_unavailable")
                        system_wh = (start_w + end_w) * 0.5 * seconds / 3600 if valid_system and sole else None
                        self.db.execute("INSERT INTO session_intervals VALUES (?,?,?,?,?)",
                                        (interval_id, game["session_id"], system_wh, *values))
                        if reasons:
                            row = self.db.execute("SELECT reasons FROM sessions WHERE session_id=?", (game["session_id"],)).fetchone()
                            self.db.execute("UPDATE sessions SET reasons=? WHERE session_id=?",
                                            (json.dumps(sorted(set(json.loads(row[0])) | reasons)), game["session_id"]))
            self.previous, self.previous_id, self.active = sample, sample_id, active
            self.segment, self.latest = segment, wire
            self.revision += 1
            self.charging.observe(sample)
        except sqlite3.OperationalError as exc:
            if exc.sqlite_errorcode == sqlite3.SQLITE_BUSY or "locked" in str(exc).lower():
                raise
            self._storage_error(exc)
            raise
        except (sqlite3.Error, StorageFullError) as exc:
            self._storage_error(exc)
            raise

    def close(self):
        try:
            if self.db is not None:
                with self.db:
                    self.db.execute("UPDATE sessions SET status='interrupted', ended_at=last_seen WHERE status='active'")
        except sqlite3.Error as exc:
            self._storage_error(exc)
            raise
        finally:
            self.storage.close()
            self.db = None
            self.active = {}
            self.previous = None
            if self.status != "error":
                self.status = "stopped"
            self.revision += 1

    @staticmethod
    def _range(start, end):
        if start is not None and not number(start) or end is not None and not number(end):
            raise ValueError("time bounds must be finite numbers")
        if start is not None and end is not None and start > end:
            raise ValueError("start must not exceed end")

    @staticmethod
    def _clip(row, start, end):
        left = max(row["start"], start) if start is not None else row["start"]
        right = min(row["end"], end) if end is not None else row["end"]
        if right <= left:
            return None
        width = row["end"] - row["start"]
        a, b = (left - row["start"]) / width, (right - row["start"]) / width
        seconds = row["seconds"] * (b - a)
        energy = None
        if row["system_start_w"] is not None:
            p, q = row["system_start_w"], row["system_end_w"]
            energy = ((p + (q - p) * a) + (p + (q - p) * b)) * 0.5 * seconds / 3600
        return b - a, seconds, energy

    def _sessions(self, game_id=None, start=None, end=None, session_id=None, active_only=False):
        where, params = [], []
        for sql, value in (("s.game_id=?", game_id), ("s.session_id=?", session_id),
                           ("s.last_seen>=?", start), ("s.started_at<=?", end)):
            if value is not None:
                where.append(sql)
                params.append(value)
        if active_only:
            where.append("s.status='active'")
        rows = self.db.execute("SELECT s.*,g.name FROM sessions s JOIN games g USING(game_id)" +
                               (" WHERE " + " AND ".join(where) if where else ""), params).fetchall()
        results = {}
        for row in rows:
            result = dict(row)
            if self.status == "error" and result["status"] == "active":
                result["status"], result["ended_at"] = "interrupted", result["last_seen"]
            result["partial_start"] = bool(result["partial_start"])
            result["reasons"] = json.loads(result["reasons"])
            result["model"] = MODEL
            for domain in ("system", "cpu", "gpu"):
                result[domain + "_wh"], result[domain + "_seconds"] = None, 0.0
            result["process_wh"], result["_joint_seconds"] = None, 0.0
            results[row["session_id"]] = result
        if not results:
            return []
        if start is None and end is None:
            # The live snapshot aggregates in SQLite, not a Python loop over hours of samples.
            columns = []
            for domain in ("system", "cpu", "gpu"):
                columns.extend((f"SUM(si.{domain}_wh) AS {domain}_wh",
                                f"SUM(CASE WHEN si.{domain}_wh IS NOT NULL THEN i.seconds ELSE 0 END) AS {domain}_seconds"))
            columns.append("SUM(CASE WHEN si.cpu_wh IS NOT NULL AND si.gpu_wh IS NOT NULL THEN i.seconds ELSE 0 END) AS joint_seconds")
            query = ("SELECT si.session_id," + ",".join(columns) +
                     " FROM session_intervals si JOIN intervals i ON i.id=si.interval_id "
                     "JOIN sessions s ON s.session_id=si.session_id" +
                     (" WHERE " + " AND ".join(where) if where else "") + " GROUP BY si.session_id")
            for row in self.db.execute(query, params):
                result = results[row["session_id"]]
                for domain in ("system", "cpu", "gpu"):
                    result[domain + "_wh"] = row[domain + "_wh"]
                    result[domain + "_seconds"] = row[domain + "_seconds"]
                result["_joint_seconds"] = row["joint_seconds"]
                if result["cpu_wh"] is not None and result["gpu_wh"] is not None:
                    result["process_wh"] = result["cpu_wh"] + result["gpu_wh"]
            return list(results.values())
        # Join the filtered sessions rather than binding one parameter per historical session.
        query = ("SELECT i.*,si.session_id,si.system_wh AS allocated_system_wh,si.cpu_wh,si.gpu_wh "
                 "FROM session_intervals si JOIN intervals i ON i.id=si.interval_id "
                 "JOIN sessions s ON s.session_id=si.session_id")
        interval_where, interval_params = list(where), list(params)
        if start is not None:
            interval_where.append("i.end>?")
            interval_params.append(start)
        if end is not None:
            interval_where.append("i.start<?")
            interval_params.append(end)
        if interval_where:
            query += " WHERE " + " AND ".join(interval_where)
        for row in self.db.execute(query, interval_params):
            clipped = self._clip(row, start, end)
            if clipped is None:
                continue
            fraction, seconds, system_wh = clipped
            result = results[row["session_id"]]
            values = {"system": system_wh if row["allocated_system_wh"] is not None else None,
                      "cpu": row["cpu_wh"] * fraction if row["cpu_wh"] is not None else None,
                      "gpu": row["gpu_wh"] * fraction if row["gpu_wh"] is not None else None}
            for domain, value in values.items():
                if value is not None:
                    result[domain + "_wh"] = (result[domain + "_wh"] or 0.0) + value
                    result[domain + "_seconds"] += seconds
            if values["cpu"] is not None and values["gpu"] is not None:
                result["_joint_seconds"] += seconds
        for result in results.values():
            if result["cpu_wh"] is not None and result["gpu_wh"] is not None:
                result["process_wh"] = result["cpu_wh"] + result["gpu_wh"]
        return list(results.values())

    @staticmethod
    def _public_session(session):
        return {key: value for key, value in session.items() if not key.startswith("_")}

    def snapshot(self):
        return {"epoch": self.epoch, "revision": self.revision, "status": self.status,
                "error": self.error, "sample": dict(self.latest) if self.latest else None,
                "sessions": [self._public_session(row) for row in self._sessions(active_only=True)] if self.db is not None and self.status == "recording" else [],
                "model": MODEL, "storage_bytes": self.storage.size(), "storage_limit_bytes": self.storage.max_bytes}

    def timeline(self, start, end, max_points=600, bucket_seconds=None):
        self._require_db()
        self._range(start, end)
        if start is None or end is None:
            raise ValueError("timeline requires start and end")
        validate_points(max_points)
        def read_points():
            for row in self.db.execute(
                "SELECT payload FROM samples WHERE timestamp>=? AND timestamp<=? ORDER BY timestamp,id", (start, end)
            ):
                yield json.loads(row[0])
        if bucket_seconds is None:
            points = downsample(read_points, max_points)
        else:
            if isinstance(bucket_seconds, bool) or not isinstance(bucket_seconds, int) or bucket_seconds < 60:
                raise ValueError("bucket_seconds must be an integer of at least 60")
            points = bucket_series(read_points(), start, bucket_seconds)
        events = []
        # Use ingestion order, not wall-clock ordering, to describe clock jumps honestly.
        for row in self.db.execute(
            "SELECT c.payload,c.timestamp,c.monotonic,c.boottime,p.payload AS previous,"
            "p.timestamp AS previous_timestamp,p.monotonic AS previous_monotonic,"
            "p.boottime AS previous_boottime FROM samples c LEFT JOIN samples p "
            "ON p.id=(SELECT MAX(id) FROM samples WHERE id<c.id) "
            "WHERE (c.timestamp>=? AND c.timestamp<=?) OR c.id="
            "(SELECT id FROM samples WHERE timestamp>? ORDER BY timestamp,id LIMIT 1) ORDER BY c.id", (start, end, end)
        ):
            point = json.loads(row["payload"])
            previous = json.loads(row["previous"]) if row["previous"] else None
            if point["break_reason"] is not None:
                old_time = previous["timestamp"] if previous else point["timestamp"]
                gap_start, gap_end = min(old_time, point["timestamp"]), max(old_time, point["timestamp"])
                if gap_start <= end and gap_end >= start:
                    label = point["break_reason"]
                    if label in ("clock_discontinuity", "suspend") and previous:
                        previous_clocks = {key: row["previous_" + key]
                                           for key in ("timestamp", "monotonic", "boottime")}
                        # Correct only the public event, retaining the original boundary payloads.
                        sleep = discontinuity(previous_clocks, row, self.sample_interval) == "suspend"
                        label = "suspend" if sleep else "clock_discontinuity"
                    event = {"kind": "gap", "timestamp": gap_start, "end": gap_end, "label": label}
                    if label == "suspend" and previous:
                        event.update(before=previous, after=point)
                    events.append(event)
            if start <= point["timestamp"] <= end and previous and previous["supply"] != point["supply"]:
                events.append({"kind": "supply", "timestamp": point["timestamp"], "end": None, "label": point["supply"]})
        for row in self.db.execute(
            "SELECT s.*,g.name FROM sessions s JOIN games g USING(game_id) WHERE s.last_seen>=? AND s.started_at<=?", (start, end)):
            ended_at = row["last_seen"] if self.status == "error" and row["status"] == "active" else row["ended_at"]
            events.append({"kind": "game", "timestamp": row["started_at"], "end": ended_at,
                           "label": row["name"], "session_id": row["session_id"],
                           "game_id": row["game_id"], "last_seen": row["last_seen"]})
        energy, seconds = None, 0.0
        for row in self.db.execute("SELECT * FROM intervals WHERE end>? AND start<?", (start, end)):
            clipped = self._clip(row, start, end)
            if clipped and clipped[2] is not None:
                energy = (energy or 0.0) + clipped[2]
                seconds += clipped[1]
        return {"start": start, "end": end, "points": points,
                "events": sorted(events, key=lambda event: event["timestamp"]), "coverage_seconds": seconds, "system_wh": energy}

    @staticmethod
    def _sort(rows, metric, sort):
        for row in rows:
            value = row[metric + "_wh"]
            seconds = row[metric + "_seconds"] if metric != "process" else row["_joint_seconds"]
            if metric == "process" and (row["cpu_seconds"] != seconds or row["gpu_seconds"] != seconds):
                value = None
            row["average_w"] = value * 3600 / seconds if value is not None and seconds else None
        if sort == "recent":
            return sorted(rows, key=lambda row: (-row["last_seen"], row.get("session_id", row["game_id"])))
        def key(row):
            value = row["average_w"] if sort == "power" else row[metric + "_wh"]
            return (value is None, -(value or 0), -row["last_seen"], row.get("session_id", row["game_id"]))
        return sorted(rows, key=key)

    def game_history(self, game_id=None, start=None, end=None, metric="system", sort="recent", offset=0, limit=50):
        self._require_db()
        self._range(start, end)
        if game_id is not None and (not isinstance(game_id, str) or not game_id or len(game_id) > 128):
            raise ValueError("invalid game_id")
        if metric not in ("system", "process", "cpu", "gpu") or sort not in ("recent", "energy", "power"):
            raise ValueError("invalid metric or sort")
        if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            raise ValueError("offset must be a nonnegative integer")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
            raise ValueError("limit must be between 1 and 200")
        sessions = self._sessions(game_id, start, end)
        if game_id is not None:
            rows = self._sort(sessions, metric, sort)
            return {"games": [], "sessions": [self._public_session(row) for row in rows[offset:offset + limit]], "total": len(rows)}
        grouped = {}
        for session in sessions:
            key = session["game_id"]
            if key not in grouped:
                grouped[key] = {"game_id": key, "name": session["name"], "session_count": 0,
                                "last_seen": session["last_seen"], "system_wh": None, "system_seconds": 0.0,
                                "cpu_wh": None, "cpu_seconds": 0.0, "gpu_wh": None, "gpu_seconds": 0.0,
                                "process_wh": None, "_joint_seconds": 0.0, "model": MODEL}
            result = grouped[key]
            result["session_count"] += 1
            result["last_seen"] = max(result["last_seen"], session["last_seen"])
            for domain in ("system", "cpu", "gpu"):
                if session[domain + "_wh"] is not None:
                    result[domain + "_wh"] = (result[domain + "_wh"] or 0.0) + session[domain + "_wh"]
                result[domain + "_seconds"] += session[domain + "_seconds"]
            result["_joint_seconds"] += session["_joint_seconds"]
        for row in grouped.values():
            if row["cpu_wh"] is not None and row["gpu_wh"] is not None:
                row["process_wh"] = row["cpu_wh"] + row["gpu_wh"]
        rows = self._sort(list(grouped.values()), metric, sort)
        return {"games": [{key: value for key, value in row.items() if key not in ("cpu_seconds", "gpu_seconds", "_joint_seconds")}
                          for row in rows[offset:offset + limit]], "sessions": [], "total": len(rows)}

    def session_detail(self, session_id, max_points=600):
        self._require_db()
        validate_points(max_points)
        if not isinstance(session_id, str) or not session_id:
            raise ValueError("invalid session_id")
        sessions = self._sessions(session_id=session_id)
        if not sessions:
            raise ValueError("session not found")
        session = sessions[0]
        return {"session": self._public_session(session),
                "timeline": self.timeline(session["started_at"], session["last_seen"], max_points)}
