"""Decky backend: one recorder independent of UI visibility."""

import asyncio
import os
import sqlite3
import sys
import time
from pathlib import Path

import decky

# Loader adds py_modules, not the plugin root, to its sandbox import path.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from py_modules.attribution import Attribution
from py_modules.games import GameTracker
from py_modules.recorder import Recorder, discontinuity
from py_modules.telemetry import Telemetry
from py_modules.power_info import PowerInfo
from py_modules.power_flow import PowerFlow
from py_modules.sailing import SailingController
from py_modules.fan_control import FanController


class Plugin:
    async def _main(self):
        self._ready = asyncio.Event()
        self._task = None
        self._stopping = False
        self._history_lock = asyncio.Lock()
        self._failure = None
        self._recorder = None
        self._tracker = None
        self._power_info = None
        self._power_flow = None
        self._flow_snapshot = None
        self._sailing = None
        self._sailing_error = None
        self._fan = None
        self._fan_error = None
        try:
            runtime = os.environ.get("DECKY_PLUGIN_RUNTIME_DIR")
            if not runtime:
                raise RuntimeError("DECKY_PLUGIN_RUNTIME_DIR is unavailable")
            recorder = Recorder(Path(runtime))
            recorder.start()
            self._recorder = recorder
            self._tracker = GameTracker()
            self._telemetry = Telemetry()
            self._power_info = PowerInfo(self._telemetry)
            self._power_flow = PowerFlow(self._telemetry)
            self._attribution = Attribution()
            self._task = asyncio.create_task(self._record_loop())
            decky.logger.info("Power Timeline recorder started")
            try:
                self._sailing = SailingController(Path(runtime) / "sailing", self._telemetry, self._emit_sailing)
                await self._sailing.start()
            except Exception as exc:
                self._sailing_error = str(exc)
                if self._sailing is not None:
                    await self._sailing.close()
                    self._sailing = None
                decky.logger.exception("Sailing Mode startup failed; recording remains active")
            try:
                self._fan = FanController()
                await self._fan.start()
            except Exception as exc:
                self._fan_error = str(exc)
                if self._fan is not None:
                    try:
                        await self._fan.close()
                    except Exception:
                        decky.logger.exception("Fan startup recovery remains incomplete")
                    self._fan = None
                decky.logger.exception("Fan control startup failed; recording remains active")
        except Exception as exc:
            self._failure = str(exc)
            decky.logger.exception("Power Timeline startup failed")
        finally:
            self._ready.set()

    async def _record_loop(self):
        previous, previous_games = None, []
        try:
            while not self._stopping:
                began = time.monotonic()
                sample, flow = self._power_flow.read()
                games = self._tracker.scan()
                estimates = {}
                if previous is not None and discontinuity(previous, sample) is None:
                    estimates = self._attribution.between(previous, sample, previous_games, games)
                try:
                    self._recorder.ingest(sample, games, estimates)
                except sqlite3.OperationalError as exc:
                    if exc.sqlite_errorcode != sqlite3.SQLITE_BUSY and "locked" not in str(exc).lower():
                        raise
                    decky.logger.warning("Power Timeline sample skipped; database is locked")
                    await asyncio.sleep(max(0.05, 1.0 - (time.monotonic() - began)))
                    continue
                self._flow_snapshot = flow
                previous, previous_games = sample, games
                try:
                    await decky.emit("snapshot_changed", await self.get_snapshot())
                except Exception:
                    # A disconnected frontend must not cancel the persistent sampler.
                    decky.logger.warning("Power Timeline frontend event unavailable")
                await asyncio.sleep(max(0.05, 1.0 - (time.monotonic() - began)))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._failure = str(exc)
            decky.logger.exception("Power Timeline recording stopped")
            self._recorder.fail(self._failure)
            self._failure = self._recorder.error or self._failure
            try:
                await decky.emit("snapshot_changed", await self.get_snapshot())
            except Exception:
                pass

    async def _require_recorder(self):
        ready = getattr(self, "_ready", None)
        if ready is None:
            raise RuntimeError("Power Timeline is starting")
        await ready.wait()
        if self._recorder is None:
            raise RuntimeError(self._failure or "Power Timeline is unavailable")
        return self._recorder

    async def get_snapshot(self):
        recorder = await self._require_recorder()
        result = recorder.snapshot()
        result["power_flow"] = self._flow_snapshot
        if self._failure:
            result["status"] = "error"
            result["error"] = self._failure
        return result

    async def get_power_info(self, refresh_contract=True):
        recorder = await self._require_recorder()
        result = await self._power_info.read(refresh_contract)
        result["last_charge"] = recorder.charging.status(time.time(), result["battery"]["state"], recorder.status == "recording")
        return result

    async def _query_history(self, query, *args):
        recorder = await self._require_recorder()
        await self._history_lock.acquire()
        if self._stopping:
            self._history_lock.release()
            raise RuntimeError("Power Timeline is stopping")
        worker = asyncio.create_task(asyncio.to_thread(recorder.read_history, query, *args))

        def finished(task):
            self._history_lock.release()
            if not task.cancelled():
                task.exception()  # Also consume errors if the RPC caller has disconnected.

        worker.add_done_callback(finished)
        # Caller cancellation must not release the lock while its worker still runs.
        return await asyncio.shield(worker)

    async def get_timeline(self, start, end, max_points=600, bucket_seconds=None):
        return await self._query_history(Recorder.timeline, start, end, max_points, bucket_seconds)

    async def get_game_history(self, game_id=None, start=None, end=None,
                               metric="system", sort="recent", offset=0, limit=50):
        return await self._query_history(Recorder.game_history, game_id, start, end, metric, sort, offset, limit)

    async def get_session_detail(self, session_id, max_points=600):
        return await self._query_history(Recorder.session_detail, session_id, max_points)

    async def observe_games(self, games, source="", observed_at=0):
        recorder = await self._require_recorder()
        if not isinstance(games, list) or len(games) > 128:
            raise ValueError("games must be a bounded list")
        self._tracker.observe_names(games)
        recorder.observe_games(games)
        return {"accepted": True}

    async def _emit_sailing(self, state):
        try:
            await decky.emit("sailing_changed", state)
        except Exception:
            decky.logger.warning("Sailing Mode frontend event unavailable")

    async def _require_sailing(self):
        await self._require_recorder()
        if self._sailing is None:
            raise RuntimeError(self._sailing_error or "Sailing Mode is unavailable")
        return self._sailing

    async def get_sailing_status(self):
        return (await self._require_sailing()).snapshot()

    async def update_native_charge_settings(self, enabled, limit):
        return await (await self._require_sailing()).update_native(enabled, limit)

    async def set_sailing_mode(self, enabled, delta_percent=10):
        return await (await self._require_sailing()).set_mode(enabled, delta_percent)

    async def get_fan_status(self):
        await self._require_recorder()
        if self._fan is not None:
            return await self._fan.status()
        return {"available": False, "mode": None, "phase": "unavailable",
                "target_rpm": None, "actual_rpm": None, "fault": None,
                "original_mode": None, "reason": "monitor_failed",
                "error": self._fan_error or "Fan control is unavailable", "updated_at": time.time()}

    async def set_fan_mode(self, mode):
        await self._require_recorder()
        if self._fan is None:
            raise RuntimeError(self._fan_error or "Fan control is unavailable")
        return await self._fan.set_mode(mode)

    async def _unload(self):
        self._stopping = True
        fan = getattr(self, "_fan", None)
        if fan is not None:
            try:
                await fan.close()
            except Exception:
                decky.logger.exception("Fan restoration failed during unload; independent recovery remains available")
        sailing = getattr(self, "_sailing", None)
        if sailing is not None:
            try:
                await sailing.close()
            except Exception:
                decky.logger.exception("Sailing Mode restoration failed during unload")
        task = getattr(self, "_task", None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        history_lock = getattr(self, "_history_lock", None)
        if history_lock is not None:
            async with history_lock:
                pass  # Drain the active reader before releasing recorder ownership.
        power_flow = getattr(self, "_power_flow", None)
        if power_flow:
            power_flow.close()
        power_info = getattr(self, "_power_info", None)
        if power_info:
            await power_info.close()
        recorder = getattr(self, "_recorder", None)
        if recorder:
            recorder.close()
        decky.logger.info("Power Timeline recorder stopped")
