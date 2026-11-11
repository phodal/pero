"""Pinned source license files and Cargo-lock advisory observation, never binary clearance."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import tomllib
from urllib.error import HTTPError
from urllib.request import Request, urlopen

output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=False)
pins = {
    'marimo-team/marimo': 'b0e402345e0a0c0731e745c8e1183ef0840804b2',
    'jupyterlab/jupyterlab': '8d57791d0254820dfa4a540e010105803e128bcd',
    'jupyterlab/jupyter-ai': '995b53b651c39bf9a7744bfe0d2d85b0967b672c',
    'nteract/nteract': '9c85319021bdcd4b03bdfe010ccb4bbc4dc8ed57',
}
files = []
for repo, commit in pins.items():
    for path in ['LICENSE', 'NOTICE'] + (['Cargo.lock', 'crates/runtimed-wasm/LICENSE', 'crates/sift-wasm/LICENSE'] if repo == 'nteract/nteract' else []):
        url = f'https://raw.githubusercontent.com/{repo}/{commit}/{path}'
        try:
            with urlopen(url, timeout=20) as response: content = response.read()
        except HTTPError as error:
            if error.code != 404: raise
            files.append(dict(repo=repo, commit=commit, path=path, url=url, status='absent'))
            continue
        name = repo.split('/')[-1]+'-'+path.replace('/', '-')
        (output/name).write_bytes(content)
        files.append(dict(repo=repo, commit=commit, path=path, url=url, status='read',
                          sha256=hashlib.sha256(content).hexdigest()))
(output/'files.json').write_text(json.dumps(files, indent=2))
packages = tomllib.loads((output/'nteract-Cargo.lock').read_text())['package']
components = [dict(type='library', name=p['name'], version=p['version'],
    properties=[dict(name='pero:source', value=p.get('source', 'workspace'))],
    **(dict(purl=f'pkg:cargo/{p["name"]}@{p["version"]}') if p.get('source', '').startswith('registry') else {})) for p in packages]
(output/'nteract-source-sbom.cdx.json').write_text(json.dumps(dict(bomFormat='CycloneDX', specVersion='1.6',
    version=1, components=components), indent=2))
registry = [p for p in packages if p.get('source', '').startswith('registry')]
results = []
for start in range(0, len(registry), 500):
    batch = registry[start:start+500]
    request = Request('https://api.osv.dev/v1/querybatch', headers={'Content-Type':'application/json'},
        data=json.dumps(dict(queries=[dict(package=dict(name=p['name'], ecosystem='crates.io'), version=p['version']) for p in batch])).encode())
    try:
        with urlopen(request, timeout=30) as response: observed = json.load(response)['results']
        results.extend(dict(name=p['name'], version=p['version'], status='queried', **r) for p,r in zip(batch, observed, strict=True))
    except Exception as error:
        results.extend(dict(name=p['name'], version=p['version'], status='unavailable', reason=str(error)) for p in batch)
(output/'nteract-source-advisories.json').write_text(json.dumps(dict(observedAt=datetime.now(timezone.utc).isoformat(),
    scope='all registry packages in pinned Cargo.lock; may include code absent from downloaded binaries', results=results), indent=2))
print(json.dumps(dict(lockPackages=len(packages), registryPackages=len(registry),
    unavailable=sum(r['status']=='unavailable' for r in results), flagged=[r for r in results if r.get('vulns')])))
