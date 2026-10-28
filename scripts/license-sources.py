"""Emit matching application and LGPL library source as a build asset."""
import io
import sys
import zipfile
from pathlib import Path

from package_files import PackageFiles

root = Path(__file__).resolve().parents[1]
api = Path(sys.argv[1]).resolve()
files = PackageFiles(root)
output = io.BytesIO()
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for source in files.sources():
        archive.write(source, source.relative_to(root).as_posix())
    for source, name in files.api_sources(api):
        archive.write(source, name)
    archive.write(root / "licenses/decky-api-tsconfig.json", "third-party/decky-api/tsconfig.json")
sys.stdout.buffer.write(output.getvalue())
