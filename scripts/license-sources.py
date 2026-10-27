"""Emit matching application and LGPL library source as a build asset."""
import io
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
api = Path(sys.argv[1]).resolve()
output = io.BytesIO()
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in ("package.json", "pnpm-lock.yaml", "plugin.json", "tsconfig.json",
                 "rollup.config.js", "LICENSE", "CHANGELOG.md", "README.md", "main.py"):
        archive.write(root / name, name)
    for directory in ("src", "py_modules", "scripts", "tests", "licenses", "docs/readme"):
        for source in sorted((root / directory).rglob("*")):
            if source.is_file() and "__pycache__" not in source.parts:
                archive.write(source, source.relative_to(root).as_posix())
    for name in ("package.json", "LICENSE", "README.md", "src", "dist"):
        source = api / name
        sources = sorted(source.rglob("*")) if source.is_dir() else [source]
        for item in sources:
            if item.is_file():
                archive.write(item, "third-party/decky-api/" + item.relative_to(api).as_posix())
    archive.write(root / "licenses/decky-api-tsconfig.json", "third-party/decky-api/tsconfig.json")
sys.stdout.buffer.write(output.getvalue())
