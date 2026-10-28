"""Package the built plugin using the same manifest locally and in CI."""

import argparse
import os
from pathlib import Path

from package_files import PackageFiles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Output ZIP; defaults to dist/power-timeline-VERSION.zip")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    # workflow_dispatch runs from main but must validate the requested build tag.
    ref = os.environ.get("BUILD_REF") or os.environ.get("GITHUB_REF", "")
    output, sources = PackageFiles(root).package(args.output, ref)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            stream.write(f"package_path={output.resolve()}\nsource_path={sources.resolve()}\n")
    for path in (output, sources):
        print(f"{path} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
