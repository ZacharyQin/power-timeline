import base64
import os
import struct
import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
