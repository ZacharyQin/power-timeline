"""Daily full-charge/design capacity history, independent of rolling power samples."""

import math
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path


SCHEMA_VERSION = 1
SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_health (
    day TEXT PRIMARY KEY,
    observed_at REAL NOT NULL,
    health_percent REAL NOT NULL,
    full_capacity REAL NOT NULL,
    design_capacity REAL NOT NULL,
    capacity_unit TEXT NOT NULL CHECK(capacity_unit IN ('mAh', 'Wh'))
)
"""


def capacity_ratio(charge_full, charge_design, energy_full, energy_design):
    """Use one complete pair, with the same priority as the live battery profile."""
    for full, design in ((charge_full, charge_design), (energy_full, energy_design)):
        if all(isinstance(value, (int, float)) and not isinstance(value, bool)
               and math.isfinite(value) and value > 0 for value in (full, design)):
            ratio = full / design * 100
            if math.isfinite(ratio) and ratio > 0:
                return ratio
    return None


def read_capacity(battery):
    if battery is None:
        return None

    def positive(name, scale):
        try:
            value = int((Path(battery) / name).read_text().strip()) / scale
            return value if math.isfinite(value) and value > 0 else None
        except (OSError, ValueError, OverflowError):
            return None

    charge_full = positive("charge_full", 1000)
    charge_design = positive("charge_full_design", 1000)
    energy_full = positive("energy_full", 1e6)
    energy_design = positive("energy_full_design", 1e6)
    design_voltage = positive("voltage_min_design", 1e6)
    if design_voltage is not None:
        if energy_full is None and charge_full is not None:
            energy_full = charge_full * design_voltage / 1000
        if energy_design is None and charge_design is not None:
            energy_design = charge_design * design_voltage / 1000
    ratio = capacity_ratio(charge_full, charge_design, energy_full, energy_design)
    if ratio is None:
        return None
    if charge_full is not None and charge_design is not None:
        return ratio, charge_full, charge_design, "mAh"
    return ratio, energy_full, energy_design, "Wh"


class BatteryHealth:
    def __init__(self, runtime_dir):
        self.path = Path(runtime_dir) / "battery-health.sqlite3"

    @staticmethod
    def _check_version(connection):
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, SCHEMA_VERSION):
            raise RuntimeError(f"unsupported battery health schema version: {version}")

    def record(self, battery, timestamp):
        """Called by a separate background worker; keep the last valid reading per local day."""
        if (not isinstance(timestamp, (int, float)) or isinstance(timestamp, bool)
                or not math.isfinite(timestamp) or timestamp <= 0):
            raise ValueError("battery health timestamp must be positive and finite")
        reading = read_capacity(battery)
        if reading is None:
            return False
        day = datetime.fromtimestamp(timestamp).date().isoformat()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=0.1)) as connection:
            self._check_version(connection)
            connection.execute("PRAGMA synchronous=FULL")
            with connection:
                connection.execute(SCHEMA)
                connection.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
                connection.execute(
                    "INSERT INTO daily_health VALUES (?,?,?,?,?,?) "
                    "ON CONFLICT(day) DO UPDATE SET observed_at=excluded.observed_at, "
                    "health_percent=excluded.health_percent, full_capacity=excluded.full_capacity, "
                    "design_capacity=excluded.design_capacity, capacity_unit=excluded.capacity_unit "
                    "WHERE excluded.observed_at >= daily_health.observed_at",
                    (day, timestamp, *reading))
        return True

    def history(self):
        if not self.path.exists():
            return []
        with closing(sqlite3.connect(self.path.resolve().as_uri() + "?mode=ro", uri=True, timeout=0.1)) as connection:
            self._check_version(connection)
            connection.row_factory = sqlite3.Row
            return [dict(row) for row in connection.execute("SELECT * FROM daily_health ORDER BY day")]
