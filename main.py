"""Decky backend: one recorder independent of UI visibility."""

import asyncio
import os
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


class Plugin:
    async def _main(self):
        self._ready = asyncio.Event()
        self._task = None
        self._stopping = False
        self._failure = None
        self._recorder = None
        self._tracker = None
        self._power_info = None
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
            self._attribution = Attribution()
            self._task = asyncio.create_task(self._record_loop())
            decky.logger.info("Power Timeline recorder started")
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
                sample = self._telemetry.read()
                games = self._tracker.scan()
                estimates = {}
                if previous is not None and discontinuity(previous, sample) is None:
                    estimates = self._attribution.between(previous, sample, previous_games, games)
                self._recorder.ingest(sample, games, estimates)
                previous, previous_games = sample, games
                try:
                    await decky.emit("snapshot_changed", self._recorder.snapshot())
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
        if self._failure:
            result["status"] = "error"
            result["error"] = self._failure
        return result

    async def get_power_info(self):
        recorder = await self._require_recorder()
        result = await self._power_info.read()
        result["last_charge"] = recorder.charging.status(time.time(), result["battery"]["state"], recorder.status == "recording")
        return result

    async def get_timeline(self, start, end, max_points=600):
        recorder = await self._require_recorder()
        return recorder.timeline(start, end, max_points)

    async def get_game_history(self, game_id=None, start=None, end=None,
                               metric="system", sort="recent", offset=0, limit=50):
        recorder = await self._require_recorder()
        return recorder.game_history(game_id, start, end, metric, sort, offset, limit)

    async def get_session_detail(self, session_id, max_points=600):
        recorder = await self._require_recorder()
        return recorder.session_detail(session_id, max_points)

    async def observe_games(self, games, source="", observed_at=0):
        recorder = await self._require_recorder()
        if not isinstance(games, list) or len(games) > 128:
            raise ValueError("games must be a bounded list")
        self._tracker.observe_names(games)
        recorder.observe_games(games)
        return {"accepted": True}

    async def _unload(self):
        self._stopping = True
        task = getattr(self, "_task", None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        power_info = getattr(self, "_power_info", None)
        if power_info:
            await power_info.close()
        recorder = getattr(self, "_recorder", None)
        if recorder:
            recorder.close()
        decky.logger.info("Power Timeline recorder stopped")
