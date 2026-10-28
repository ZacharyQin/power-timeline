import base64
import os
import sqlite3
import struct
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import MagicMock, patch

from py_modules.game_icons import GameIcons


def icon(color):
    bitmap = struct.pack("<IIIHHIIIIII", 40, 1, 2, 1, 32, 0, 4, 0, 0, 0, 0) + bytes(color) + bytes(4)
    return struct.pack("<HHHBBBBHHII", 0, 1, 1, 1, 1, 0, 0, 1, 32, len(bitmap), 22) + bitmap


class SavedIconTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.grid = self.root / "userdata/7/config/grid"
        self.grid.mkdir(parents=True)
        self.icons = GameIcons(self.root)

    def test_custom_icons_are_account_scoped_and_changes_do_not_resend_unchanged_bytes(self):
        path = self.grid / "220_icon.ico"
        first = icon((0, 0, 255, 255))
        path.write_bytes(first)
        other = self.root / "userdata/8/config/grid"
        other.mkdir(parents=True)
        second = icon((0, 255, 0, 255))
        (other / path.name).write_bytes(second)
        result = self.icons.read("220", "7")
        self.assertEqual(base64.b64decode(result["source"].split(",", 1)[1]), first)
        self.assertEqual(self.icons.read("220", "7", result["revision"]), {"revision": result["revision"]})
        self.assertNotEqual(self.icons.read("220", "8")["source"], result["source"])
        path.write_bytes(second)
        changed = self.icons.read("220", "7", result["revision"])
        self.assertNotEqual(changed["revision"], result["revision"])
        self.assertEqual(base64.b64decode(changed["source"].split(",", 1)[1]), second)
        path.unlink()
        self.assertEqual(self.icons.read("220", "7", changed["revision"]), {"revision": "missing", "source": None})

    def test_latest_custom_artwork_wins_and_native_png_url_tracks_file_revision(self):
        old = self.grid / "2355037391_icon.ico"
        old.write_bytes(icon((0, 0, 255, 255)))
        newer = self.grid / "2355037391_icon.png"
        newer.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEJ8AAAAASUVORK5CYII="))
        os.utime(old, ns=(1000, 1000))
        os.utime(newer, ns=(2000, 2000))
        self.assertEqual(self.icons.read("2355037391", "7")["source"], "/customimages/2355037391_icon.png?v=2000")
        newer.write_bytes(b"incomplete rewrite")
        self.assertTrue(self.icons.read("2355037391", "7")["source"].startswith("data:image/x-icon;base64,"))

    def test_saved_shortcut_icon_and_partial_catalog_rewrites_preserve_valid_selection(self):
        image = self.root / "chosen.ico"
        image.write_bytes(icon((0, 0, 255, 255)))
        app = 2355037391
        entries = (b"\0shortcuts\0\0" + b"0\0\x02appid\0" + struct.pack("<I", app)
                   + b"\x01icon\0\"" + str(image).encode() + b"\"\0\x08\x08\x08")
        config = self.grid.parent / "shortcuts.vdf"
        config.write_bytes(entries)
        stale = self.grid / f"{app}_icon.ico"
        stale.write_bytes(icon((0, 255, 0, 255)))
        result = self.icons.read(str(app), "7")
        self.assertEqual(base64.b64decode(result["source"].split(",", 1)[1]), image.read_bytes())
        config.write_bytes(entries[:-4])
        self.assertEqual(self.icons.read(str(app), "7", result["revision"]), {"revision": result["revision"]})
        image.unlink()
        self.assertEqual(base64.b64decode(self.icons.read(str(app), "7", result["revision"])["source"].split(",", 1)[1]), stale.read_bytes())

    def test_untrusted_ids_non_images_and_special_files_cannot_be_read_as_icons(self):
        for value in ("../7", "-1", "0", "4294967296", "7/../../", "７"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.icons.read("220", value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.icons.read(value, "7")
        (self.grid / "220_icon.ico").write_text("private text is not an image")
        os.mkfifo(self.grid / "220_icon.png")
        self.assertEqual(self.icons.read("220", "7"), {"revision": "missing", "source": None})
        too_large = self.grid / "220_icon.webp"
        with too_large.open("wb") as stream:
            stream.truncate(8 * 1024 * 1024 + 1)
        self.assertEqual(self.icons.read("220", "7"), {"revision": "missing", "source": None})
    def test_persistent_copy_survives_original_removal_and_new_backend_instance(self):
        cached = GameIcons(self.root, self.root / "plugin-data")
        path = self.grid / "220_icon.ico"
        data = icon((0, 0, 255, 255))
        path.write_bytes(data)
        live = cached.read("220", "7")
        stored = cached.remember("220", "7", live["source"])
        path.unlink()
        restored = GameIcons(self.root, self.root / "plugin-data")
        result = restored.read("220", "7")
        self.assertTrue(result["cached"])
        self.assertEqual(result["revision"], stored["revision"])
        self.assertEqual(base64.b64decode(result["source"].split(",", 1)[1]), data)
        self.assertEqual(restored.read("220", "7", result["revision"]), {"revision": result["revision"], "cached": True})
        self.assertEqual(restored.read("220", "8")["revision"], "missing")
        self.assertEqual(restored.read("221", "7")["revision"], "missing")
        path.write_bytes(icon((0, 255, 0, 255)))
        self.assertFalse(restored.read("220", "7").get("cached", False))
        self.assertEqual(restored.read("220", "7", cache_only=True), result)

    def test_custom_png_archive_copies_bytes_instead_of_remembering_its_old_url(self):
        cached = GameIcons(self.root, self.root / "plugin-data")
        path = self.grid / "220_icon.png"
        data = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEJ8AAAAASUVORK5CYII=")
        path.write_bytes(data)
        source = cached.read("220", "7")["source"]
        self.assertTrue(source.startswith("/customimages/"))
        cached.remember("220", "7", source)
        path.unlink()
        archived = cached.read("220", "7")
        self.assertTrue(archived["source"].startswith("data:image/png;base64,"))
        self.assertEqual(base64.b64decode(archived["source"].split(",", 1)[1]), data)

    def test_native_icons_use_fixed_public_steam_origin_and_do_not_redownload(self):
        cached = GameIcons(self.root, self.root / "plugin-data")
        data = b"\xff\xd8\xff" + b"native image fixture"
        response = MagicMock()
        response.__enter__.return_value.read.return_value = data
        opener = MagicMock()
        opener.open.return_value = response
        source = "https://shared.fastly.steamstatic.com/steamcommunity/public/images/apps/220/" + "a" * 40 + ".jpg"
        with patch("py_modules.game_icons.urllib.request.build_opener", return_value=opener):
            result = cached.remember("220", "7", source)
            self.assertEqual(cached.remember("220", "7", source), result)
        self.assertEqual(opener.open.call_count, 1)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/220/" + "a" * 40 + ".jpg")
        restored = GameIcons(self.root, self.root / "plugin-data").read("220", "7", cache_only=True)
        self.assertEqual(base64.b64decode(restored["source"].split(",", 1)[1]), data)

    def test_current_steam_community_assets_icons_are_archived_and_identity_checked(self):
        cached = GameIcons(self.root, self.root / "plugin-data")
        data = b"\xff\xd8\xff" + b"current Steam icon fixture"
        response = MagicMock()
        response.__enter__.return_value.read.return_value = data
        opener = MagicMock()
        opener.open.return_value = response
        path = "/community_assets/images/apps/220/" + "B" * 40 + ".jpg"
        with patch("py_modules.game_icons.urllib.request.build_opener", return_value=opener):
            stored = cached.remember("220", "7", "https://shared.fastly.steamstatic.com" + path)
            self.assertEqual(opener.open.call_args.args[0].full_url,
                             "https://cdn.akamai.steamstatic.com" + path.lower())
            archived = GameIcons(self.root, self.root / "plugin-data").read("220", "7", cache_only=True)
            self.assertEqual(archived["revision"], stored["revision"])
            self.assertEqual(base64.b64decode(archived["source"].split(",", 1)[1]), data)
            for source in ("https://attacker.example" + path,
                           "https://shared.fastly.steamstatic.com" + path + "?token=anything",
                           "https://shared.fastly.steamstatic.com" + path.replace("/220/", "/221/"),
                           "https://shared.fastly.steamstatic.com" + path.replace("/220/", "/220/../")):
                with self.subTest(source=source), self.assertRaises(ValueError):
                    cached.remember("220", "7", source)
            self.assertEqual(opener.open.call_count, 1)

    def test_invalid_sources_and_failed_downloads_cannot_replace_a_good_archive(self):
        cached = GameIcons(self.root, self.root / "plugin-data")
        source = "data:image/x-icon;base64," + base64.b64encode(icon((0, 0, 255, 255))).decode()
        cached.remember("220", "7", source)
        before = cached.read("220", "7", cache_only=True)
        native_path = "/steamcommunity/public/images/apps/220/" + "a" * 40 + ".jpg"
        for invalid in ("file:///etc/passwd", "http://127.0.0.1" + native_path,
                        "https://attacker.example" + native_path,
                        "https://cdn.akamai.steamstatic.com:443" + native_path,
                        "https://cdn.akamai.steamstatic.com" + native_path + "?token=anything",
                        "https://cdn.akamai.steamstatic.com" + native_path.replace("/220/", "/221/"),
                        "data:image/png;base64," + base64.b64encode(b"not an image").decode(),
                        "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + bytes(8 * 1024 * 1024)).decode()):
            with self.subTest(source=invalid[:100]), self.assertRaises(ValueError):
                cached.remember("220", "7", invalid)
        with patch("py_modules.game_icons.urllib.request.build_opener", side_effect=OSError("offline")):
            with self.assertRaises(OSError):
                cached.remember("220", "7", "https://cdn.akamai.steamstatic.com" + native_path)
        self.assertEqual(cached.read("220", "7", cache_only=True), before)

    def test_corrupt_or_future_cache_is_not_presented_as_a_valid_icon(self):
        cached = GameIcons(self.root, self.root / "plugin-data")
        source = "data:image/x-icon;base64," + base64.b64encode(icon((0, 0, 255, 255))).decode()
        cached.remember("220", "7", source)
        with closing(sqlite3.connect(cached.cache_path)) as connection:
            with connection:
                connection.execute("UPDATE icons SET data=?", (b"broken",))
        with self.assertRaisesRegex(ValueError, "integrity"):
            cached.read("220", "7", cache_only=True)
        with closing(sqlite3.connect(cached.cache_path)) as connection:
            connection.execute("PRAGMA user_version=100")
        with self.assertRaisesRegex(RuntimeError, "schema"):
            cached.remember("220", "7", source)


if __name__ == "__main__":
    unittest.main()
