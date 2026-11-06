"""Download the pinned upstream release into the App data directory.

The release is the GitHub archive of one commit. Preparation runs this module.
The weight in that commit is a normal blob, checked with the rest of the checkout.
"""
import io
import os
from pathlib import Path
import shutil
import sys
import tarfile
import urllib.request

from .domain import COMMIT, UPSTREAM, Invalid
from .rerun import pinned_tables, verify_checkout

ARCHIVE_URL = f'https://codeload.github.com/xtalpi-inc/lcms2yield/tar.gz/{COMMIT}'
_ROOT_PREFIX = f'lcms2yield-{COMMIT}/'


def release_directory(data_root):
    return Path(data_root) / 'upstream'


def ensure_release(data_root):
    """Return the extracted release, downloading it when the pinned bytes are absent."""
    data_root = Path(data_root)
    destination = release_directory(data_root)
    if _ready(destination):
        return destination
    print(f'downloading {UPSTREAM}@{COMMIT[:12]}', flush=True)
    staging = data_root / 'upstream.partial'
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    try:
        extract_archive(_get(ARCHIVE_URL), staging)
        pinned_tables(verify_checkout(staging))
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    if destination.exists():
        shutil.rmtree(destination)
    staging.rename(destination)
    print(f'release ready {destination}', flush=True)
    return destination


def extract_archive(blob, destination):
    """Unpack one commit archive. Members must stay inside that commit prefix."""
    destination = Path(destination)
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as archive:
        selected = []
        for member in archive.getmembers():
            relative = _relative(member.name)
            if relative is None:
                continue
            member.name = relative.as_posix()
            selected.append(member)
        try:
            archive.extractall(destination, members=selected, filter='data')
        except tarfile.FilterError as error:
            raise Invalid('asset', 'The release archive contains an unsupported member') from error


def _relative(name):
    if name in (f'lcms2yield-{COMMIT}', _ROOT_PREFIX) or name.endswith('/'):
        return None
    if not name.startswith(_ROOT_PREFIX):
        raise Invalid('asset', 'Archive member is outside the pinned release')
    relative = name[len(_ROOT_PREFIX):]
    parts = Path(relative).parts
    if not parts or any(part in ('', '.', '..') for part in parts):
        raise Invalid('asset', 'Archive member is outside the pinned release')
    return Path(*parts)


def _ready(destination):
    try:
        pinned_tables(verify_checkout(destination))
    except (Invalid, OSError):
        return False
    return True


def _get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'pero-lcms2yield'})
    try:
        response = urllib.request.urlopen(request, timeout=60)
    except OSError as error:
        raise Invalid('asset', f'Could not download the pinned release: {error}') from error
    with response:
        return response.read()


def main():
    raw = os.environ.get('PERO_APP_DATA')
    if not raw:
        raise SystemExit('PERO_APP_DATA is not set')
    ensure_release(Path(raw))


if __name__ == '__main__':
    try:
        main()
    except Invalid as error:
        print(error.detail, file=sys.stderr)
        raise SystemExit(1)
