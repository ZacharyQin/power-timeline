import copy
import os
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from py_modules.attribution import Attribution
from py_modules.games import GameTracker, parse_fdinfo, parse_stat, shortcut_strings
from py_modules.telemetry import decode_gpu_metrics
from py_modules.recorder import Recorder
from test_recorder import sample


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


class ShortcutNameTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.proc = self.root / "proc"
        self.proc.mkdir()
        (self.proc / "stat").write_text("cpu 100 0 0 0 0 0 0 0\n")
        self.steam = self.root / "steam"

    def tearDown(self):
        self.directory.cleanup()

    def shortcuts(self, entries, account="1"):
        path = self.steam / "userdata" / account / "config" / "shortcuts.vdf"
        path.parent.mkdir(parents=True, exist_ok=True)
        data = b"\0shortcuts\0"
        for index, (app_id, name) in enumerate(entries):
            data += b"\0" + str(index).encode() + b"\0\x02appid\0" + struct.pack("<I", app_id)
            data += b"\x01AppName\0" + name.encode("utf-8") + b"\0"
            data += b"\x03scale\0" + struct.pack("<f", 1.25)
            data += b"\x07lastplayed\0" + struct.pack("<Q", 1234)
            data += b"\0tags\0\x01AppName\0not the game name\0\x08\x08"
        path.write_bytes(data + b"\x08\x08")
        return path

    def process(self, pid, app_id, game_id):
        root = self.proc / str(pid)
        root.mkdir()
        (root / "fd").mkdir()
        fields = ["S"] + ["0"] * 21
        fields[11], fields[12], fields[19] = "50", "20", "12345"
        (root / "stat").write_text(f"{pid} (custom game) " + " ".join(fields))
        (root / "environ").write_bytes(f"SteamAppId={app_id}\0SteamGameId={game_id}\0".encode())

    def test_root_plugin_uses_decky_players_home_for_shortcut_names(self):
        app_id = 2634836747
        user_home = self.root / "player"
        self.steam = user_home / ".steam/steam"
        self.shortcuts([(app_id, "玩家添加的中文游戏")])
        self.process(10, app_id, (app_id << 32) | 0x02000000)
        with patch.dict(os.environ, {"HOME": str(self.root / "root"), "DECKY_USER_HOME": str(user_home)}):
            tracker = GameTracker(proc_root=self.proc)
            self.assertEqual([row["name"] for row in tracker.scan()], ["玩家添加的中文游戏"])

    def test_short_and_long_shortcut_ids_keep_names_without_merging_process_identity(self):
        app_id, title = 3307364148, '自定义游戏 "特别版" \\ 中文'
        game_id = (app_id << 32) | 0x02000000
        self.shortcuts([(app_id, title), (2634836747, "未运行的游戏")])
        self.process(10, app_id, game_id)
        self.process(11, 0, game_id)
        tracker = GameTracker(self.proc, self.steam)
        rows = {row["game_id"]: row for row in tracker.scan()}
        self.assertEqual(set(rows), {str(app_id), str(game_id)})
        self.assertEqual({row["name"] for row in rows.values()}, {title})
        self.assertEqual([p["pid"] for p in rows[str(app_id)]["processes"]], [10])
        self.assertEqual([p["pid"] for p in rows[str(game_id)]["processes"]], [11])

    def test_late_names_and_renames_backfill_existing_history_without_changing_statistics(self):
        app_id = 3307364148
        self.process(10, app_id, (app_id << 32) | 0x02000000)
        tracker = GameTracker(self.proc, self.steam)
        recorder = Recorder(self.root / "history")
        recorder.start()
        try:
            for tick in range(2):
                recorder.ingest(sample(tick), tracker.scan(), {})
            session = recorder.game_history(str(app_id))["sessions"][0]
            before = recorder.session_detail(session["session_id"])
            for title in ("用户自己添加的游戏", "重命名后的自定义游戏"):
                path = self.shortcuts([(app_id, title), (2634836747, "未运行的游戏")])
                for _ in range(5):
                    tracker.scan()
                recorder.observe_games(tracker.resolve_names(recorder.names))
                expected = copy.deepcopy(before)
                expected["session"]["name"] = title
                for event in expected["timeline"]["events"]:
                    if event["kind"] == "game":
                        event["label"] = title
                self.assertEqual(recorder.session_detail(session["session_id"]), expected)
                self.assertEqual(recorder.game_history()["games"][0]["name"], title)
                self.assertEqual(recorder.game_history()["total"], 1)
                self.assertEqual(recorder.snapshot()["sessions"][0]["name"], title)
            path.write_bytes(b"\0shortcuts\0")
            for _ in range(5):
                tracker.scan()
            recorder.observe_games(tracker.resolve_names(recorder.names))
            self.assertEqual(recorder.game_history()["games"][0]["name"], title)
            path.unlink()
            for _ in range(5):
                tracker.scan()
            recorder.observe_games(tracker.resolve_names(recorder.names))
            recorder.close()
            recorder.start()
            restored = recorder.game_history()["games"][0]
            self.assertEqual(restored["name"], title)
            self.assertEqual(restored["system_wh"], before["session"]["system_wh"])
        finally:
            recorder.close()

    def test_conflicting_account_names_are_not_assigned_arbitrarily(self):
        app_id = 2634836747
        self.shortcuts([(app_id, "第一个账户的游戏")], "1")
        self.shortcuts([(app_id, "另一个账户的游戏")], "2")
        tracker = GameTracker(self.proc, self.steam)
        self.assertEqual(tracker.resolve_names([str(app_id), str((app_id << 32) | 0x02000000)]), [])
        self.assertEqual(tracker.scan(), [])

    def test_wide_names_and_truncated_metadata_do_not_create_wrong_labels(self):
        app_id, title = 2634836747, "非 Steam 游戏"
        path = self.shortcuts([(app_id, title)])
        original = path.read_bytes()
        wide = original.replace(b"\x01AppName\0" + title.encode("utf-8") + b"\0",
                                b"\x05AppName\0" + title.encode("utf-16-le") + b"\0\0")
        self.assertEqual(shortcut_strings(wide, b"appname")[str(app_id)], title)
        for data in (b"", original[:-3], b"\0shortcuts\0\x02appid\0\x01"):
            with self.subTest(data=data), self.assertRaises(ValueError):
                shortcut_strings(data, b"appname")


if __name__ == "__main__":
    unittest.main()
