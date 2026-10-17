import struct
import tempfile
import unittest
from pathlib import Path

from py_modules.power_flow import ECInput, power_flow, read_ec_window
from py_modules.telemetry import _gpu_details, decode_gpu_metrics


def sample(state="Charging", supply="external", battery=8.862129, apu=4.986):
    return dict(timestamp=100, supply=supply, battery_state=state, battery_w=battery,
                system_w=battery if supply == "battery" and state == "Discharging" else None,
                apu_w=apu, errors={}, voltage_v=8.871, current_a=.999)


def ec(vbus=15125, ibus=1325):
    return dict(vbus_mv=vbus, ibus_ma=ibus, pd_voltage=300, pd_current=300)


class PowerFlowTests(unittest.TestCase):
    def test_charging_uses_actual_input_not_pd_limit(self):
        result = power_flow(sample(), ec())
        self.assertAlmostEqual(result["input_w"], 20.040625)
        self.assertAlmostEqual(result["peripheral_w"], 6.192496)
        self.assertEqual(result["battery_net_w"], 8.862129)
        self.assertEqual((result["pd_voltage_v"], result["pd_current_a"]), (15, 3))

    def test_battery_discharge_does_not_need_ec(self):
        result = power_flow(sample("Discharging", "battery", 6, 3), None, "ec_unsupported_device", False)
        self.assertEqual((result["input_w"], result["battery_net_w"], result["peripheral_w"]), (6, -6, 3))
        self.assertNotIn("input_w", result["errors"])

    def test_full_and_zero_remain_real_zero(self):
        result = power_flow(sample("Full", battery=0, apu=0), ec(15000, 0))
        self.assertEqual((result["input_w"], result["battery_net_w"], result["peripheral_w"]), (0, 0, 0))
        uncertain = power_flow(sample("Not charging", battery=1), ec())
        self.assertIsNone(uncertain["battery_net_w"])
        self.assertIsNone(uncertain["peripheral_w"])

    def test_external_battery_assist_uses_signed_net_power(self):
        result = power_flow(sample("Discharging", battery=6, apu=8), ec(10000, 500))
        self.assertEqual(result["battery_net_w"], -6)
        self.assertEqual(result["peripheral_w"], 3)

    def test_negative_or_misaligned_difference_is_not_fabricated(self):
        result = power_flow(sample(battery=2, apu=3), ec(10000, 400))
        self.assertEqual(result["difference_w"], -1)
        self.assertIsNone(result["peripheral_w"])
        self.assertEqual(result["errors"]["peripheral_w"], "negative_power_difference")
        changed = power_flow(sample(), ec(), battery_aligned=False)
        self.assertIsNone(changed["peripheral_w"])
        self.assertAlmostEqual(changed["input_w"], 20.040625)
        self.assertEqual(changed["errors"]["peripheral_w"], "battery_window_changed")

    def test_missing_input_cannot_be_replaced_by_pd_or_old_values(self):
        result = power_flow(sample(), None, "ec_permission_required")
        self.assertIsNone(result["input_w"])
        self.assertIsNone(result["peripheral_w"])
        self.assertEqual(result["apu_w"], 4.986)
        self.assertEqual(result["errors"]["input_w"], "ec_permission_required")
        invalid = power_flow(sample(), ec(0, 1000))
        self.assertIsNone(invalid["input_w"])

    def test_gpu_detail_units_and_invalid_slots(self):
        raw = bytearray(168)
        struct.pack_into("<HBB", raw, 0, 168, 2, 4)
        struct.pack_into("<4H", raw, 40, 6000, 1600, 900, 1100)
        struct.pack_into("<4H", raw, 48, 958, 0, 0xFFFF, 305)
        struct.pack_into("<6H", raw, 152, 755, 0xFFFF, 673, 2218, 0, 1722)
        result = _gpu_details(raw, decode_gpu_metrics(raw))
        self.assertEqual(result["cores_w"], [.958, 0, None, .305])
        self.assertEqual(result["rails"]["cpu"], {"w": 1.6, "voltage_v": .755, "current_a": 2.218})
        self.assertIsNone(result["rails"]["soc"]["voltage_v"])
        self.assertEqual(result["rails"]["soc"]["current_a"], 0)

    def test_ec_firmware_gate_and_raw_unit_contract(self):
        raw = bytearray(4096)
        struct.pack_into("<H", raw, 0xC4C, 4352)
        struct.pack_into("<HH", raw, 0x1E8, 15125, 1325)
        result = power_flow(sample(), read_ec_window(raw))
        self.assertAlmostEqual(result["input_w"], 20.040625)
        struct.pack_into("<H", raw, 0xC4C, 1)
        with self.assertRaisesRegex(ValueError, "firmware_mismatch"):
            read_ec_window(raw)

    def test_unknown_device_is_reported_as_unsupported(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            dmi = root / "class/dmi/id"
            driver = root / "devices/pci0000:00/0000:00:14.3/PNP0C09:00/VLV0100:00"
            dmi.mkdir(parents=True)
            driver.mkdir(parents=True)
            for path, text in ((dmi / "board_name", "Jupiter"), (dmi / "bios_version", "other"),
                               (driver / "board_id", "5"), (driver / "firmware_version", "4352")):
                path.write_text(text)
            reader = ECInput(root)
            self.assertEqual(reader.read(), (None, "ec_unsupported_device"))


if __name__ == "__main__":
    unittest.main()
