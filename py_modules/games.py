"""Process identities and per-client GPU execution counters, never energy meters."""

import os
import re
from pathlib import Path


def parse_stat(text: str) -> tuple[int, int]:
    # comm may contain spaces and parentheses; remaining fields begin at field 3.
    fields = text[text.rfind(")") + 2:].split()
    return int(fields[19]), int(fields[11]) + int(fields[12])


def parse_fdinfo(text: str):
    values = {}
    for line in text.splitlines():
        key, sep, value = line.partition(":")
        if sep:
            values[key] = value.strip()
    client = values.get("drm-client-id")
    device = values.get("drm-pdev")
    if not client or not device or values.get("drm-driver") != "amdgpu":
        return None
    # amdgpu_show_fdinfo omits engines whose accumulated usage is zero.
    engines = {"gfx": 0, "compute": 0}
    for name in engines:
        key = f"drm-engine-{name}"
        if key in values:
            raw = values[key].split()
            if len(raw) != 2 or raw[1] != "ns":
                return None
            engines[name] = int(raw[0])
            if engines[name] < 0:
                return None
    return (device, client), engines


def shortcut_names(data):
    """Read names from binary shortcuts.vdf without treating metadata as running games."""
    if not data:
        raise ValueError("empty shortcut data")
    names, path, offset = {}, [], 0
    app_id, name = None, None
    widths = {2: 4, 3: 4, 4: 4, 6: 4, 7: 8, 10: 8}
    while offset < len(data):
        kind = data[offset]
        offset += 1
        if kind == 8:
            if not path:
                if offset != len(data):
                    raise ValueError("trailing shortcut data")
                return names
            if len(path) == 2 and path[0] == b"shortcuts" and app_id and name:
                names[str(app_id)] = name
                names[str((app_id << 32) | 0x02000000)] = name
            path.pop()
            continue
        end = data.index(0, offset)
        key = data[offset:end].lower()
        offset = end + 1
        if kind == 0:
            path.append(key)
            if len(path) == 2 and path[0] == b"shortcuts":
                app_id, name = None, None
            continue
        shortcut = len(path) == 2 and path[0] == b"shortcuts"
        if kind == 1:
            end = data.index(0, offset)
            if shortcut and key == b"appname":
                name = data[offset:end].decode("utf-8").strip()[:512]
            offset = end + 1
        elif kind == 5:
            end = offset
            while end + 2 <= len(data) and data[end:end + 2] != b"\0\0":
                end += 2
            if end + 2 > len(data):
                raise ValueError("incomplete shortcut string")
            if shortcut and key == b"appname":
                name = data[offset:end].decode("utf-16-le").lstrip("\ufeff").strip()[:512]
            offset = end + 2
        elif kind in widths:
            width = widths[kind]
            if offset + width > len(data):
                raise ValueError("incomplete shortcut value")
            if shortcut and key == b"appid" and kind == 2:
                app_id = int.from_bytes(data[offset:offset + width], "little")
            offset += width
        else:
            raise ValueError("unsupported shortcut value type")
    if path:
        raise ValueError("incomplete shortcut object")
    return names


class GameTracker:
    def __init__(self, proc_root: Path = Path("/proc"), steam_root: Path | None = None):
        self.proc_root = proc_root
        self.steam_root = steam_root or Path(os.environ.get("DECKY_USER_HOME") or Path.home()) / ".steam/steam"
        self._identities = {}
        self._names = {}
        self._shortcut_files = {}
        self._shortcut_names = {}
        self.name_revision = 0
        self._scan_number = 0
        self._load_names()
        self._refresh_shortcuts()

    def _load_names(self):
        roots = [self.steam_root / "steamapps"]
        try:
            config = (roots[0] / "libraryfolders.vdf").read_text()
            roots.extend(Path(p.replace("\\\\", "\\")) / "steamapps"
                         for p in re.findall(r'"path"\s+"([^"]+)"', config))
        except OSError:
            pass
        for root in roots:
            for path in root.glob("appmanifest_*.acf"):
                try:
                    text = path.read_text()
                    app = re.search(r'"appid"\s+"(\d+)"', text)
                    name = re.search(r'"name"\s+"([^"]+)"', text)
                    if app and name:
                        self._names[app[1]] = name[1]
                except OSError:
                    pass

    def _refresh_shortcuts(self):
        files = {}
        for path in sorted((self.steam_root / "userdata").glob("*/config/shortcuts.vdf")):
            cached = self._shortcut_files.get(path)
            try:
                info = path.stat()
                signature = (info.st_mtime_ns, info.st_size)
                if cached is None or signature != cached[0]:
                    cached = (signature, shortcut_names(path.read_bytes()))
            except (OSError, ValueError, UnicodeError):
                # Steam may be rewriting this optional metadata; keep its last complete catalog.
                if cached is None:
                    continue
            files[path] = cached
        if files == self._shortcut_files:
            return
        self._shortcut_files = files
        names, conflicts = {}, set()
        for _, entries in files.values():
            for identity, name in entries.items():
                if identity in names and names[identity] != name:
                    conflicts.add(identity)
                names[identity] = name
        for identity in conflicts:
            del names[identity]
        if names != self._shortcut_names:
            self._shortcut_names = names
            self.name_revision += 1

    def resolve_names(self, identities):
        """Resolve only requested identities; an ambiguous account mapping stays unknown."""
        result = []
        for identity in identities:
            name = self._shortcut_names.get(identity, self._names.get(identity))
            if name:
                result.append({"game_id": identity, "name": name})
        return result

    def observe_names(self, games):
        for game in games:
            identity = str(game.get("game_id", ""))
            name = game.get("name")
            if identity.isdigit() and isinstance(name, str) and name.strip():
                name = name.strip()[:200]
                if self._names.get(identity) != name:
                    self._names[identity] = name
                    self.name_revision += 1

    def scan(self) -> list:
        self._scan_number += 1
        if self._scan_number % 5 == 0:
            self._refresh_shortcuts()
        groups = {}
        current = {}
        for proc in self.proc_root.iterdir():
            if not proc.name.isdigit():
                continue
            try:
                start, cpu_ticks = parse_stat((proc / "stat").read_text())
                key = (int(proc.name), start)
                cached = self._identities.get(key)
                # Revisit unknown identities every five seconds in case a launcher execs.
                if cached is None or (cached == "" and self._scan_number % 5 == 0):
                    env = {}
                    for entry in (proc / "environ").read_bytes().split(b"\0"):
                        k, sep, value = entry.partition(b"=")
                        if sep and k in (b"SteamAppId", b"SteamGameId"):
                            env[k] = value.decode("ascii", errors="ignore")
                    app = env.get(b"SteamAppId", "")
                    game = env.get(b"SteamGameId", "")
                    cached = app if app.isdigit() and app != "0" else game
                    if not cached.isdigit() or cached == "0":
                        cached = ""
                current[key] = cached
                if not cached:
                    continue
                group = groups.setdefault(cached, {
                    "game_id": cached, "name": self._shortcut_names.get(cached, self._names.get(cached, f"游戏 {cached}")),
                    "processes": [], "cpu_total_ticks": None,
                    "gpu_complete": True, "gpu_clients": {}})
                clients = {}
                complete = True
                try:
                    # Only open fdinfo for DRM file descriptors. Regular files are irrelevant.
                    for fd in (proc / "fd").iterdir():
                        try:
                            target = os.readlink(fd)
                        except FileNotFoundError:
                            continue
                        except OSError:
                            complete = False
                            continue
                        if not target.startswith("/dev/dri/"):
                            continue
                        try:
                            parsed = parse_fdinfo((proc / "fdinfo" / fd.name).read_text())
                            if parsed:
                                client, engines = parsed
                                existing = clients.setdefault("/".join(client), {"gfx": 0, "compute": 0})
                                for name, ns in engines.items():
                                    existing[name] = max(ns, existing[name])
                            else:
                                complete = False
                        except (OSError, ValueError):
                            complete = False
                except OSError:
                    complete = False
                # Identity must survive the scan; PID reuse cannot inherit another game's counters.
                if parse_stat((proc / "stat").read_text())[0] != start:
                    continue
                group["gpu_complete"] = group["gpu_complete"] and complete
                group["processes"].append({"pid": key[0], "start_ticks": start,
                                           "cpu_ticks": cpu_ticks,
                                           "gpu_ns": sum(max(e.values()) for e in clients.values()) if complete else None})
                for client, engines in clients.items():
                    existing = group["gpu_clients"].setdefault(client, {"gfx": 0, "compute": 0})
                    for name, ns in engines.items():
                        existing[name] = max(ns, existing[name])
            except (OSError, ValueError, IndexError):
                continue
        self._identities = current
        try:
            cpu = (self.proc_root / "stat").read_text().splitlines()[0].split()[1:]
            # Read after the process counters; guest is already included in user/nice.
            total_ticks = sum(int(v) for v in cpu[:8])
        except (OSError, ValueError, IndexError):
            total_ticks = None
        for game in groups.values():
            game["cpu_total_ticks"] = total_ticks
        # Shared DRM client cannot be claimed independently by two games.
        owners = {}
        for game in groups.values():
            for client in game["gpu_clients"]:
                owners.setdefault(client, set()).add(game["game_id"])
        for game in groups.values():
            if any(len(owners[c]) > 1 for c in game["gpu_clients"]):
                game["gpu_complete"] = False
        return [game for game in groups.values() if game["processes"]]
