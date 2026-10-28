"""Archive boundaries, matching sources and failed-build protection."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "scripts"))
from package_files import API_PREFIX, PackageFiles, SOURCE_ROOT_FILES


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        self.root.mkdir()
        for name in SOURCE_ROOT_FILES:
            self.write(name, "fixture\n")
        self.write(".packageignore", (PROJECT / ".packageignore").read_text())
        self.write("package.json", json.dumps({"name": "power-timeline", "version": "1.2.3"}))
        self.write("plugin.json", json.dumps({"name": "Power Timeline"}))
        for name in ("licenses/REBUILD.txt", "licenses/LGPL-2.1.txt", "licenses/assets/NOTICE.txt"):
            self.write(name, "license fixture\n")
        self.write("licenses/decky-api-tsconfig.json", "{}\n")
        self.write("src/index.tsx", "export default 1;\n")
        self.write("src/thermalField.json", "{}\n")
        self.write("py_modules/recorder.py", "pass\n")
        self.write("docs/readme/README.zh-CN.md", "readme\n")
        self.write("dist/index.js", "export default 1;\n")
        for name in ("front-hardware.webp", "front-rotor.webp", "front-fan-front.webp"):
            self.write("src/assets/" + name, b"RIFFfixtureWEBP")
            self.write("dist/" + name, b"RIFFfixtureWEBP")
        self.files = PackageFiles(self.root)
        self.write("dist/notices.json", json.dumps({
            "entries": [{"documents": [{"text": path.read_text()} for path in
                                      [self.root / "LICENSE", *self.files.licenses()]]}],
            "sourceArchive": {"name": "power-timeline-1.2.3-sources.zip",
                              "url": "https://github.com/ZacharyQin/power-timeline/releases/download/v1.2.3/power-timeline-1.2.3-sources.zip"},
        }))

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode() if isinstance(content, str) else content)
        return path

    def sources(self):
        output = self.root / "dist/license-sources.zip"
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in self.files.sources():
                archive.write(path, path.relative_to(self.root).as_posix())
            archive.writestr(API_PREFIX + "package.json", json.dumps({"name": "@decky/api", "version": "1.1.3"}))
            for name in ("LICENSE", "README.md", "tsconfig.json", "src/index.ts", "dist/index.js"):
                archive.writestr(API_PREFIX + name, "fixture\n")
        return output

    def test_archives_keep_build_inputs_but_exclude_design_caches_and_old_packages(self):
        for name in ("src/front-projection.svg", "licenses/assets/steam-deck-oled-thermal.glb",
                     "src/assets/front-hardware.png", "src/debug.js.map", "src/component.tmp.ts", "py_modules/__pycache__/old.py",
                     "src/node_modules/unused/index.ts", "scripts/.pytest_cache/unused.py",
                     "tests/local.sqlite3", "scripts/server.log", "dist/power-timeline-old.zip"):
            self.write(name, "unwanted\n")
        self.sources()
        self.files.validate_sources()
        source_names = {p.relative_to(self.root).as_posix() for p in self.files.sources()}
        self.assertTrue({"src/index.tsx", "src/thermalField.json", "src/assets/front-hardware.webp",
                         ".packageignore", "licenses/LGPL-2.1.txt"}.issubset(source_names))
        self.assertNotIn("src/front-projection.svg", source_names)
        self.assertNotIn("src/component.tmp.ts", source_names)
        self.assertNotIn("src/node_modules/unused/index.ts", source_names)
        self.assertNotIn("scripts/.pytest_cache/unused.py", source_names)
        output, source_output = self.files.package(ref="refs/tags/v1.2.3")
        with zipfile.ZipFile(output) as archive:
            names = set(archive.namelist())
            expected = {"plugin.json", "package.json", "main.py", "LICENSE", "py_modules/recorder.py",
                        "dist/index.js", "dist/notices.json", "dist/front-hardware.webp",
                        "dist/front-rotor.webp", "dist/front-fan-front.webp"}
            self.assertEqual(names, {"power-timeline/" + name for name in expected})
        self.assertEqual(source_output.name, "power-timeline-1.2.3-sources.zip")
        self.assertEqual(source_output.read_bytes(), (self.root / "dist/license-sources.zip").read_bytes())
        self.assertNotIn("src/assets/front-hardware.png", source_names)

    def test_sources_must_match_current_files_before_replacing_a_good_package(self):
        self.sources()
        self.write("src/index.tsx", "export default 2;\n")
        output = self.write("dist/previous.zip", b"last good artifact")
        with self.assertRaisesRegex(ValueError, "stale"):
            self.files.package(output)
        self.assertEqual(output.read_bytes(), b"last good artifact")

    def test_build_tag_must_match_package_version(self):
        self.sources()
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.files.package(ref="refs/tags/v9.9.9")
        self.assertFalse((self.root / "dist/power-timeline-1.2.3.zip").exists())

    def test_excluding_a_required_runtime_image_fails_instead_of_silently_dropping_it(self):
        with (self.root / ".packageignore").open("a") as stream:
            stream.write("dist/front-hardware.webp\n")
        with self.assertRaisesRegex(ValueError, "required archive input is excluded"):
            PackageFiles(self.root).runtime()

    def test_unwanted_or_unsafe_nested_source_members_are_rejected(self):
        for name in ("licenses/assets/steam-deck-oled-thermal.glb", "../outside.py",
                     API_PREFIX + "dist/index.js.map", API_PREFIX + "src/extra.exe"):
            with self.subTest(name=name):
                output = self.sources()
                with zipfile.ZipFile(output, "a") as archive:
                    archive.writestr(name, "unwanted")
                with self.assertRaises(ValueError):
                    self.files.validate_sources()

    def test_duplicate_source_members_are_rejected(self):
        output = self.sources()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(output, "a") as archive:
                archive.writestr("main.py", "duplicate")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.files.validate_sources()

    def test_required_decky_api_sources_cannot_be_omitted(self):
        self.sources()
        output = self.root / "dist/license-sources.zip"
        with zipfile.ZipFile(output) as archive:
            entries = [(i.filename, archive.read(i)) for i in archive.infolist()
                       if i.filename != API_PREFIX + "src/index.ts"]
        with zipfile.ZipFile(output, "w") as archive:
            for name, data in entries:
                archive.writestr(name, data)
        with self.assertRaisesRegex(ValueError, "Decky API rebuild inputs"):
            self.files.validate_sources()

    def test_missing_offline_license_text_blocks_packaging(self):
        self.sources()
        path = self.root / "dist/notices.json"
        data = json.loads(path.read_text())
        data["entries"] = []
        self.write("dist/notices.json", json.dumps(data))
        with self.assertRaisesRegex(ValueError, "missing license material"):
            self.files.package()

    def test_wrong_source_download_identity_blocks_packaging(self):
        self.sources()
        data = json.loads((self.root / "dist/notices.json").read_text())
        data["sourceArchive"]["url"] = "https://example.invalid/wrong.zip"
        self.write("dist/notices.json", json.dumps(data))
        with self.assertRaisesRegex(ValueError, "matching source artifact"):
            self.files.package()

    def test_external_and_inline_source_map_references_cannot_ship(self):
        self.sources()
        for target in ("index.js.map", "data:application/json;base64,e30="):
            with self.subTest(target=target):
                self.write("dist/index.js", "export default 1;\n//# sourceMappingURL=" + target + "\n")
                with self.assertRaisesRegex(ValueError, "source map reference"):
                    self.files.package()

    def test_artifact_paths_cannot_overlap(self):
        self.sources()
        with self.assertRaisesRegex(ValueError, "paths must differ"):
            self.files.package(self.root / "dist/power-timeline-1.2.3-sources.zip")

    def test_cli_reports_the_exact_pair_and_validates_explicit_build_ref(self):
        for name in ("package-plugin.py", "package_files.py"):
            self.write("scripts/" + name, (PROJECT / "scripts" / name).read_text())
        self.sources()
        report = self.root / "outputs.txt"
        environment = dict(os.environ, BUILD_REF="refs/tags/v1.2.3", GITHUB_REF="refs/heads/main",
                           GITHUB_OUTPUT=str(report))
        command = [sys.executable, "scripts/package-plugin.py"]
        result = subprocess.run(command, cwd=self.root, env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        paths = dict(line.split("=", 1) for line in report.read_text().splitlines())
        self.assertEqual(set(paths), {"package_path", "source_path"})
        previous = {name: Path(path).read_bytes() for name, path in paths.items()}
        environment.update(BUILD_REF="refs/tags/v9.9.9", GITHUB_REF="refs/tags/v1.2.3")
        rejected = subprocess.run(command, cwd=self.root, env=environment, capture_output=True, text=True)
        self.assertNotEqual(rejected.returncode, 0)
        for name, path in paths.items():
            self.assertEqual(Path(path).read_bytes(), previous[name])

    def test_source_symlinks_cannot_copy_files_from_outside_project(self):
        outside = Path(self.temp.name) / "outside.ts"
        outside.write_text("private fixture")
        (self.root / "src/outside.ts").symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "inside the project"):
            self.files.sources()


if __name__ == "__main__":
    unittest.main()
