"""Standalone, systemd-supervised fan owner and idempotent crash recovery.

Copied to /run before takeover so package replacement/removal cannot remove the
ExecStopPost recovery program. Only the worker imports the system DBus library.
"""
import asyncio
import json
import os
import signal
import stat
import sys
import time
from pathlib import Path

MAX_RPM = 7300
LEASE_SECONDS = 10
FAN_START_SECONDS = 15
FAN_SERVICE = 'jupiter-fan-control.service'
MANAGER = 'com.steampowered.SteamOSManager1'
MANAGER_PATH = '/com/steampowered/SteamOSManager1'


class FanError(RuntimeError):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def atomic_json(path, value):
    temporary = path.with_suffix('.new')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def system_environment():
    environment = os.environ.copy()
    original = environment.pop('LD_LIBRARY_PATH_ORIG', None)
    if original is None:
        environment.pop('LD_LIBRARY_PATH', None)
    else:
        environment['LD_LIBRARY_PATH'] = original
    environment.pop('PYTHONHOME', None)
    environment.pop('PYTHONPATH', None)
    return environment


async def command(*arguments, timeout=12, check=True):
    process = await asyncio.create_subprocess_exec(
        *arguments, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, env=system_environment())
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except (asyncio.CancelledError, asyncio.TimeoutError):
        if process.returncode is None:
            process.kill()
        await process.communicate()
        raise
    if process.returncode and check:
        raise FanError('service_failed', stderr.decode(errors='replace').strip()[:512]
                       or f'{arguments[0]} failed ({process.returncode})')
    return stdout.decode()


class FanHardware:
    def __init__(self, sys_root=Path('/sys')):
        matches = []
        for candidate in (Path(sys_root) / 'class/hwmon').glob('hwmon*'):
            try:
                if (candidate / 'name').read_text().strip() == 'steamdeck_hwmon':
                    matches.append(candidate.resolve())
            except OSError:
                continue
        if len(matches) != 1:
            raise FanError('hardware_missing', 'Steam Deck fan interface is missing or ambiguous')
        self.path = matches[0]
        self.read()

    def read(self):
        try:
            target = int((self.path / 'fan1_target').read_text())
            actual = int((self.path / 'fan1_input').read_text())
            fault = int((self.path / 'fan1_fault').read_text())
            if not 0 <= target <= MAX_RPM or actual < 0 or fault not in (0, 1):
                raise ValueError('Invalid fan readings')
            return {'target_rpm': target, 'actual_rpm': actual, 'fault': bool(fault)}
        except (OSError, ValueError) as exc:
            raise FanError('hardware_missing', f'Fan readings unavailable: {exc}') from exc

    def write(self, target):
        if type(target) is not int or target not in (0, MAX_RPM):
            raise ValueError('Only automatic and maximum fan targets are supported')
        (self.path / 'fan1_target').write_text(f'{target}\n')
        if self.read()['target_rpm'] != target:
            raise FanError('hardware_failed', 'Fan target did not read back')


class FanSystem:
    def __init__(self):
        self.bus = self.user_bus = None
        self.inhibitor = None
        self.sleeping = False
        self.stop = asyncio.Event()

    async def call(self, bus, destination, path, interface, member, signature='', body=None):
        from dbus_next import Message, MessageType
        reply = await asyncio.wait_for(bus.call(Message(
            destination=destination, path=path, interface=interface,
            member=member, signature=signature, body=body or [])), 2)
        if reply is None or reply.message_type == MessageType.ERROR:
            raise FanError('monitor_failed', f'{interface}.{member}: {reply.body if reply else "no reply"}')
        return reply

    async def connect(self, monitor=False):
        from dbus_next import BusType
        from dbus_next.aio import MessageBus
        self.bus = await asyncio.wait_for(MessageBus(bus_type=BusType.SYSTEM, negotiate_unix_fd=True).connect(), 3)
        # Discover the SteamOS user bus rather than assuming controller/user UID 1000.
        for socket in Path('/run/user').glob('*/bus'):
            if not stat.S_ISSOCK(socket.stat().st_mode):
                continue
            candidate = None
            try:
                identity = os.getresuid()
                try:
                    # EXTERNAL uses getuid(), and the user broker checks socket credentials.
                    # This is the isolated worker, never Decky's shared Python process.
                    uid = socket.stat().st_uid
                    if identity[0] != uid:
                        os.setresuid(uid, uid, identity[2])
                    candidate = MessageBus(bus_address=f'unix:path={socket}')
                    await asyncio.wait_for(candidate.connect(), 2)
                finally:
                    if os.getresuid() != identity:
                        os.setresuid(*identity)
                owner = await self.call(candidate, 'org.freedesktop.DBus', '/org/freedesktop/DBus',
                                        'org.freedesktop.DBus', 'NameHasOwner', 's', [MANAGER])
                if owner.body == [True]:
                    if self.user_bus is not None:
                        raise FanError('monitor_failed', 'Multiple SteamOS user buses are active')
                    self.user_bus, candidate = candidate, None
            finally:
                if candidate is not None:
                    candidate.disconnect()
        if self.user_bus is None:
            raise FanError('monitor_failed', 'SteamOS download-mode monitor is unavailable')
        unit = await self.call(self.bus, 'org.freedesktop.systemd1', '/org/freedesktop/systemd1',
                               'org.freedesktop.systemd1.Manager', 'GetUnit', 's', [FAN_SERVICE])
        self.unit_path = unit.body[0]
        if monitor:
            self.bus.add_message_handler(self._signal)
            await self.call(self.bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                            'AddMatch', 's', ["type='signal',sender='org.freedesktop.login1',path='/org/freedesktop/login1',interface='org.freedesktop.login1.Manager',member='PrepareForSleep'"])
            reply = await self.call(self.bus, 'org.freedesktop.login1', '/org/freedesktop/login1',
                                    'org.freedesktop.login1.Manager', 'Inhibit', 'ssss',
                                    ['sleep', 'Power Timeline fan control', 'Restore automatic fan control before sleep', 'delay'])
            if reply.signature != 'h' or len(reply.body) != 1 or not reply.unix_fds:
                raise FanError('monitor_failed', 'Sleep delay inhibitor was not acquired')
            self.inhibitor = reply.unix_fds[reply.body[0]]
        reply = await self.call(self.bus, 'org.freedesktop.login1', '/org/freedesktop/login1',
                                'org.freedesktop.DBus.Properties', 'Get', 'ss',
                                ['org.freedesktop.login1.Manager', 'PreparingForSleep'])
        self.sleeping = bool(reply.body[0].value)

    def _signal(self, message):
        from dbus_next import MessageType
        if (message.message_type == MessageType.SIGNAL and message.path == '/org/freedesktop/login1'
                and message.interface == 'org.freedesktop.login1.Manager'
                and message.member == 'PrepareForSleep' and message.body == [True]):
            self.sleeping = True
            self.stop.set()

    async def service(self):
        reply = await self.call(self.bus, 'org.freedesktop.systemd1', self.unit_path,
                                'org.freedesktop.DBus.Properties', 'GetAll', 's', ['org.freedesktop.systemd1.Unit'])
        values = reply.body[0]
        return {'active': values['ActiveState'].value, 'sub': values['SubState'].value,
                'job': values['Job'].value[0],
                'invocation': bytes(values['InvocationID'].value).hex()}

    async def downloads(self):
        reply = await self.call(self.user_bus, MANAGER, MANAGER_PATH,
                                MANAGER + '.LowPowerMode1', 'ListDownloadModeHandles')
        return reply.body[0]

    async def set_service(self, active):
        # systemctl waits for the complete job, including the official ExecStopPost.
        await command('systemctl', 'start' if active else 'stop', FAN_SERVICE)
        current = await self.service()
        expected = ('active', 'running') if active else ('inactive', 'dead')
        if current['job'] or (current['active'], current['sub']) != expected:
            raise FanError('service_failed', 'Official fan service did not reach the requested state')

    def close(self):
        if self.inhibitor is not None:
            os.close(self.inhibitor)
            self.inhibitor = None
        for bus in (self.user_bus, self.bus):
            if bus is not None:
                bus.disconnect()


class FanSession:
    def __init__(self, directory, hardware, system, record):
        self.directory, self.hardware, self.system = Path(directory), hardware, system
        self.record = record
        self.running_since = None

    def save(self, **changes):
        self.record.update(changes)
        self.record.update(self.hardware.read(), updated_at=time.time())
        atomic_json(self.directory / 'state.json', self.record)

    async def activate(self):
        reading = self.hardware.read()
        service = await self.system.service()
        if self.system.sleeping:
            raise FanError('sleeping', 'Sleep is being prepared; maximum fan control was not started')
        if await self.system.downloads():
            raise FanError('download_mode', 'Low-power download mode owns fan control')
        if reading['fault']:
            raise FanError('fan_fault', 'The fan reports a hardware fault')
        if service['job'] or (service['active'], service['sub']) not in (('active', 'running'), ('inactive', 'dead')):
            raise FanError('external_control', 'The official fan service is changing state')
        original = 'os' if service['active'] == 'active' else 'ec'
        if original == 'ec' and reading['target_rpm'] != 0:
            raise FanError('external_control', 'A manual fan target already exists')
        self.save(active=True, original_mode=original, original_invocation=service['invocation'],
                  initial_target=reading['target_rpm'], stage='stopping', phase='starting', mode=None)
        if original == 'os':
            await self.system.set_service(False)
        service = await self.system.service()
        if (service['active'], service['sub']) != ('inactive', 'dead') or service['job'] or await self.system.downloads():
            raise FanError('external_control', 'Fan ownership changed while stopping the official service')
        if self.hardware.read()['target_rpm'] != 0:
            raise FanError('external_control', 'The official service did not return fan control to the EC')
        if self.system.sleeping:
            raise FanError('sleeping', 'Sleep began before fan takeover')
        self.save(stage='writing')
        self.hardware.write(MAX_RPM)
        self.running_since = time.monotonic()
        self.save(stage='maximum', phase='maximum', mode='maximum', reason=None, error=None, ready=True)

    async def check(self):
        service = await self.system.service()
        downloads = await self.system.downloads()
        reading = self.hardware.read()
        if downloads or service['active'] != 'inactive' or service['job'] or reading['target_rpm'] != MAX_RPM:
            # An external owner wins. Never undo its target or restart the old service.
            self.save(active=False, mode=None, phase='conflict', stage='released',
                      reason='download_mode' if downloads else 'external_control',
                      error='Fan ownership changed outside Power Timeline')
            return False
        if reading['fault']:
            raise FanError('fan_fault', 'The fan reports a hardware fault')
        if reading['actual_rpm'] == 0 and time.monotonic() - self.running_since >= FAN_START_SECONDS:
            raise FanError('fan_stalled', 'Fan speed is still zero after requesting maximum for 15 seconds')
        self.save()
        return True

    async def restore(self, reason=None, error=None):
        if not self.record.get('active'):
            return
        service = await self.system.service()
        downloads = await self.system.downloads()
        target = self.hardware.read()['target_rpm']
        if self.record['stage'] == 'stopping' and service['active'] == 'active' and service['invocation'] == self.record['original_invocation']:
            # Stop failed before any hardware takeover; the original OS owner remains.
            self.save(active=False, mode='automatic', phase='error' if error else 'automatic',
                      stage='released', reason=reason, error=error)
            return
        allowed = ((0, MAX_RPM, self.record['initial_target']) if self.record['stage'] == 'stopping'
                   else (0, MAX_RPM) if self.record['stage'] in ('writing', 'restoring') else (MAX_RPM,))
        if downloads or service['active'] != 'inactive' or service['job'] or target not in allowed:
            self.save(active=False, mode=None, phase='conflict', stage='released',
                      reason='download_mode' if downloads else 'external_control',
                      error='External fan control was left unchanged')
            return
        self.save(stage='restoring', phase='restoring', mode=None)
        # Returning to the EC comes first, even if restoring the OS service fails.
        self.hardware.write(0)
        if self.record['original_mode'] == 'os':
            try:
                await self.system.set_service(True)
            except Exception as exc:
                self.save(active=False, stage='released', mode='automatic', phase='error',
                          reason='restore_degraded', error=f'EC automatic control restored; OS service restoration failed: {exc}')
                return
        self.save(active=False, stage='released', mode='automatic', phase='error' if error else 'automatic',
                  reason=reason, error=error)


def owner_alive(record):
    try:
        value = (Path('/proc') / str(record['owner_pid']) / 'stat').read_text()
        identity = value[value.rfind(')') + 2:].split()[19]
        return identity == record['owner_start']
    except (OSError, IndexError):
        return False


async def run(directory, session, cleanup=False):
    directory = Path(directory)
    record = json.loads((directory / 'state.json').read_text())
    if record.get('session') != session or (cleanup and not record.get('active')):
        return
    system = FanSystem()
    core = None
    try:
        hardware = FanHardware()
        core = FanSession(directory, hardware, system, record)
        await system.connect(monitor=not cleanup)
        if cleanup:
            await core.restore(reason='owner_lost')
            return
        loop = asyncio.get_running_loop()
        for number in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(number, system.stop.set)
        await core.activate()
        while not system.stop.is_set():
            try:
                heartbeat = json.loads((directory / 'heartbeat.json').read_text())
                fresh = heartbeat.get('session') == session and time.monotonic() < heartbeat.get('deadline', 0)
            except (OSError, ValueError):
                fresh = False
            if not fresh or not owner_alive(record):
                await core.restore(reason='owner_lost')
                break
            if not await core.check():
                break
            try:
                await asyncio.wait_for(system.stop.wait(), 1)
            except asyncio.TimeoutError:
                pass
        await core.restore(reason='sleeping' if system.sleeping else None)
    except Exception as exc:
        reason = getattr(exc, 'reason', 'monitor_failed')
        if core is not None and record.get('active'):
            try:
                await core.restore(reason=reason, error=str(exc))
            except Exception as recovery:
                record.update(phase='error', mode=None, reason='recovery_failed',
                              error=f'{exc}; recovery failed: {recovery}', updated_at=time.time())
                atomic_json(directory / 'state.json', record)
                raise
        else:
            record.update(active=False, mode=None, phase='conflict' if reason in ('external_control', 'download_mode') else 'error',
                          reason=reason, error=str(exc), updated_at=time.time())
            atomic_json(directory / 'state.json', record)
    finally:
        system.close()


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[1] not in ('worker', 'cleanup'):
        raise SystemExit('Internal Power Timeline fan worker only')
    asyncio.run(run(sys.argv[2], sys.argv[3], cleanup=sys.argv[1] == 'cleanup'))
