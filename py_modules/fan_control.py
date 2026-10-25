"""Decky RPC facade; the independent systemd worker owns all fan writes."""
import asyncio
import contextlib
import fcntl
import json
import os
import re
import time
import uuid
from pathlib import Path

from py_modules.fan_worker import FanError, FanHardware, LEASE_SECONDS, atomic_json, command

RUNTIME_DIRECTORY = Path('/run/power-timeline/fan')


def systemd_argument(value):
    return '"' + str(value).replace('%', '%%').replace('\\', '\\\\').replace('"', '\\"') + '"'


class FanController:
    def __init__(self, directory=RUNTIME_DIRECTORY):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, mode=0o700, exist_ok=True)
        self.owner_lock = os.fdopen(os.open(self.directory / 'owner.lock', os.O_CREAT | os.O_RDWR, 0o600), 'a')
        fcntl.flock(self.owner_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.lock = asyncio.Lock()
        self.session = None
        self.record = {'active': False, 'available': False, 'mode': None, 'phase': 'unavailable',
                       'target_rpm': None, 'actual_rpm': None, 'fault': None,
                       'original_mode': None, 'reason': None, 'error': None, 'updated_at': time.time()}
        self.task = None
        self.closed = False
        self.last_probe = 0.0

    def _load(self):
        path = self.directory / 'state.json'
        if self.session and path.exists():
            value = json.loads(path.read_text())
            if value.get('session') == self.session:
                self.record = value
        return self.record

    def snapshot(self):
        value = dict(self._load())
        try:
            value.update(FanHardware().read(), updated_at=time.time())
            if value.get('active') and value.get('mode') == 'maximum' and value['target_rpm'] != 7300:
                value.update(mode=None, phase='restoring')
        except FanError as exc:
            value.update(available=False, mode=None, phase='unavailable', target_rpm=None,
                         actual_rpm=None, fault=None, reason=exc.reason, error=str(exc), updated_at=time.time())
        return {key: value.get(key) for key in ('available', 'mode', 'phase', 'target_rpm',
                'actual_rpm', 'fault', 'original_mode', 'reason', 'error', 'updated_at')}

    def _heartbeat(self):
        if self.session:
            atomic_json(self.directory / 'heartbeat.json',
                        {'session': self.session, 'deadline': time.monotonic() + LEASE_SECONDS})

    async def _probe(self):
        try:
            reading = FanHardware().read()
            output = await command('systemctl', 'show', 'jupiter-fan-control.service',
                                   '-p', 'ActiveState', '-p', 'SubState', '-p', 'Job')
            values = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
            automatic = not values.get('Job') and ((values.get('ActiveState'), values.get('SubState')) == ('active', 'running')
                        or ((values.get('ActiveState'), values.get('SubState')) == ('inactive', 'dead') and reading['target_rpm'] == 0))
            self.record = {'active': False, 'available': True, **reading, 'mode': 'automatic' if automatic else None,
                           'phase': 'error' if reading['fault'] else 'automatic' if automatic else 'conflict',
                           'original_mode': None, 'reason': 'fan_fault' if reading['fault'] else None if automatic else 'external_control',
                           'error': 'Fan hardware fault' if reading['fault'] else None if automatic else 'Fan control is owned elsewhere',
                           'updated_at': time.time()}
        except Exception as exc:
            self.record.update(available=False, mode=None, phase='unavailable',
                               target_rpm=None, actual_rpm=None, fault=None,
                               reason=getattr(exc, 'reason', 'monitor_failed'), error=str(exc), updated_at=time.time())
        self.last_probe = time.monotonic()

    async def start(self):
        path = self.directory / 'state.json'
        if path.exists():
            previous = json.loads(path.read_text())
            session = previous.get('session', '')
            if not re.fullmatch('[0-9a-f]{32}', session):
                raise FanError('recovery_failed', 'Invalid fan recovery session')
            self.session, self.record = session, previous
            await self._stop_owned()
            self.session = None
        await self._probe()
        self.task = asyncio.create_task(self._run())

    async def _run(self):
        while not self.closed:
            self._load()
            if self.record.get('active'):
                self._heartbeat()
            await asyncio.sleep(1)

    async def status(self):
        self._load()
        if not self.record.get('active') and not self.session and time.monotonic() - self.last_probe >= 2:
            async with self.lock:
                if not self.session:
                    await self._probe()
        return self.snapshot()

    async def _unit_state(self, unit):
        output = await command('systemctl', 'show', unit, '-p', 'LoadState', '-p', 'ActiveState', '-p', 'SubState', '-p', 'Job', check=False)
        values = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
        if 'ActiveState' not in values or 'LoadState' not in values:
            raise FanError('recovery_failed', 'Cannot confirm the previous fan worker has stopped')
        return values

    async def _stop_owned(self):
        if not self.session:
            return
        unit = f'power-timeline-fan-{self.session}.service'
        before = await self._unit_state(unit)
        if before['LoadState'] != 'not-found' and before['ActiveState'] not in ('inactive', 'failed'):
            await command('systemctl', 'stop', unit)
        after = await self._unit_state(unit)
        if after['ActiveState'] not in ('inactive', 'failed') or after.get('Job'):
            raise FanError('recovery_failed', 'The old fan worker is still running')
        self._load()
        if self.record.get('active'):
            # ExecStopPost may itself have failed. Retry only after its unit is stopped.
            worker = self.directory / 'worker.py'
            if not worker.is_file():
                raise FanError('recovery_failed', 'Independent fan recovery program is missing')
            await command('/usr/bin/python3', str(worker), 'cleanup', str(self.directory), self.session)
            self._load()
            if self.record.get('active'):
                raise FanError('recovery_failed', self.record.get('error') or 'Fan restoration remains incomplete')

    async def set_mode(self, mode):
        if mode not in ('automatic', 'maximum'):
            raise ValueError('Unknown fan mode')
        async with self.lock:
            if self.closed:
                raise RuntimeError('Fan control is stopping')
            self._load()
            if mode == 'automatic':
                await self._stop_owned()
                if self.session:
                    self._load()
                    if self.record.get('reason') != 'restore_degraded':
                        self.session = None
                        await self._probe()
                else:
                    await self._probe()
                return self.snapshot()
            if self.record.get('active') and self.record.get('mode') == 'maximum':
                return self.snapshot()  # Repeated maximum never replaces the captured original mode.
            await self._stop_owned()
            # Worker is self-contained and survives plugin deletion as well as backend death.
            source = Path(__file__).with_name('fan_worker.py').read_bytes()
            worker = self.directory / 'worker.py'
            worker.write_bytes(source)
            worker.chmod(0o600)
            self.session = uuid.uuid4().hex
            owner = Path('/proc/self/stat').read_text()
            self.record = {'session': self.session, 'owner_pid': os.getpid(),
                           'owner_start': owner[owner.rfind(')') + 2:].split()[19],
                           'active': False, 'available': True, 'mode': None, 'phase': 'starting',
                           'target_rpm': None, 'actual_rpm': None, 'fault': None,
                           'original_mode': None, 'reason': None, 'error': None, 'ready': False,
                           'updated_at': time.time()}
            atomic_json(self.directory / 'state.json', self.record)
            self._heartbeat()
            cleanup = ' '.join(systemd_argument(value) for value in
                               ('/usr/bin/python3', worker, 'cleanup', self.directory, self.session))
            unit = f'power-timeline-fan-{self.session}.service'
            try:
                await command('systemd-run', '--quiet', '--collect', f'--unit={unit}',
                              '--property=Type=exec', '--property=KillMode=control-group',
                              '--property=TimeoutStopSec=15', '--property=Restart=no',
                              '--property=Description=Power Timeline temporary maximum fan control',
                              f'--property=ExecStopPost={cleanup}',
                              '/usr/bin/python3', str(worker), 'worker', str(self.directory), self.session)
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    self._heartbeat()
                    self._load()
                    if self.record.get('ready') or self.record.get('error'):
                        return self.snapshot()
                    await asyncio.sleep(0.1)
                raise FanError('monitor_failed', 'Fan owner did not become ready')
            except BaseException:
                await self._stop_owned()
                raise

    async def close(self):
        self.closed = True
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.task
        try:
            async with self.lock:
                await self._stop_owned()
        finally:
            fcntl.flock(self.owner_lock, fcntl.LOCK_UN)
            self.owner_lock.close()
