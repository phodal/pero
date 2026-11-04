#!/usr/bin/env python3
"""Audit the fixed macOS wheels without installing or executing their code.

Requires packaging in the verifier's own Python. Network access is opt-in:
  python tools/verify_docling_macos_wheels.py --wheel-dir /path/to/wheels
  python tools/verify_docling_macos_wheels.py --wheel-dir /path/to/wheels \
      --download --check-pypi
This is a manually invoked audit tool, never called by the App or installer.
Native imports, Apple Vision OCR and PDF conversion still require a real Mac.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from email import message_from_bytes
import hashlib
import json
from pathlib import Path
import struct
from urllib.request import urlopen
from zipfile import ZipFile

from packaging.requirements import Requirement
from packaging.specifiers import SpecifierSet
from packaging.tags import compatible_tags, cpython_tags, mac_platforms, parse_tag
from packaging.utils import canonicalize_name, parse_wheel_filename


ROOT = Path(__file__).resolve().parents[3]
FLOOR = (14, 0, 0)
ENVIRONMENT = {
    "implementation_name": "cpython", "implementation_version": "3.12.0",
    "os_name": "posix", "platform_machine": "arm64",
    "platform_release": "23.0.0", "platform_system": "Darwin",
    "platform_version": "Darwin Kernel Version 23.0.0",
    "platform_python_implementation": "CPython", "python_full_version": "3.12.0",
    "python_version": "3.12", "sys_platform": "darwin", "extra": "",
}


def arm64_load_commands(data):
    """Read arm64 Mach-O load commands, including universal2 slices."""
    magic = data[:4]
    if magic in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
        fat64 = magic == b"\xca\xfe\xba\xbf"
        count = struct.unpack_from(">I", data, 4)[0]
        result = []
        for index in range(count):
            position = 8 + index * (32 if fat64 else 20)
            cpu = struct.unpack_from(">I", data, position)[0]
            offset, size = struct.unpack_from(">QQ" if fat64 else ">II", data, position + 8)
            if cpu == 0x100000C:
                result.extend(arm64_load_commands(data[offset:offset + size]))
        return result
    if magic not in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe"):
        return []
    if struct.unpack_from("<I", data, 4)[0] != 0x100000C:
        return []
    count = struct.unpack_from("<I", data, 16)[0]
    position = 32 if magic == b"\xcf\xfa\xed\xfe" else 28
    result = []
    for _ in range(count):
        command, size = struct.unpack_from("<II", data, position)
        result.append((command, data[position:position + size]))
        position += size
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel-dir", required=True, type=Path)
    parser.add_argument("--download", action="store_true", help="Download missing pinned wheels only")
    parser.add_argument("--check-pypi", action="store_true", help="Recheck each exact official release record")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "crates/pero-runtime/src/apps/docling-wheels-macos-arm64.json").read_text())
    requirement_lines = (ROOT / "apps/paper-agent/requirements-docling-macos-arm64.txt").read_text().splitlines()
    pins = dict((canonicalize_name(name), version) for name, version in (
        line.split("==") for line in requirement_lines if line and not line.startswith("#")
    ))
    platforms = list(mac_platforms(FLOOR[:2], "arm64"))
    target_tags = set(cpython_tags((3, 12), abis=["cp312"], platforms=platforms))
    target_tags.update(compatible_tags((3, 12), "cp312", platforms=platforms))
    if args.download:
        args.wheel_dir.mkdir(parents=True, exist_ok=True)

    def inspect(wheel):
        filename = wheel["filename"]
        name, version, _, tags = parse_wheel_filename(filename)
        assert pins[name] == str(version), f"Unpinned version: {filename}"
        assert tags & target_tags, f"Incompatible wheel: {filename}"
        assert wheel["url"].startswith("https://files.pythonhosted.org/packages/")
        if args.check_pypi:
            with urlopen(f"https://pypi.org/pypi/{name}/{version}/json", timeout=120) as response:
                release = json.load(response)
            official = next(item for item in release["urls"] if item["filename"] == filename)
            assert not official["yanked"], f"Yanked wheel: {filename}"
            assert official["url"] == wheel["url"]
            assert official["digests"]["sha256"] == wheel["sha256"]
            assert official["size"] == wheel["size"]
        path = args.wheel_dir / filename
        if not path.exists() and args.download:
            with urlopen(wheel["url"], timeout=120) as response:
                path.write_bytes(response.read())
        data = path.read_bytes()
        assert len(data) == wheel["size"], f"Size mismatch: {filename}"
        assert hashlib.sha256(data).hexdigest() == wheel["sha256"], f"Hash mismatch: {filename}"
        binaries, libraries, non_system_rpaths = [], [], []
        with ZipFile(path) as archive:
            metadata_path = next(item for item in archive.namelist() if item.endswith(".dist-info/METADATA"))
            metadata = message_from_bytes(archive.read(metadata_path))
            assert canonicalize_name(metadata["Name"]) == name
            assert metadata["Version"] == str(version)
            assert "3.12.0" in SpecifierSet(metadata.get("Requires-Python", ""))
            wheel_metadata = message_from_bytes(archive.read(metadata_path.removesuffix("METADATA") + "WHEEL"))
            declared_tags = set().union(*(parse_tag(tag) for tag in wheel_metadata.get_all("Tag")))
            assert declared_tags & target_tags, f"Incompatible WHEEL metadata: {filename}"
            unpacked_bytes = sum(item.file_size for item in archive.infolist())
            for item in archive.namelist():
                if item.endswith((".so", ".dylib")):
                    versions = []
                    for command, data in arm64_load_commands(archive.read(item)):
                        if command in (0x24, 0x32):  # Deployment target
                            version = struct.unpack_from("<I", data, 12 if command == 0x32 else 8)[0]
                            versions.append((version >> 16, (version >> 8) & 255, version & 255))
                        elif command in (0xC, 0x80000018, 0x8000001F, 0x20, 0x80000023, 0x8000001C):
                            offset = struct.unpack_from("<I", data, 8)[0]
                            library = data[offset:].split(b"\0", 1)[0].decode()
                            relative = any(library == prefix or library.startswith(prefix + "/")
                                           for prefix in ("@rpath", "@loader_path", "@executable_path"))
                            system = library.startswith(("/usr/lib/", "/System/Library/"))
                            if command == 0x8000001C:  # LC_RPATH, not a dependency
                                if not relative and not system:
                                    non_system_rpaths.append({"binary": item, "path": library})
                            else:
                                assert relative or system, f"Non-system dylib dependency: {filename}/{item}: {library}"
                                libraries.append(library)
                    if versions:
                        assert max(versions) <= FLOOR, f"macOS >14 required: {filename}/{item}"
                        binaries.append((item, max(versions)))
        return name, metadata, binaries, unpacked_bytes, libraries, non_system_rpaths

    with ThreadPoolExecutor(max_workers=8) as workers:
        results = list(workers.map(inspect, manifest))
    assert len(results) == len(pins) == len({result[0] for result in results})
    metadata = {name: info for name, info, *_ in results}
    extras = {name: {""} for name in pins}
    extras["docling-slim"].update(("convert-core", "format-pdf", "models-local", "feat-ocr-mac"))
    changed = True
    while changed:
        changed = False
        for name, info in metadata.items():
            for value in info.get_all("Requires-Dist", []):
                requirement = Requirement(value)
                if requirement.marker and not any(
                    requirement.marker.evaluate(ENVIRONMENT | {"extra": extra}) for extra in extras[name]
                ):
                    continue
                dependency = canonicalize_name(requirement.name)
                assert dependency in pins, f"Missing dependency: {name} needs {requirement}"
                assert pins[dependency] in requirement.specifier, f"Version conflict: {name} needs {requirement}"
                if not requirement.extras.issubset(extras[dependency]):
                    extras[dependency].update(requirement.extras)
                    changed = True
    print(json.dumps({
        "profile": "macos-arm64-cp312", "minimumMacOS": "14.0",
        "wheels": len(results), "downloadBytes": sum(wheel["size"] for wheel in manifest),
        "unpackedWheelBytes": sum(result[3] for result in results),
        "arm64MachOBinaries": sum(len(result[2]) for result in results),
        "nativeDylibLoadReferences": sum(len(result[4]) for result in results),
        "nonSystemDylibDependencies": [],
        "nonSystemRpaths": [entry for result in results for entry in result[5]],
        "checks": ["sha256", "size", "CPython312 tags", "Requires-Python", "Requires-Dist closure", "Mach-O deployment targets", "dylib load paths"],
        "nativeExecutionTested": False,
    }, indent=2))


if __name__ == "__main__":
    main()
