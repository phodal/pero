"""Read declarations into a review proposal. No resolver, installer or project import."""
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import re
import sys
import tomllib
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import urlopen

NAMES = ('pyproject.toml', 'uv.lock', '.python-version', 'requirements.txt')
LIMIT = 2 * 1024 * 1024


@dataclass(frozen=True)
class Declaration:
    name: str
    sha256: str
    content: str

    @classmethod
    def parse(cls, name, content):
        if name not in NAMES or len(content) > LIMIT or b'\0' in content:
            raise ValueError('Expected a bounded Python declaration file')
        return cls(name, hashlib.sha256(content).hexdigest(), content.decode('utf-8'))


@dataclass(frozen=True)
class EnvironmentProposal:
    source: str
    declarations: tuple[Declaration, ...]
    python_requests: tuple[str, ...]
    dependencies: tuple[str, ...]
    locked_packages: int
    warnings: tuple[str, ...]
    status: str = 'review_required'

    @classmethod
    def review(cls, source, declarations):
        python, dependencies, warnings = [], [], []
        locked = 0
        for declaration in declarations:
            if declaration.name in ('pyproject.toml', 'uv.lock'):
                value = tomllib.loads(declaration.content)
                if declaration.name == 'pyproject.toml':
                    project = value.get('project', {})
                    requested = project.get('requires-python')
                    if requested is not None:
                        if not isinstance(requested, str): raise ValueError('requires-python must be text')
                        python.append(requested)
                    declared = project.get('dependencies', [])
                    if not isinstance(declared, list) or not all(isinstance(d,str) for d in declared):
                        raise ValueError('project.dependencies must contain dependency strings')
                    dependencies.extend(declared)
                    if project.get('dynamic') or project.get('optional-dependencies') or value.get('dependency-groups'):
                        warnings.append('Dynamic, optional and grouped dependencies need an explicit selection.')
                    if value.get('build-system') or value.get('tool', {}).get('uv', {}).get('sources'):
                        warnings.append('Build hooks and custom sources are declarations only; none were executed.')
                else:
                    packages = value.get('package', [])
                    if not isinstance(packages, list): raise ValueError('uv.lock package records must be a list')
                    locked = len(packages)
                    if value.get('requires-python'): python.append(str(value['requires-python']))
                    warnings.append('The saved lock is identified by its digest; platform compatibility and wheel availability are unverified.')
            elif declaration.name == '.python-version':
                python.extend(line.strip() for line in declaration.content.splitlines() if line.strip() and not line.lstrip().startswith('#'))
            else:
                for line in declaration.content.splitlines():
                    line = line.strip()
                    if not line or line.startswith('#'): continue
                    if line.startswith('-') or '\\' in line or '://' in line or '@' in line:
                        warnings.append('Requirements options, includes, URLs and continuations require manual review: ' + line[:180])
                    else:
                        dependencies.append(line.split(' #', 1)[0])
        if not declarations: raise ValueError('No pyproject.toml, uv.lock, .python-version or requirements.txt found')
        if len(set(python)) > 1:
            warnings.append('Multiple Python declarations are shown together; their compatibility has not been resolved.')
        warnings.append('Review the declarations before choosing a fixed compute recipe. Inspecting does not create or install an environment.')
        return cls(source, tuple(declarations), tuple(dict.fromkeys(python)),
                   tuple(dict.fromkeys(dependencies)), locked, tuple(dict.fromkeys(warnings)))

    def to_dict(self):
        value = asdict(self)
        # Source bytes stay local; the proposal carries exact identities and parsed requests.
        value['declarations'] = [dict(name=d.name, sha256=d.sha256) for d in self.declarations]
        value['digest'] = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        return value


def inspect(source):
    parsed = urlparse(source)
    documents = []
    if parsed.scheme:
        match = re.fullmatch(r'/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/tree/([0-9a-f]{40})(/[^?#]*)?', parsed.path)
        if parsed.scheme != 'https' or parsed.netloc != 'github.com' or parsed.query or parsed.fragment or not match:
            raise ValueError('Use https://github.com/OWNER/REPO/tree/FULL_COMMIT[/DIRECTORY]')
        owner, repo, revision, suffix = match.groups()
        if '..' in (suffix or '').split('/') or '%' in (suffix or ''):
            raise ValueError('Use a literal repository directory without traversal')
        for name in NAMES:
            url = f'https://raw.githubusercontent.com/{owner}/{repo}/{revision}{suffix or ""}/{name}'
            try:
                with urlopen(url, timeout=15) as response:
                    content = response.read(LIMIT + 1)
            except HTTPError as error:
                if error.code == 404: continue
                raise
            documents.append(Declaration.parse(name, content))
    else:
        root = Path(source).expanduser().resolve(strict=True)
        if not root.is_dir(): raise ValueError('Choose a project directory')
        source = str(root)
        for name in NAMES:
            path = root / name
            if not path.exists(): continue
            if path.is_symlink() or not path.is_file(): raise ValueError('Declaration files must be regular files')
            with path.open('rb') as stream: content = stream.read(LIMIT + 1)
            documents.append(Declaration.parse(name, content))
    return EnvironmentProposal.review(source, documents)


if __name__ == '__main__':
    print(json.dumps(inspect(sys.argv[1]).to_dict(), ensure_ascii=False))
