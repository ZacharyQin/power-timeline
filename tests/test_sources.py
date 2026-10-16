import copy
import struct
import unittest

from py_modules.attribution import Attribution
from py_modules.games import parse_fdinfo, parse_stat
from py_modules.telemetry import decode_gpu_metrics


class SourceAndEstimateTests(unittest.TestCase):
    def test_gpu_metrics_units_and_invalid_marker(self):
        data = bytearray(168)
        struct.pack_into("<HBB", data, 0, 168, 2, 4)
        struct.pack_into("<4H", data, 40, 12000, 3100, 0xFFFF, 7000)
        self.assertEqual(decode_gpu_metrics(data), {
            "apu_w": 12, "cpu_w": 3.1, "soc_w": None, "gpu_w": 7})
        data[3] = 5
        with self.assertRaises(ValueError):
            decode_gpu_metrics(data)
        with self.assertRaises(ValueError):
            decode_gpu_metrics(bytes(data[:40]))

    def test_stat_comm_parentheses_do_not_shift_process_identity(self):
        fields = ["S"] + ["0"] * 21
        fields[11], fields[12], fields[19] = "50", "20", "12345"
        self.assertEqual(parse_stat("42 (game (worker)) " + " ".join(fields)), (12345, 70))

    def test_amdgpu_idle_engine_omission_is_zero_but_other_driver_is_unknown(self):
        text = "drm-driver: amdgpu\ndrm-client-id: 7\ndrm-pdev: 0000:04:00.0\n"
        self.assertEqual(parse_fdinfo(text), (("0000:04:00.0", "7"), {"gfx": 0, "compute": 0}))
        self.assertIsNone(parse_fdinfo(text.replace("amdgpu", "other")))
        self.assertIsNone(parse_fdinfo(text + "drm-engine-gfx: 20 us\n"))

    def games(self, total=1000, ticks=100, gfx=1000000000, compute=500000000):
        return [{"game_id": "1", "processes": [{"pid": 1, "start_ticks": 10, "cpu_ticks": ticks}],
                 "cpu_total_ticks": total, "gpu_complete": True,
                 "gpu_clients": {"card/client": {"gfx": gfx, "compute": compute}}}]

    def test_cpu_idle_fraction_and_gpu_overlapping_engine_deltas(self):
        previous = {"monotonic": 1, "cpu_w": 8, "gpu_w": 10}
        current = {"monotonic": 2, "cpu_w": 8, "gpu_w": 10}
        before = self.games()
        after = self.games(total=1800, ticks=200, gfx=1100000000, compute=700000000)
        result = Attribution().between(previous, current, before, after)["1"]
        self.assertAlmostEqual(result["cpu_wh"], 8 / 3600 * 100 / 800)
        self.assertAlmostEqual(result["gpu_wh"], 10 / 3600 * .2)

    def test_missing_host_counter_invalidates_both_sides_of_interval(self):
        previous = {"monotonic": 1, "cpu_w": 8, "gpu_w": 10}
        current = {"monotonic": 2, "cpu_w": 8, "gpu_w": 10}
        for before_total, after_total in ((None, 1800), (1000, None)):
            result = Attribution().between(previous, current,
                                           self.games(total=before_total),
                                           self.games(total=after_total, ticks=200))["1"]
            self.assertIsNone(result["cpu_wh"])
            self.assertIn("cpu_interval_incomplete", result["reasons"])

    def test_competing_cpu_shares_cannot_exceed_domain_energy(self):
        before = self.games(total=1000, ticks=100)
        before.append(copy.deepcopy(before[0]))
        before[1]["game_id"] = "2"
        after = copy.deepcopy(before)
        for game in after:
            game["cpu_total_ticks"] = 1100
            game["processes"][0]["cpu_ticks"] = 175
        results = Attribution().between({"monotonic": 1, "cpu_w": 8, "gpu_w": 10},
                                        {"monotonic": 2, "cpu_w": 8, "gpu_w": 10}, before, after)
        self.assertAlmostEqual(sum(r["cpu_wh"] for r in results.values()), 8 / 3600)
        after[0]["processes"][0]["cpu_ticks"] = 201
        results = Attribution().between({"monotonic": 1, "cpu_w": 8, "gpu_w": 10},
                                        {"monotonic": 2, "cpu_w": 8, "gpu_w": 10}, before, after)
        self.assertIsNone(results["1"]["cpu_wh"])

    def test_unknown_gpu_does_not_erase_independent_cpu_estimate(self):
        before = self.games()
        after = self.games(total=1800, ticks=200)
        after[0]["gpu_complete"] = False
        result = Attribution().between({"monotonic": 1, "cpu_w": 8, "gpu_w": 10},
                                       {"monotonic": 2, "cpu_w": 8, "gpu_w": 10}, before, after)["1"]
        self.assertGreater(result["cpu_wh"], 0)
        self.assertIsNone(result["gpu_wh"])
        after[0]["processes"][0]["start_ticks"] = 20
        changed = Attribution().between({"monotonic": 1, "cpu_w": 8, "gpu_w": 10},
                                        {"monotonic": 2, "cpu_w": 8, "gpu_w": 10}, before, after)["1"]
        self.assertIsNone(changed["cpu_wh"])

    def test_competing_gpu_estimates_do_not_exceed_domain_energy(self):
        before = self.games()
        before.append(copy.deepcopy(before[0]))
        before[1]["game_id"] = "2"
        after = copy.deepcopy(before)
        for game in after:
            game["gpu_clients"]["card/client"]["gfx"] += 1000000000
            game["cpu_total_ticks"] += 800
        results = Attribution().between({"monotonic": 1, "cpu_w": 8, "gpu_w": 10},
                                        {"monotonic": 2, "cpu_w": 8, "gpu_w": 10}, before, after)
        self.assertAlmostEqual(sum(r["gpu_wh"] for r in results.values()), 10 / 3600)


if __name__ == "__main__":
    unittest.main()
