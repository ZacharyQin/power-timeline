"""Behavioral Sailing Mode tests; fixtures are not physical battery evidence."""
import asyncio
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from py_modules.sailing import NATIVE_LEASE_SECONDS, RESPONSE_SECONDS, SailingController, atomic_json, restore_owned


class FixtureTelemetry:
    def __init__(self, root):
        self.sys_root = root
        self.now = 100.0
        self.sleep = 0.0
        self.percent = 75
        self.supply = 'external'
        self.state = 'Not charging'
        self.current = 0.0

    def read_battery(self, include_details=False):
        return {'monotonic': self.now, 'boottime': self.now + self.sleep,
                'battery_percent': self.percent, 'supply': self.supply,
                'battery_state': self.state, 'current_a': self.current}


class SailingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        hwmon = self.root / 'sys/class/hwmon/hwmon3'
        hwmon.mkdir(parents=True)
        (hwmon / 'name').write_text('steamdeck_hwmon')
        self.cap = hwmon / 'max_battery_charge_level'
        self.cap.write_text('80')
        self.telemetry = FixtureTelemetry(self.root / 'sys')
        self.events = []
        async def emit(state):
            self.events.append(state)
        self.emit = emit
        self.controller = SailingController(self.root / 'state', self.telemetry, emit, lambda: self.telemetry.now)
        await self.controller.update_native(True, 80)

    async def asyncTearDown(self):
        await self.controller.close()
        self.temporary.cleanup()

    def limit(self):
        return int(self.cap.read_text())

    async def tick(self):
        self.telemetry.now += 1
        await self.controller.update_native(True, 80)
        await self.controller._tick()

    async def test_complete_hysteresis_preserves_direction_inside_interval(self):
        await self.controller.set_mode(True, 10)
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('waiting', 70))
        self.telemetry.percent = 71
        await self.tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('waiting', 70))
        self.telemetry.percent = 70
        await self.tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('charging', 80))
        self.telemetry.state, self.telemetry.current = 'Charging', 2.0
        for percent in (71, 75, 79):
            self.telemetry.percent = percent
            await self.tick()
            self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('charging', 80))
        self.telemetry.percent = 80
        await self.tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('waiting', 70))
        self.telemetry.state, self.telemetry.current, self.telemetry.percent = 'Not charging', 0, 75
        await self.tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('waiting', 70))

    async def test_enabling_at_or_below_lower_starts_but_inside_waits(self):
        for percent, expected in ((69, 'charging'), (70, 'charging'), (71, 'waiting'), (80, 'waiting')):
            with self.subTest(percent=percent):
                await self.controller.set_mode(False, 10)
                self.telemetry.percent = percent
                result = await self.controller.set_mode(True, 10)
                self.assertEqual(result['phase'], expected)
                self.assertEqual(self.limit(), 80 if expected == 'charging' else 70)

    async def test_reconnect_inside_interval_does_not_resume_interrupted_charge(self):
        self.telemetry.percent = 70
        await self.controller.set_mode(True, 10)
        self.telemetry.state, self.telemetry.current, self.telemetry.percent = 'Charging', 2.0, 75
        await self.tick()
        self.telemetry.supply, self.telemetry.state = 'battery', 'Discharging'
        await self.tick()
        self.telemetry.supply, self.telemetry.state, self.telemetry.current = 'external', 'Not charging', 0
        await self.tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('waiting', 70))

    async def test_disable_restores_captured_limit_and_guard_exits(self):
        await self.controller.set_mode(True, 10)
        guard = self.controller.guard
        result = await self.controller.set_mode(False, 10)
        self.assertEqual((result['enabled'], result['phase'], self.limit()), (False, 'disabled', 80))
        self.assertEqual(guard.returncode, 0)
        self.assertFalse(json.loads((self.root / 'state/recovery.json').read_text())['active'])

    async def test_native_user_change_wins_even_when_equal_to_owned_limit(self):
        await self.controller.set_mode(True, 10)
        await self.controller.update_native(True, 70)
        self.assertFalse(self.controller.snapshot()['enabled'])
        self.assertEqual(self.limit(), 70)
        self.assertIn('Steam charge settings changed', self.controller.snapshot()['error'])

    async def test_external_hardware_writer_is_not_overwritten_on_failure(self):
        await self.controller.set_mode(True, 10)
        self.cap.write_text('85')
        with self.assertRaisesRegex(RuntimeError, 'outside Sailing Mode') as caught:
            await self.controller._tick()
        await self.controller._fail(caught.exception)
        self.assertEqual(self.limit(), 85)
        self.assertFalse(self.controller.snapshot()['enabled'])

    async def test_native_lease_loss_restores_and_fresh_report_resumes(self):
        await self.controller.set_mode(True, 10)
        self.telemetry.now += NATIVE_LEASE_SECONDS
        await self.controller._tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('paused', 80))
        await self.controller.update_native(True, 80)
        await self.controller._tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('waiting', 70))

    async def test_wake_requires_new_native_observation_before_takeover(self):
        await self.controller.set_mode(True, 10)
        self.telemetry.sleep += 300
        await self.controller._tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('paused', 80))
        await self.controller.update_native(True, 80)
        await self.controller._tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('waiting', 70))

    async def test_charging_intent_survives_reload_without_topping_up_waiting_state(self):
        self.telemetry.percent = 70
        await self.controller.set_mode(True, 10)
        self.telemetry.percent, self.telemetry.state, self.telemetry.current = 75, 'Charging', 1.0
        await self.tick()
        await self.controller.close()
        self.assertEqual(self.limit(), 80)
        self.controller = SailingController(self.root / 'state', self.telemetry, self.emit, lambda: self.telemetry.now)
        await self.controller.update_native(True, 80)
        await self.controller._tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('charging', 80))

    async def test_no_hardware_response_is_failure_not_silent_charging_success(self):
        self.telemetry.percent = 70
        await self.controller.set_mode(True, 10)
        self.telemetry.now += RESPONSE_SECONDS + 1
        await self.controller.update_native(True, 80)
        with self.assertRaisesRegex(RuntimeError, 'within 60 seconds') as caught:
            await self.controller._tick()
        await self.controller._fail(caught.exception)
        self.assertFalse(self.controller.snapshot()['enabled'])
        self.assertEqual(self.limit(), 80)

    async def test_disabled_or_stale_native_setting_cannot_take_control(self):
        await self.controller.update_native(False, 80)
        with self.assertRaisesRegex(RuntimeError, 'Steam charge limiting'):
            await self.controller.set_mode(True, 10)
        await self.controller.update_native(True, 80)
        self.telemetry.now += NATIVE_LEASE_SECONDS
        with self.assertRaisesRegex(RuntimeError, 'current native settings'):
            await self.controller.set_mode(True, 10)
        self.assertEqual(self.limit(), 80)
        self.assertIsNone(self.controller.guard)

    async def test_invalid_range_leaves_existing_control_unchanged(self):
        await self.controller.set_mode(True, 10)
        with self.assertRaisesRegex(ValueError, 'at least 20'):
            await self.controller.set_mode(True, 61)
        self.assertEqual((self.controller.snapshot()['lower_percent'], self.limit()), (70, 70))

    async def test_delta_tracks_native_upper_and_persists_across_restart(self):
        await self.controller.set_mode(False, 5)
        self.telemetry.percent = 80
        self.cap.write_text('90')
        await self.controller.update_native(True, 90)
        result = await self.controller.set_mode(True, 5)
        self.assertEqual((result['delta_percent'], result['lower_percent'], self.limit()), (5, 85, 90))
        self.telemetry.state, self.telemetry.current = 'Charging', 1.0
        self.telemetry.percent = 90
        await self.controller._tick()
        self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('waiting', 85))
        await self.controller.close()
        self.controller = SailingController(self.root / 'state', self.telemetry, self.emit, lambda: self.telemetry.now)
        await self.controller.update_native(True, 90)
        await self.controller._tick()
        self.assertEqual((self.controller.snapshot()['delta_percent'], self.limit()), (5, 85))
        await self.controller.set_mode(False, 5)
        await self.controller.update_native(True, 80)
        self.assertEqual(self.controller.snapshot()['lower_percent'], 75)

    async def test_legacy_lower_migrates_without_changing_interval(self):
        for upper in (80, None):
            with self.subTest(saved_upper=upper):
                await self.controller.close()
                atomic_json(self.root / 'state/settings.json', {
                    'enabled': upper is not None, 'lower': 73, 'upper': upper, 'phase': 'waiting'})
                self.controller = SailingController(self.root / 'state', self.telemetry, self.emit, lambda: self.telemetry.now)
                await self.controller.update_native(True, 80)
                result = self.controller.snapshot()
                self.assertEqual((result['delta_percent'], result['lower_percent']), (7, 73))
                await self.controller.set_mode(True, result['delta_percent'])
                self.assertEqual((self.controller.snapshot()['phase'], self.limit()), ('waiting', 73))
                saved = json.loads((self.root / 'state/settings.json').read_text())
                self.assertNotIn('lower', saved)
                self.assertEqual(saved['delta'], 7)

    async def test_invalid_delta_does_not_release_existing_control(self):
        await self.controller.set_mode(True, 10)
        for delta in (0, 81, True, 5.5):
            with self.subTest(delta=delta):
                with self.assertRaisesRegex(ValueError, 'Delta'):
                    await self.controller.set_mode(True, delta)
                self.assertEqual((self.controller.snapshot()['delta_percent'], self.limit()), (10, 70))

    async def test_restart_waits_for_fresh_native_before_restoring_orphan(self):
        self.cap.write_text('70')
        self.controller.config.update(enabled=True, upper=80, phase='waiting')
        self.controller._save()
        self.controller.native = None
        self.controller.native_seen = None
        atomic_json(self.root / 'state/recovery.json', {
            'session': 'previous-owner', 'active': True, 'hardware': str(self.cap),
            'original': 80, 'owned': 70, 'pending': None, 'native_changed': False})
        await self.controller.start()
        await asyncio.sleep(0)
        self.assertEqual(self.limit(), 70)
        await self.controller.update_native(True, 70)
        self.assertEqual(self.limit(), 70)
        self.assertFalse(self.controller.snapshot()['enabled'])
        record = json.loads((self.root / 'state/recovery.json').read_text())
        self.assertEqual((record['active'], record['native_changed']), (False, True))


class GuardTests(unittest.TestCase):
    def test_independent_process_restores_after_owner_disappears(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            hardware = directory / 'limit'
            hardware.write_text('70')
            atomic_json(directory / 'recovery.json', {'session': 'test-owner', 'active': True,
                        'hardware': str(hardware), 'original': 80, 'owned': 70,
                        'pending': None, 'native_changed': False})
            subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'py_modules/sailing.py'),
                            'guard', folder, 'test-owner', '2147483647'], check=True, timeout=5,
                           capture_output=True)
            self.assertEqual(int(hardware.read_text()), 80)
            recovery = json.loads((directory / 'recovery.json').read_text())
            self.assertEqual((recovery['active'], recovery['result']), (False, 'restored'))

    def test_stale_guard_cannot_restore_over_new_owner(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            hardware = directory / 'limit'
            hardware.write_text('72')
            record = {'session': 'new-owner', 'active': True, 'hardware': str(hardware),
                      'original': 90, 'owned': 72, 'pending': None, 'native_changed': False}
            atomic_json(directory / 'recovery.json', record)
            self.assertEqual(restore_owned(directory, 'old-owner'), 'released')
            self.assertEqual(int(hardware.read_text()), 72)
            self.assertEqual(json.loads((directory / 'recovery.json').read_text()), record)
