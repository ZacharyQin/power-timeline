"""Fan ownership/recovery behavior; these fixtures are not hardware evidence."""
import json
import tempfile
import time
import unittest
from pathlib import Path

from py_modules.fan_worker import FAN_START_SECONDS, MAX_RPM, FanError, FanHardware, FanSession, atomic_json, run


class FixtureSystem:
    def __init__(self, hardware, automatic='os'):
        self.hardware = hardware
        self.active = automatic == 'os'
        self.invocation = 'original-os-owner' if self.active else ''
        self.job = 0
        self.handles = {}
        self.sleeping = False
        self.stop_failure = self.start_failure = False
        self.partial_stop = False

    async def service(self):
        return {'active': 'active' if self.active else 'inactive',
                'sub': 'running' if self.active else 'dead',
                'invocation': self.invocation, 'job': self.job}

    async def downloads(self):
        return self.handles

    async def set_service(self, active):
        if active and self.start_failure:
            raise RuntimeError('Official service failed to start')
        if not active and self.stop_failure:
            raise RuntimeError('Official service failed to stop')
        self.active = active
        self.invocation = 'restored-os-owner' if active else ''
        if not active and not self.partial_stop:
            self.hardware.write(0)


class FanOwnershipTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.hwmon = self.root / 'class/hwmon/hwmon7'
        self.hwmon.mkdir(parents=True)
        for name, value in {'name': 'steamdeck_hwmon', 'fan1_target': '3500',
                            'fan1_input': '3400', 'fan1_fault': '0'}.items():
            (self.hwmon / name).write_text(value)
        self.hardware = FanHardware(self.root)
        self.system = FixtureSystem(self.hardware)
        self.record = {'session': 'a' * 32, 'active': False, 'available': True,
                       'stage': 'prepared', 'mode': None, 'phase': 'starting'}
        self.core = FanSession(self.root, self.hardware, self.system, self.record)

    def tearDown(self):
        self.temporary.cleanup()

    def target(self):
        return self.hardware.read()['target_rpm']

    async def test_os_maximum_and_restore_return_to_original_automatic_owner(self):
        await self.core.activate()
        self.assertEqual((self.target(), self.system.active, self.record['mode']), (MAX_RPM, False, 'maximum'))
        await self.core.restore()
        self.assertEqual((self.target(), self.system.active, self.record['active'], self.record['mode']), (0, True, False, 'automatic'))
        # A second cleanup cannot undo a later external owner.
        self.hardware.write(MAX_RPM)
        await self.core.restore()
        self.assertEqual(self.target(), MAX_RPM)

    async def test_ec_automatic_does_not_start_the_os_service_on_restore(self):
        self.system.active = False
        self.system.invocation = ''
        self.hardware.write(0)
        await self.core.activate()
        self.assertEqual(self.record['original_mode'], 'ec')
        await self.core.restore()
        self.assertEqual((self.target(), self.system.active), (0, False))

    async def test_download_mode_refuses_takeover_without_changing_original_control(self):
        self.system.handles = {'steam-download': 1}
        with self.assertRaises(FanError) as caught:
            await self.core.activate()
        self.assertEqual(caught.exception.reason, 'download_mode')
        self.assertEqual((self.target(), self.system.active, self.record['active']), (3500, True, False))

    async def test_existing_manual_target_is_not_replaced(self):
        self.system.active = False
        (self.hwmon / 'fan1_target').write_text('2000')
        with self.assertRaises(FanError) as caught:
            await self.core.activate()
        self.assertEqual(caught.exception.reason, 'external_control')
        self.assertEqual((self.target(), self.record['active']), (2000, False))

    async def test_pending_service_job_cannot_be_treated_as_completed_stop(self):
        self.system.job = 42
        with self.assertRaises(FanError):
            await self.core.activate()
        self.assertEqual((self.target(), self.system.active), (3500, True))

    async def test_failed_stop_preserves_original_owner_and_never_writes_maximum(self):
        self.system.stop_failure = True
        with self.assertRaises(RuntimeError):
            await self.core.activate()
        await self.core.restore(reason='service_failed', error='stop failed')
        self.assertEqual((self.target(), self.system.active, self.record['phase']), (3500, True, 'error'))

    async def test_partial_stop_is_recovered_even_before_target_was_cleared(self):
        self.system.partial_stop = True
        with self.assertRaises(FanError):
            await self.core.activate()
        self.assertFalse(self.system.active)
        await self.core.restore(reason='service_failed', error='partial stop')
        self.assertEqual((self.target(), self.system.active, self.record['active']), (0, True, False))

    async def test_external_target_change_wins_over_cleanup(self):
        await self.core.activate()
        (self.hwmon / 'fan1_target').write_text('2000')
        self.assertFalse(await self.core.check())
        await self.core.restore()
        self.assertEqual((self.target(), self.system.active, self.record['phase']), (2000, False, 'conflict'))

    async def test_external_os_restart_wins_even_if_target_matches_maximum(self):
        await self.core.activate()
        self.system.active = True
        self.system.invocation = 'new-external-owner'
        self.assertFalse(await self.core.check())
        await self.core.restore()
        self.assertEqual((self.target(), self.system.invocation, self.record['mode']), (MAX_RPM, 'new-external-owner', None))

    async def test_new_download_owner_is_not_reset_to_old_os_mode(self):
        await self.core.activate()
        self.system.handles = {'new-download-owner': 2}
        self.assertFalse(await self.core.check())
        await self.core.restore()
        self.assertEqual((self.target(), self.system.active, self.record['reason']), (MAX_RPM, False, 'download_mode'))

    async def test_crash_between_sysfs_write_and_journal_commit_restores_original(self):
        await self.core.activate()
        self.record.update(stage='writing', mode=None)
        recovered = FanSession(self.root, self.hardware, self.system, dict(self.record))
        await recovered.restore(reason='owner_lost')
        self.assertEqual((self.target(), self.system.active, recovered.record['active']), (0, True, False))

    async def test_os_restore_failure_returns_to_ec_and_is_visible_as_degraded(self):
        await self.core.activate()
        self.system.start_failure = True
        await self.core.restore()
        self.assertEqual((self.target(), self.system.active, self.record['phase'], self.record['reason']),
                         (0, False, 'error', 'restore_degraded'))
        self.assertIn('EC automatic control restored', self.record['error'])

    async def test_hardware_fault_prevents_takeover_and_stall_stops_owned_maximum(self):
        (self.hwmon / 'fan1_fault').write_text('1')
        with self.assertRaises(FanError) as caught:
            await self.core.activate()
        self.assertEqual(caught.exception.reason, 'fan_fault')
        self.assertEqual((self.target(), self.system.active), (3500, True))
        (self.hwmon / 'fan1_fault').write_text('0')
        await self.core.activate()
        (self.hwmon / 'fan1_input').write_text('0')
        self.core.running_since = time.monotonic() - FAN_START_SECONDS - 1
        with self.assertRaises(FanError) as stalled:
            await self.core.check()
        self.assertEqual(stalled.exception.reason, 'fan_stalled')
        await self.core.restore(reason='fan_stalled', error=str(stalled.exception))
        self.assertEqual((self.target(), self.system.active, self.record['phase']), (0, True, 'error'))

    async def test_sleep_preparation_blocks_new_takeover_and_restores_existing_maximum(self):
        self.system.sleeping = True
        with self.assertRaises(FanError) as caught:
            await self.core.activate()
        self.assertEqual(caught.exception.reason, 'sleeping')
        self.assertEqual((self.target(), self.system.active), (3500, True))
        self.system.sleeping = False
        await self.core.activate()
        self.system.sleeping = True
        await self.core.restore(reason='sleeping')
        self.assertEqual((self.target(), self.system.active, self.record['mode']), (0, True, 'automatic'))

    async def test_stale_cleanup_session_cannot_release_new_owner(self):
        await self.core.activate()
        atomic_json(self.root / 'state.json', self.record)
        await run(self.root, 'b' * 32, cleanup=True)
        self.assertEqual((self.target(), json.loads((self.root / 'state.json').read_text())['active']), (MAX_RPM, True))

    def test_missing_or_ambiguous_hwmon_is_not_replaced_with_fabricated_readings(self):
        duplicate = self.root / 'class/hwmon/hwmon8'
        duplicate.mkdir()
        (duplicate / 'name').write_text('steamdeck_hwmon')
        with self.assertRaises(FanError):
            FanHardware(self.root)
        (duplicate / 'name').unlink()
        (self.hwmon / 'fan1_input').write_text('unknown')
        with self.assertRaises(FanError):
            self.hardware.read()
