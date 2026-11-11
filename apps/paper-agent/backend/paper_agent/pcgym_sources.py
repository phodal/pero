"""Read and audit a fixed PC-Gym checkout without importing or executing it."""
from dataclasses import dataclass
import ast
import hashlib
from importlib import metadata
from pathlib import Path
import subprocess

from .pcgym_domain import COMMIT, UPSTREAM, REQUIRED_PACKAGES, Invalid, canonical, digest

CASE = 'pc-gym_paper/constraint_showcase/'
PINS = {
    CASE + 'constraint_paper.py': '1c0398a213dadfe71dbcd8642bd86e27e6edc56a',
    CASE + 'constraint_violation_vis.py': '865fbe351d39ac71b0a39880c284aa80b9e9f07f',
    CASE + 'custom_reward.py': '284967c39bfd7b444378810373cb805f9584c914',
    'src/pcgym/policy_evaluation.py': '2f7f1dfe913a2b73b0636677d6fc352e7809f4e0',
}


@dataclass(frozen=True)
class SourceFile:
    path: str
    text: str
    blob: str
    sha256: str

    @classmethod
    def parse(cls, path, content: bytes, expected_blob=None):
        if path not in PINS or len(content) > 256 * 1024 or b'\0' in content:
            raise Invalid('source_file', 'Only bounded, known case source files are accepted')
        blob = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
        if expected_blob is not None and blob != expected_blob:
            raise Invalid('source_changed', f'Pinned source bytes do not match: {path}')
        try:
            text = content.decode('utf-8', errors='strict')
            ast.parse(text)
        except (UnicodeError, SyntaxError) as error:
            raise Invalid('source_parse', f'Cannot statically inspect {path}') from error
        return cls(path, text, blob, hashlib.sha256(content).hexdigest())

    def locator(self, node):
        return {'url': f'{UPSTREAM}/blob/{COMMIT}/{self.path}', 'path': self.path,
                'commit': COMMIT, 'git_blob': self.blob, 'sha256': self.sha256,
                'start_line': node.lineno, 'end_line': getattr(node, 'end_lineno', node.lineno)}

    def manifest(self):
        return {'path': self.path, 'git_blob': self.blob, 'sha256': self.sha256}


def git(checkout, *args):
    result = subprocess.run(['git', '-C', str(checkout), *args], capture_output=True,
                            text=True, timeout=15, check=False)
    if result.returncode != 0:
        raise Invalid('checkout', 'Cannot inspect the supplied checkout: ' + result.stderr[:400])
    return result.stdout.strip()


def read_checkout(path):
    root = Path(path).absolute()
    if root.is_symlink() or root.resolve() != root or not root.is_dir():
        raise Invalid('checkout', 'Use an existing canonical, non-symlink checkout path')
    if git(root, 'rev-parse', 'HEAD') != COMMIT:
        raise Invalid('revision', f'This case requires upstream commit {COMMIT}')
    if git(root, 'rev-parse', '--show-toplevel') != str(root):
        raise Invalid('checkout', 'Supply the repository root, not a child directory')
    if git(root, 'status', '--porcelain', '--untracked-files=all', '--', 'src', CASE):
        raise Invalid('dirty_checkout', 'Case source and src must be unchanged and contain no untracked files')
    files = []
    for name, blob in PINS.items():
        target = root / name
        if target.resolve() != target or not target.is_file():
            raise Invalid('source_path', f'Missing or linked source: {name}')
        files.append(SourceFile.parse(name, target.read_bytes(), blob))
    manifest = {'repository': UPSTREAM, 'commit': COMMIT,
                'core_tree': git(root, 'rev-parse', 'HEAD:src/pcgym'),
                'files': [f.manifest() for f in files]}
    return root, tuple(files), manifest


def package_inventory():
    result = {}
    for name in REQUIRED_PACKAGES:
        try:
            result[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            result[name] = 'MISSING'
    return result


def audit_sources(files, *, pinned=False):
    """Return evidence-linked static findings, not a generic 'verified' badge."""
    observed = {source.path: source for source in files}
    if set(observed) != set(PINS):
        raise Invalid('source_coverage', 'All four declared case files are needed for this audit')
    findings = []
    metric = observed[CASE + 'constraint_violation_vis.py']
    mean = next((n for n in ast.walk(ast.parse(metric.text))
                 if isinstance(n, ast.Return) and isinstance(n.value, ast.Call)
                 and ast.unparse(n.value) == 'np.mean(violations)'), None)
    if mean is not None:
        findings.append({'id': 'metric-grain', 'severity': 'blocking-interpretation',
                         'status': 'mismatch', 'paper_locator': 'Section 6.3 / Equation 37',
                         'detail': 'Paper declares an episode indicator; code averages the sample mask without an axis.',
                         'code': metric.locator(mean)})
    reward = observed[CASE + 'custom_reward.py']
    nodes = list(ast.walk(ast.parse(reward.text)))
    bounds = next((n for n in nodes if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'cons' for t in n.targets)), None)
    unpack = next((n for n in nodes if isinstance(n, ast.Assign)
                   and ast.unparse(n.targets[0]) == '(lower_bound, upper_bound)'), None)
    if bounds is not None and unpack is not None and ast.literal_eval(bounds.value).get('T') == [327, 321]:
        findings.append({'id': 'reward-bound-order', 'severity': 'method-review', 'status': 'mismatch',
                         'detail': 'Declared <=327 / >=321 bounds are unpacked as lower=327, upper=321. '
                                   'The unmodified reward can penalize an in-bound temperature. This is not a claim about unpublished training.',
                         'code': reward.locator(unpack), 'declaration': reward.locator(bounds)})
    train = observed[CASE + 'constraint_paper.py']
    tnodes = list(ast.walk(ast.parse(train.text)))
    alias = next((n for n in tnodes if isinstance(n, ast.Assign)
                  and ast.unparse(n.value) == 'env_params_con'
                  and ast.unparse(n.targets[0]) == 'env_params'), None)
    if alias is not None:
        findings.append({'id': 'shared-environment-dictionary', 'severity': 'replay-deviation', 'status': 'risk',
                         'detail': 'Both variable names refer to one dictionary before pop calls. The replay driver deep-copies '
                                   'configuration and explicitly reports that adaptation.', 'code': train.locator(alias)})
    ddpg = [n for n in tnodes if isinstance(n, ast.Call) and ast.unparse(n.func) == 'DDPG']
    if ddpg and all('seed' not in {k.arg for k in n.keywords} for n in ddpg):
        findings.append({'id': 'unfixed-training-seed', 'severity': 'reproducibility-gap', 'status': 'unverified',
                         'detail': 'The published training calls do not specify a seed; a new seed must be registered '
                                   'as a researcher choice, not recovered author state.', 'code': train.locator(ddpg[0])})
    coverage = {'metric-grain', 'reward-bound-order', 'shared-environment-dictionary', 'unfixed-training-seed'}
    if set(f['id'] for f in findings) != coverage:
        raise Invalid('audit_coverage', 'Expected case structures were not observed; do not reuse old findings')
    return {'schema': 'pero.pcgym.audit.v1', 'commit': COMMIT,
            'source_status': 'pinned-bytes-observed' if pinned else 'synthetic-fixture',
            'paper_status': 'curated-reference-not-a-study-observation',
            'findings': findings, 'source_manifest': [f.manifest() for f in files],
            'paper_verdict': 'INCONCLUSIVE'}


def pipeline_digest():
    root = Path(__file__).resolve().parent
    return digest({name: hashlib.sha256((root / name).read_bytes()).hexdigest()
                   for name in ('pcgym_domain.py', 'pcgym_sources.py', 'pcgym_runtime.py', 'pcgym.py', 'scientific_python.py', '../pero_scientific.py')})
