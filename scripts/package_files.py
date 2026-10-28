"""Shared runtime/source archive selection and matching-source checks."""

import fnmatch
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
import zipfile

API_PREFIX = "third-party/decky-api/"
SOURCE_ROOT_FILES = (
    ".gitignore", ".packageignore", "package.json", "pnpm-lock.yaml", "plugin.json",
    "tsconfig.json", "rollup.config.js", "LICENSE", "CHANGELOG.md", "README.md", "main.py",
)
RUNTIME_ROOT_FILES = (
    "plugin.json", "package.json", "main.py", "LICENSE",
    "dist/index.js", "dist/front-hardware.webp", "dist/front-rotor.webp",
    "dist/front-fan-front.webp", "dist/notices.json",
)
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".ico"}
CODE_EXTENSIONS = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css"}
SOURCE_TREES = {
    "src": CODE_EXTENSIONS | IMAGE_EXTENSIONS,
    "py_modules": {".py"},
    "scripts": {".py", ".js", ".mjs", ".json"},
    "tests": {".py", ".js", ".mjs", ".json", ".txt"} | IMAGE_EXTENSIONS,
    "docs/readme": {".md"},
}


class PackageFiles:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.exclusions = [line.strip().lstrip("/") for line in
                           (self.root / ".packageignore").read_text().splitlines()
                           if line.strip() and not line.lstrip().startswith("#")]

    def excluded(self, name):
        return any(fnmatch.fnmatchcase(name, pattern) or PurePosixPath(name).match(pattern)
                   for pattern in self.exclusions)

    def required(self, name):
        path = self.root / name
        if self.excluded(name):
            raise ValueError(f"required archive input is excluded: {name}")
        if path.is_symlink() or not path.resolve().is_relative_to(self.root):
            raise ValueError(f"archive input must be inside the project: {name}")
        if not path.is_file():
            raise FileNotFoundError(f"missing archive input: {name}")
        return path

    def tree(self, directory, extensions):
        return [self.required(path.relative_to(self.root).as_posix())
                for path in sorted((self.root / directory).rglob("*"))
                if path.suffix in extensions and path.is_file()
                and not self.excluded(path.relative_to(self.root).as_posix())]

    def licenses(self):
        # The licenses directory also holds authoring binaries: never recurse it.
        paths = [self.required(path.relative_to(self.root).as_posix())
                 for path in sorted((self.root / "licenses").glob("*.txt"))]
        paths += [self.required(name) for name in (
            "licenses/REBUILD.txt", "licenses/LGPL-2.1.txt", "licenses/assets/NOTICE.txt")]
        return sorted(set(paths))

    def sources(self):
        paths = [self.required(name) for name in SOURCE_ROOT_FILES]
        paths += self.licenses()
        paths.append(self.required("licenses/decky-api-tsconfig.json"))
        for directory, extensions in SOURCE_TREES.items():
            paths += self.tree(directory, extensions)
        return sorted(set(paths))

    def runtime(self):
        paths = [self.required(name) for name in RUNTIME_ROOT_FILES]
        paths += self.tree("py_modules", {".py"})
        return sorted(set(paths))

    def api_sources(self, directory):
        api = Path(directory).resolve()
        paths = [api / name for name in ("package.json", "LICENSE", "README.md")]
        for name in ("src", "dist"):
            paths += [p for p in (api / name).rglob("*") if p.suffix in CODE_EXTENSIONS and p.is_file()]
        result = []
        for path in sorted(set(paths)):
            relative = path.relative_to(api).as_posix()
            if self.excluded(API_PREFIX + relative):
                continue
            if path.is_symlink() or not path.resolve().is_relative_to(api) or not path.is_file():
                raise ValueError(f"invalid Decky API source input: {relative}")
            result.append((path, API_PREFIX + relative))
        return result

    def validate_sources(self):
        expected = {p.relative_to(self.root).as_posix(): p for p in self.sources()}
        with zipfile.ZipFile(self.root / "dist/license-sources.zip") as archive:
            names = archive.namelist()
            if len(names) != len(set(names)) or archive.testzip() is not None:
                raise ValueError("source archive has duplicate or damaged members")
            for name in names:
                path = PurePosixPath(name)
                if path.is_absolute() or ".." in path.parts or "\\" in name or self.excluded(name):
                    raise ValueError(f"unsafe or excluded source archive member: {name}")
            own = {name for name in names if not name.startswith(API_PREFIX)}
            if own != set(expected):
                raise ValueError(f"source archive manifest mismatch: missing={sorted(set(expected) - own)}, "
                                 f"unexpected={sorted(own - set(expected))}")
            for name, path in expected.items():
                if archive.read(name) != path.read_bytes():
                    raise ValueError(f"source archive is stale; rebuild before packaging: {name}")
            required_api = {API_PREFIX + name for name in (
                "package.json", "LICENSE", "README.md", "tsconfig.json", "src/index.ts", "dist/index.js")}
            if not required_api.issubset(names):
                raise ValueError("source archive is missing Decky API rebuild inputs")
            for name in set(names) - own:
                relative = PurePosixPath(name.removeprefix(API_PREFIX))
                if (str(relative) not in ("package.json", "LICENSE", "README.md", "tsconfig.json")
                        and (relative.parts[0] not in ("src", "dist") or relative.suffix not in CODE_EXTENSIONS)):
                    raise ValueError(f"unexpected Decky API archive member: {name}")
            api = json.loads(archive.read(API_PREFIX + "package.json"))
            if api.get("name") != "@decky/api" or api.get("version") != "1.1.3":
                raise ValueError("source archive does not contain the pinned Decky API")

    def package(self, output=None, ref=""):
        metadata = json.loads((self.root / "package.json").read_text())
        version = metadata["version"]
        if metadata.get("name") != "power-timeline" or not re.fullmatch(
                r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", version):
            raise ValueError("invalid Power Timeline package identity/version")
        if ref.startswith("refs/tags/") and ref != f"refs/tags/v{version}":
            raise ValueError(f"{ref} does not match package.json version v{version}")
        paths = self.runtime()
        self.validate_sources()
        source_info = {
            "name": f"power-timeline-{version}-sources.zip",
            "url": f"https://github.com/ZacharyQin/power-timeline/releases/download/v{version}/power-timeline-{version}-sources.zip",
        }
        notices = json.loads((self.root / "dist/notices.json").read_text())
        documents = {doc["text"] for entry in notices["entries"] for doc in entry["documents"]}
        for path in [self.required("LICENSE"), *self.licenses()]:
            if path.read_text() not in documents:
                raise ValueError(f"offline notices are missing license material: {path.name}")
        if notices.get("sourceArchive") != source_info:
            raise ValueError("offline notices do not identify the matching source artifact")
        if re.search(rb"[#@]\s*sourceMappingURL\s*=", (self.root / "dist/index.js").read_bytes()):
            raise ValueError("runtime bundle still contains a source map reference")
        output = Path(output) if output is not None else self.root / f"dist/power-timeline-{version}.zip"
        source_output = output.parent / source_info["name"]
        if output.resolve() == source_output.resolve():
            raise ValueError("runtime and source artifact paths must differ")
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in paths:
                archive.write(path, "power-timeline/" + path.relative_to(self.root).as_posix())
        with zipfile.ZipFile(content) as archive:
            if archive.testzip() is not None:
                raise ValueError("runtime archive failed CRC verification")
        payloads = [(output, content.getvalue()),
                    (source_output, (self.root / "dist/license-sources.zip").read_bytes())]
        staged = []
        try:
            for destination, payload in payloads:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(prefix=".power-timeline-", suffix=".zip", dir=destination.parent,
                                                 delete=False) as stream:
                    staged.append((Path(stream.name), destination))
                    stream.write(payload)
            for temporary, destination in staged:
                os.replace(temporary, destination)
        finally:
            for temporary, _destination in staged:
                temporary.unlink(missing_ok=True)
        return output, source_output
