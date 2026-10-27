"""Read user-selected game artwork without exposing arbitrary filesystem paths."""

import base64
import hashlib
import os
import re
import stat
import threading
from pathlib import Path

from .games import shortcut_strings


class GameIcons:
    def __init__(self, steam_root):
        self.root = Path(steam_root)
        self.player_uid = self.root.stat().st_uid if self.root.exists() else None
        self._shortcuts = {}
        self._lock = threading.Lock()

    def _shortcut_icon(self, account, app):
        path = self.root / "userdata" / account / "config/shortcuts.vdf"
        cached = self._shortcuts.get(account)
        try:
            info = path.stat()
            signature = (info.st_mtime_ns, info.st_size)
            if cached is None or cached[0] != signature:
                cached = (signature, shortcut_strings(path.read_bytes(), b"icon"))
                self._shortcuts[account] = cached
        except (OSError, ValueError, UnicodeError):
            pass
        return cached[1].get(app) if cached else None

    @staticmethod
    def _mime(data):
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if data.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if data.startswith(b"\0\0\x01\0"):
            return "image/x-icon"
        if data.startswith((b"GIF87a", b"GIF89a")):
            return "image/gif"
        if re.search(rb"<svg(?:\s|>)", data):
            return "image/svg+xml"
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            return "image/webp"
        return None

    def _read(self, app, account, revision):
        grid = self.root / "userdata" / account / "config/grid"
        candidates = []
        for extension in ("jpg", "png", "ico", "jpeg", "webp", "gif"):
            path = grid / f"{app}_icon.{extension}"
            try:
                candidates.append((path.stat().st_mtime_ns, path, True))
            except OSError:
                pass
        candidates.sort(key=lambda entry: entry[0], reverse=True)
        icon = self._shortcut_icon(account, app)
        if icon:
            path = Path(icon.strip('"'))
            if path.is_absolute():
                candidates.insert(0, (0, path, False))
        for _, path, custom in candidates:
            try:
                if not stat.S_ISREG(path.stat().st_mode):
                    continue
                with os.fdopen(os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC), "rb") as stream:
                    info = os.fstat(stream.fileno())
                    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= 8 * 1024 * 1024:
                        continue
                    if info.st_uid != self.player_uid and not info.st_mode & stat.S_IROTH:
                        continue
                    version = hashlib.sha256(f"{path}:{info.st_ino}:{info.st_mtime_ns}:{info.st_ctime_ns}:{info.st_size}".encode()).hexdigest()
                    if version == revision:
                        return {"revision": version}
                    header = stream.read(1024)
                    mime = self._mime(header)
                    if not mime:
                        continue
                    if custom and path.suffix in (".png", ".jpg"):
                        source = f"/customimages/{app}_icon{path.suffix}?v={info.st_mtime_ns}"
                    else:
                        data = header + stream.read(8 * 1024 * 1024)
                        after = os.fstat(stream.fileno())
                        if len(data) != info.st_size or (after.st_mtime_ns, after.st_size) != (info.st_mtime_ns, info.st_size):
                            continue
                        source = f"data:{mime};base64," + base64.b64encode(data).decode("ascii")
                    return {"revision": version, "source": source}
            except OSError:
                continue
        return {"revision": "missing"} if revision == "missing" else {"revision": "missing", "source": None}

    def read(self, app, account, revision=None):
        if not isinstance(app, str) or not isinstance(account, str) or not app.isascii() or not account.isascii() or not app.isdigit() or not account.isdigit():
            raise ValueError("game and account must be unsigned AppIDs")
        if not 0 < int(app) <= 0xffffffff or not 0 < int(account) <= 0xffffffff:
            raise ValueError("game or account is out of range")
        with self._lock:
            return self._read(str(int(app)), str(int(account)), revision)
