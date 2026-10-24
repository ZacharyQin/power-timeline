"""Stateful charge-limit control and its independent crash-restoration process.

Only the public steamdeck_hwmon charge-limit attribute is written. Native Steam
preferences remain authoritative; the frontend reports them independently of UI
visibility. The controller cannot implement hysteresis while the OS is asleep.
"""
import asyncio
import contextlib
import fcntl
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

NATIVE_LEASE_SECONDS = 15
GUARD_LEASE_SECONDS = 10
RESPONSE_SECONDS = 60


def atomic_json(path, value):
    temporary = path.with_suffix('.new')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


@contextlib.contextmanager
def hardware_lock(directory):
    with (directory / 'hardware.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def write_limit(path, value):
    if type(value) is not int or not 1 <= value <= 100:
        raise ValueError('Invalid hardware charge limit')
    path.write_text(str(value) + '\n')
    deadline = time.monotonic() + 3
    while True:
        if int(path.read_text()) == value:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError('Charge limit did not read back')
        time.sleep(0.1)


def restore_owned(directory, session):
    """Guard and owner share this operation, including the same filesystem lock."""
    with hardware_lock(directory):
        path = directory / 'recovery.json'
        recovery = json.loads(path.read_text())
        if recovery['session'] != session or not recovery['active']:
            return 'released'
        hardware = Path(recovery['hardware'])
        actual = int(hardware.read_text())
        if recovery['native_changed']:
            reason = 'native_changed'
        elif actual == recovery['original']:
            reason = 'already_restored'
        elif actual in (recovery['owned'], recovery['pending']):
            write_limit(hardware, recovery['original'])
            reason = 'restored'
        else:
            reason = 'hardware_changed'
        recovery['active'] = False
        recovery['result'] = reason
        atomic_json(path, recovery)
        return reason


def run_guard(directory, session, owner):
    """Survives the plugin process group; never writes after ownership changes."""
    directory = Path(directory)
    atomic_json(directory / f'guard-{session}.ready', {'session': session, 'pid': os.getpid()})
    while True:
        recovery = json.loads((directory / 'recovery.json').read_text())
        if recovery['session'] != session or not recovery['active']:
            return
        try:
            os.kill(owner, 0)
            seen = (directory / 'heartbeat').stat().st_mtime
            if time.monotonic() - seen > GUARD_LEASE_SECONDS:
                break
        except (ProcessLookupError, FileNotFoundError, ValueError):
            break
        time.sleep(0.5)
    try:
        result = restore_owned(directory, session)
        atomic_json(directory / 'guard-result.json', {'session': session, 'result': result})
    except Exception as exc:
        atomic_json(directory / 'guard-result.json', {'session': session, 'error': str(exc)})
        raise


class SailingController:
    def __init__(self, directory, telemetry, emit, clock=time.monotonic):
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.telemetry, self.emit, self.clock = telemetry, emit, clock
        self.config_path = self.directory / 'settings.json'
        self.config = {'enabled': False, 'delta': 10, 'upper': None, 'phase': 'waiting'}
        self.legacy_lower = None
        if self.config_path.exists():
            saved = json.loads(self.config_path.read_text())
            if (type(saved.get('enabled')) is not bool or saved.get('phase') not in ('waiting', 'charging')
                    or (saved.get('upper') is not None and
                        (type(saved['upper']) is not int or not 1 <= saved['upper'] <= 100))):
                raise ValueError('Invalid saved sailing settings')
            if 'delta' not in saved:
                lower = saved.pop('lower', None)
                if type(lower) is not int or not 20 <= lower < 100:
                    raise ValueError('Invalid saved sailing lower limit')
                upper = saved['upper']
                if upper is not None and upper > lower:
                    saved['delta'] = upper - lower
                else:
                    self.legacy_lower = lower
                    saved['delta'] = 10
            if type(saved['delta']) is not int or not 1 <= saved['delta'] <= 80:
                raise ValueError('Invalid saved sailing Delta')
            if saved['enabled'] and (saved['upper'] is None or saved['upper'] - saved['delta'] < 20):
                raise ValueError('Invalid saved sailing interval')
            self.config = {key: saved[key] for key in self.config}
        self.lock = asyncio.Lock()
        self.owner_lock = (self.directory / 'owner.lock').open('a')
        fcntl.flock(self.owner_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.native = None
        self.native_seen = None
        self.hardware = None
        self.recovery = None
        self.orphan = None
        self.guard = None
        self.task = None
        self.stopping = False
        self.error = None
        self.paused = self.config['enabled']
        self.response = None
        self.last_supply = None
        self.sleep_delta = None
        self.sample = None
        self.hardware_value = None
        self.published = None

    def _save(self):
        atomic_json(self.config_path, self.config)

    def _find_hardware(self):
        paths = []
        for path in (self.telemetry.sys_root / 'class/hwmon').glob('hwmon*'):
            try:
                if (path / 'name').read_text().strip() == 'steamdeck_hwmon':
                    candidate = path / 'max_battery_charge_level'
                    if candidate.exists():
                        paths.append(candidate.resolve())
            except OSError:
                continue
        if len(paths) != 1:
            raise RuntimeError('Steam Deck charge-limit interface is missing or ambiguous')
        self.hardware = paths[0]
        self.hardware_value = int(self.hardware.read_text())

    def _native_fresh(self):
        return self.native_seen is not None and self.clock() - self.native_seen < NATIVE_LEASE_SECONDS

    def _lower_percent(self):
        upper = self.config['upper'] if self.config['enabled'] else self.native['limit'] if self.native else None
        return None if upper is None else upper - self.config['delta']

    def snapshot(self):
        sample = self.sample or {}
        phase = ('error' if self.error else 'disabled' if not self.config['enabled']
                 else 'paused' if self.paused else self.config['phase'])
        return {'enabled': self.config['enabled'], 'phase': phase,
                'delta_percent': self.config['delta'],
                'lower_percent': self._lower_percent(), 'upper_percent': self.config['upper'],
                'battery_percent': sample.get('battery_percent'), 'supply': sample.get('supply', 'unknown'),
                'battery_state': sample.get('battery_state', 'Unknown'),
                'hardware_limit_percent': self.hardware_value,
                'native_enabled': self.native['enabled'] if self.native else None,
                'native_limit_percent': self.native['limit'] if self.native else None,
                'error': self.error, 'updated_at': time.time()}

    async def _publish(self):
        state = self.snapshot()
        comparable = {key: value for key, value in state.items() if key != 'updated_at'}
        if comparable != self.published:
            await self.emit(state)
            self.published = comparable

    async def start(self):
        # Steam may have changed while this backend was absent. Fresh native
        # settings must resolve orphan ownership before restoring or taking over.
        recovery_path = self.directory / 'recovery.json'
        if recovery_path.exists():
            previous = json.loads(recovery_path.read_text())
            if previous['active']:
                self.orphan = previous
                self.error = 'Recovery pending; waiting for current Steam charge settings'
        self.task = asyncio.create_task(self._run())


    async def _start_guard(self):
        self.recovery = {'session': uuid.uuid4().hex, 'active': True,
                         'hardware': str(self.hardware), 'original': self.hardware_value,
                         'owned': self.hardware_value, 'pending': None, 'native_changed': False}
        with hardware_lock(self.directory):
            atomic_json(self.directory / 'recovery.json', self.recovery)
        (self.directory / 'heartbeat').touch(mode=0o600, exist_ok=True)
        os.utime(self.directory / 'heartbeat', (0, time.monotonic()))
        self.guard = await asyncio.create_subprocess_exec(
            '/usr/bin/python3', str(Path(__file__).resolve()), 'guard', str(self.directory),
            self.recovery['session'], str(os.getpid()), start_new_session=True,
            stdout=subprocess.DEVNULL, stderr=None)
        deadline = self.clock() + 5
        while self.clock() < deadline:
            ready = self.directory / f"guard-{self.recovery['session']}.ready"
            if ready.exists() and json.loads(ready.read_text()).get('session') == self.recovery['session']:
                return
            if self.guard.returncode is not None:
                break
            await asyncio.sleep(0.05)
        raise RuntimeError('Independent charge-limit restoration guard did not start')

    async def _release(self, native_changed=False):
        if self.recovery is not None:
            if native_changed:
                with hardware_lock(self.directory):
                    record = json.loads((self.directory / 'recovery.json').read_text())
                    if record['session'] == self.recovery['session']:
                        record['native_changed'] = True
                        atomic_json(self.directory / 'recovery.json', record)
            await asyncio.to_thread(restore_owned, self.directory, self.recovery['session'])
            self.hardware_value = int(self.hardware.read_text())
            (self.directory / f"guard-{self.recovery['session']}.ready").unlink(missing_ok=True)
            self.recovery = None
        if self.guard is not None:
            try:
                await asyncio.wait_for(self.guard.wait(), timeout=3)
            except asyncio.TimeoutError:
                # The recovery record is already inactive before stopping a guard.
                self.guard.terminate()
                await self.guard.wait()
            self.guard = None
        self.response = None

    async def _apply(self, target):
        def apply():
            with hardware_lock(self.directory):
                record = json.loads((self.directory / 'recovery.json').read_text())
                if record['session'] != self.recovery['session'] or not record['active']:
                    raise RuntimeError('Charge-limit ownership was released')
                actual = int(self.hardware.read_text())
                if actual != record['owned']:
                    raise RuntimeError('Charge limit changed outside Sailing Mode')
                if actual == target:
                    return
                record['pending'] = target
                atomic_json(self.directory / 'recovery.json', record)
                write_limit(self.hardware, target)
                record['owned'], record['pending'] = target, None
                atomic_json(self.directory / 'recovery.json', record)
                self.recovery = record
        await asyncio.to_thread(apply)
        self.hardware_value = int(self.hardware.read_text())

    async def update_native(self, enabled, limit):
        if type(enabled) is not bool or type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('Invalid native charge setting')
        async with self.lock:
            changed = self.config['enabled'] and self.config['upper'] is not None and (
                not enabled or limit != self.config['upper'])
            self.native = {'enabled': enabled, 'limit': limit}
            self.native_seen = self.clock()
            if self.legacy_lower is not None:
                delta = limit - self.legacy_lower
                self.config['delta'] = delta if 1 <= delta <= 80 else 10
                self.legacy_lower = None
                self._save()
            if self.orphan is not None:
                with hardware_lock(self.directory):
                    record = json.loads((self.directory / 'recovery.json').read_text())
                    if record['session'] == self.orphan['session'] and record['active']:
                        record['native_changed'] = record['native_changed'] or not enabled or limit != record['original']
                        atomic_json(self.directory / 'recovery.json', record)
                await asyncio.to_thread(restore_owned, self.directory, self.orphan['session'])
                self.orphan = None
                self.error = None
            if changed:
                await self._release(native_changed=True)
                self.config['enabled'] = False
                self.error = 'Steam charge settings changed; Sailing Mode stopped without overriding them'
                self._save()
            await self._publish()
            return self.snapshot()

    async def set_mode(self, enabled, delta_percent=10):
        if type(enabled) is not bool or type(delta_percent) is not int or not 1 <= delta_percent <= 80:
            raise ValueError('Sailing Delta must be an integer from 1 to 80 percentage points')
        async with self.lock:
            if enabled:
                if not self._native_fresh() or not self.native['enabled']:
                    raise RuntimeError('Enable Steam charge limiting and wait for current native settings')
                if self.native['limit'] - delta_percent < 20:
                    raise ValueError('Sailing Delta must leave a lower limit of at least 20 percent')
            await self._release()
            self.error = None
            self.config.update(enabled=enabled, delta=delta_percent,
                               upper=self.native['limit'] if enabled else self.config['upper'], phase='waiting')
            self.paused = enabled
            self.last_supply = None
            self._save()
            if enabled:
                try:
                    await self._tick(initial=True)
                except Exception as exc:
                    await self._fail(exc)
                    raise
            await self._publish()
            return self.snapshot()

    async def _fail(self, exc):
        self.error = str(exc)
        self.config['enabled'] = False
        self._save()
        try:
            await self._release()
        except Exception as restore_error:
            self.error += '; restoration failed: ' + str(restore_error)
            # Keep the recovery record active for the independent guard.
        await self._publish()

    async def _tick(self, initial=False):
        self.sample = self.telemetry.read_battery(include_details=True)
        sample = self.sample
        delta = sample['boottime'] - sample['monotonic']
        if self.sleep_delta is not None and delta - self.sleep_delta > 2:
            self.native_seen = None
        self.sleep_delta = delta
        if self.error and not self.config['enabled']:
            return
        if self.hardware is not None:
            self.hardware_value = int(self.hardware.read_text())
        if not self.config['enabled']:
            return
        if not self._native_fresh():
            await self._release()
            self.paused = True
            return
        if sample['battery_percent'] is None or sample['supply'] not in ('battery', 'external'):
            raise RuntimeError('Current battery state is unavailable; charge control stopped')
        newly_owned = self.recovery is None
        if self.recovery is None:
            self._find_hardware()
            if self.hardware_value != self.config['upper']:
                raise RuntimeError('Hardware charge limit differs from Steam; refusing to take over')
            await self._start_guard()
            self.paused = False
        else:
            recovery = json.loads((self.directory / 'recovery.json').read_text())
            if not recovery['active'] or recovery['session'] != self.recovery['session']:
                raise RuntimeError('Independent guard released charge control')
            if self.hardware_value != recovery['owned']:
                raise RuntimeError('Charge limit changed outside Sailing Mode')
            if self.guard.returncode is not None:
                raise RuntimeError('Independent charge-limit restoration guard exited')
        os.utime(self.directory / 'heartbeat', (0, time.monotonic()))
        percent, supply = sample['battery_percent'], sample['supply']
        lower = self._lower_percent()
        phase = self.config['phase']
        if supply != 'external':
            phase = 'waiting'
        elif initial or self.last_supply == 'battery':
            phase = 'charging' if percent <= lower else 'waiting'
        elif phase == 'waiting' and percent <= lower:
            phase = 'charging'
        elif phase == 'charging' and percent >= self.config['upper']:
            phase = 'waiting'
        changed = phase != self.config['phase']
        self.config['phase'] = phase
        if changed:
            self._save()
        target = lower if phase == 'waiting' else self.config['upper']
        if self.hardware_value != target or changed or initial or newly_owned or self.last_supply == 'battery':
            await self._apply(target)
            self.response = (phase, self.clock() + RESPONSE_SECONDS) if supply == 'external' else None
        self.last_supply = supply
        if supply == 'external' and sample['battery_state'] == 'Discharging':
            raise RuntimeError('Battery is discharging with external power; charge control stopped')
        if self.response is not None:
            actual = (sample['battery_state'] == 'Charging' and (sample.get('current_a') or 0) > 0
                      if phase == 'charging' else sample['battery_state'] in ('Not charging', 'Full'))
            if actual:
                self.response = None
            elif self.clock() >= self.response[1]:
                raise RuntimeError('Hardware did not reach the requested charging state within 60 seconds')

    async def _run(self):
        try:
            while not self.stopping:
                async with self.lock:
                    try:
                        await self._tick()
                        await self._publish()
                    except Exception as exc:
                        await self._fail(exc)
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            raise

    async def close(self):
        self.stopping = True
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        try:
            async with self.lock:
                await self._release()
        finally:
            fcntl.flock(self.owner_lock, fcntl.LOCK_UN)
            self.owner_lock.close()


if __name__ == '__main__':
    if len(sys.argv) != 5 or sys.argv[1] != 'guard':
        raise SystemExit('Internal Sailing Mode guard only')
    run_guard(sys.argv[2], sys.argv[3], int(sys.argv[4]))
