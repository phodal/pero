"""Opt-in installed-distribution SBOM and PyPI version-advisory observation.

This inventories Python wheels, not bundled JavaScript/native libraries or a
complete product. A missing advisory is not a security clearance.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
from pathlib import Path
import platform
import sys
from urllib.parse import quote
from urllib.request import urlopen

output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=False)
components = []
for distribution in sorted(metadata.distributions(), key=lambda item: item.metadata['Name'].lower()):
    name, version = distribution.metadata['Name'], distribution.version
    licenses = []
    for item in distribution.files or ():
        if any(word in str(item).lower() for word in ('license', 'notice', 'copying')):
            path = distribution.locate_file(item)
            if path.is_file():
                licenses.append(dict(path=str(item), sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    record = (distribution.read_text('RECORD') or '').encode()
    components.append(dict(type='library', name=name, version=version,
        purl=f'pkg:pypi/{name.lower().replace("_", "-")}@{version}',
        properties=[dict(name='pero:installed-RECORD-sha256', value=hashlib.sha256(record).hexdigest()),
                    dict(name='pero:license-files', value=json.dumps(licenses)),
                    dict(name='pero:license-metadata', value=distribution.metadata.get('License-Expression') or
                         distribution.metadata.get('License', '')[:1000])]))
stamp = datetime.now(timezone.utc).isoformat()
(output/'sbom.cdx.json').write_text(json.dumps(dict(bomFormat='CycloneDX', specVersion='1.6', version=1,
    metadata=dict(timestamp=stamp), components=components), indent=2))
(output/'requirements.lock').write_text(''.join(f'{item["name"]}=={item["version"]}\n' for item in components))


def advisories(component):
    url = f'https://pypi.org/pypi/{quote(component["name"])}/{quote(component["version"])}/json'
    try:
        with urlopen(url, timeout=20) as response:
            value = json.load(response)
        return dict(name=component['name'], version=component['version'], url=url,
                    status='queried', vulnerabilities=value.get('vulnerabilities', []))
    except Exception as error:
        return dict(name=component['name'], version=component['version'], url=url,
                    status='unavailable', reason=str(error))


with ThreadPoolExecutor(max_workers=6) as pool:
    results = list(pool.map(advisories, components))
(output/'advisories.json').write_text(json.dumps(dict(observedAt=stamp, python=sys.version,
    platform=platform.platform(), scope='PyPI per-version advisories; not a complete vulnerability scan',
    results=results), indent=2))
print(json.dumps(dict(packages=len(components), unavailable=sum(r['status']=='unavailable' for r in results),
    flagged=[dict(name=r['name'], ids=[v['id'] for v in r.get('vulnerabilities', [])])
             for r in results if r.get('vulnerabilities')])))
