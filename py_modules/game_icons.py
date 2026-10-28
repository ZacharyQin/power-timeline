"""Current Steam artwork and account-scoped, durable copies of displayed icons."""

import base64
import hashlib
import os
import re
import sqlite3
import stat
import threading
import urllib.parse
import urllib.request
from contextlib import closing
from pathlib import Path

from .games import shortcut_strings

MAX_ICON_BYTES = 8 * 1024 * 1024


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


class GameIcons:
    def __init__(self, steam_root, cache_dir=None):
        self.root = Path(steam_root)
        self.player_uid = self.root.stat().st_uid if self.root.exists() else None
        self.cache_path = Path(cache_dir) / "game-icons.sqlite3" if cache_dir is not None else None
        self._shortcuts = {}
        self._lock = threading.Lock()

    @staticmethod
    def _identity(app, account):
        for value in (app, account):
            if not isinstance(value, str) or not 1 <= len(value) <= 10 or not value.isascii() or not value.isdigit():
                raise ValueError("game and account must be unsigned AppIDs")
            if not 0 < int(value) <= 0xffffffff:
                raise ValueError("game or account is out of range")
        return str(int(app)), str(int(account))

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

    def _file(self, path, revision=None):
        if not stat.S_ISREG(path.stat().st_mode):
            return None
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC), "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_ICON_BYTES:
                return None
            if info.st_uid != self.player_uid and not info.st_mode & stat.S_IROTH:
                return None
            version = hashlib.sha256(f"{path}:{info.st_ino}:{info.st_mtime_ns}:{info.st_ctime_ns}:{info.st_size}".encode()).hexdigest()
            if version == revision:
                return version, None, None, info.st_mtime_ns
            data = stream.read(MAX_ICON_BYTES + 1)
            after = os.fstat(stream.fileno())
            if len(data) != info.st_size or (after.st_mtime_ns, after.st_ctime_ns, after.st_size) != (info.st_mtime_ns, info.st_ctime_ns, info.st_size):
                return None
            mime = self._mime(data[:1024])
            return (version, data, mime, info.st_mtime_ns) if mime else None

    @staticmethod
    def _data_source(data, mime):
        return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")

    def _cached(self, app, account, revision):
        if self.cache_path is None or not self.cache_path.exists():
            return None
        with closing(sqlite3.connect(self.cache_path.resolve().as_uri() + "?mode=ro", uri=True, timeout=0.1)) as connection:
            row = connection.execute("SELECT digest FROM icons WHERE account_id=? AND app_id=? AND length(data) BETWEEN 1 AND ?", (account, app, MAX_ICON_BYTES)).fetchone()
            if row is None:
                return None
            version = "cache:" + row[0]
            if version == revision:
                return {"revision": version, "cached": True}
            data, mime = connection.execute("SELECT data,mime FROM icons WHERE account_id=? AND app_id=?", (account, app)).fetchone()
            if hashlib.sha256(data).hexdigest() != row[0] or self._mime(data[:1024]) != mime:
                raise ValueError("stored game icon failed integrity verification")
            return {"revision": version, "source": self._data_source(data, mime), "cached": True}

    def _read(self, app, account, revision, cache_only=False):
        if not cache_only:
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
                    result = self._file(path, revision)
                    if result is None:
                        continue
                    version, data, mime, modified = result
                    if data is None:
                        return {"revision": version}
                    source = f"/customimages/{app}_icon{path.suffix}?v={modified}" if custom and path.suffix in (".png", ".jpg") else self._data_source(data, mime)
                    return {"revision": version, "source": source}
                except OSError:
                    continue
        cached = self._cached(app, account, revision)
        if cached is not None:
            return cached
        return {"revision": "missing"} if revision == "missing" else {"revision": "missing", "source": None}

    def read(self, app, account, revision=None, cache_only=False):
        app, account = self._identity(app, account)
        if not isinstance(cache_only, bool):
            raise ValueError("cache_only must be boolean")
        with self._lock:
            return self._read(app, account, revision, cache_only)

    def _source_bytes(self, source, app, account):
        if source.startswith("data:"):
            match = re.fullmatch(r"data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)", source)
            if not match:
                raise ValueError("icon must be a base64 image")
            data = base64.b64decode(re.sub(r"\s", "", match[2]), validate=True)
            mime = self._mime(data[:1024])
            aliases = {"image/vnd.microsoft.icon": "image/x-icon", "image/jpg": "image/jpeg"}
            if mime is None or aliases.get(match[1], match[1]) != mime:
                raise ValueError("icon content does not match its image type")
            return data, mime
        parsed = urllib.parse.urlsplit(source)
        custom = re.fullmatch(rf"/customimages/{app}_icon\.(png|jpg|jpeg|ico|webp|gif)", parsed.path)
        if custom and (not parsed.netloc or parsed.hostname in ("steamloopback.host", "localhost", "127.0.0.1")):
            result = self._file(self.root / "userdata" / account / "config/grid" / f"{app}_icon.{custom[1]}")
            if result is None:
                raise ValueError("selected custom image is unavailable")
            return result[1], result[2]
        # Only public Steam icon identities can cause a network request. The caller
        # cannot choose the host, port, query, credentials or redirect destination.
        native = re.fullmatch(rf"/(steamcommunity/public|community_assets)/images/apps/{app}/([0-9a-fA-F]{{40}})\.(jpg|png)", parsed.path)
        host = parsed.hostname or ""
        if (not native or parsed.scheme not in ("http", "https") or parsed.username or parsed.password
                or parsed.port is not None or parsed.query or parsed.fragment
                or not (host.endswith(".steamstatic.com") or host in ("media.steampowered.com", "steamcdn-a.akamaihd.net"))):
            raise ValueError("unsupported game icon source")
        url = f"https://cdn.akamai.steamstatic.com/{native[1]}/images/apps/{app}/{native[2].lower()}.{native[3]}"
        request = urllib.request.Request(url, headers={"User-Agent": "PowerTimeline-IconCache"})
        with urllib.request.build_opener(NoRedirects).open(request, timeout=5) as response:
            data = response.read(MAX_ICON_BYTES + 1)
        mime = self._mime(data[:1024])
        if mime not in ("image/jpeg", "image/png"):
            raise ValueError("Steam icon response is not an image")
        return data, mime

    def remember(self, app, account, source):
        """Archive a successfully displayed icon; failed loads must never replace it."""
        app, account = self._identity(app, account)
        if self.cache_path is None:
            raise RuntimeError("persistent game icon cache is unavailable")
        if not isinstance(source, str) or not 1 <= len(source) <= MAX_ICON_BYTES * 4 // 3 + 2048:
            raise ValueError("icon source exceeds the size limit")
        key = hashlib.sha256(source.encode()).hexdigest()
        with self._lock:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(self.cache_path, timeout=0.1)) as connection:
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                if version not in (0, 1):
                    raise RuntimeError("unsupported game icon cache schema version")
                connection.execute("PRAGMA synchronous=FULL")
                connection.execute("CREATE TABLE IF NOT EXISTS icons (account_id TEXT NOT NULL, app_id TEXT NOT NULL, source_key TEXT NOT NULL, digest TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(account_id,app_id))")
                previous = connection.execute("SELECT digest FROM icons WHERE account_id=? AND app_id=? AND source_key=?", (account, app, key)).fetchone()
                if previous is not None:
                    return {"stored": True, "revision": "cache:" + previous[0]}
                data, mime = self._source_bytes(source, app, account)
                if not 0 < len(data) <= MAX_ICON_BYTES:
                    raise ValueError("icon content exceeds the size limit")
                digest = hashlib.sha256(data).hexdigest()
                with connection:
                    connection.execute("INSERT INTO icons VALUES (?,?,?,?,?,?) ON CONFLICT(account_id,app_id) DO UPDATE SET source_key=excluded.source_key,digest=excluded.digest,mime=excluded.mime,data=excluded.data", (account, app, key, digest, mime, data))
                    connection.execute("PRAGMA user_version=1")
                return {"stored": True, "revision": "cache:" + digest}
