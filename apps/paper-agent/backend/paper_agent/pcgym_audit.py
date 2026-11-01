"""One pinned paper/code audit. Fetching is separate; source code is never executed."""
import ast
from dataclasses import asdict, dataclass
import hashlib
import json

from .reproduction import COMMIT, PAPER, ReproductionError, digest

REPOSITORY = 'https://github.com/MaximilianB2/pc-gym'
PREFIX = 'pc-gym_paper/constraint_showcase/'
SOURCE_PINS = {
    'experiment': (PREFIX + 'constraint_paper.py', '1c0398a213dadfe71dbcd8642bd86e27e6edc56a'),
    'metric': (PREFIX + 'constraint_violation_vis.py', '865fbe351d39ac71b0a39880c284aa80b9e9f07f'),
    'reward': (PREFIX + 'custom_reward.py', '284967c39bfd7b444378810373cb805f9584c914'),
}
EXPECTED_ARTIFACTS = ('constraint_rollout_data.npy', 'norm_rollout_data.npy',
                      'DDPG_constraint.zip', 'DDPG_norm.zip')


def source_url(key):
    if key == 'tree':
        return f'https://api.github.com/repos/MaximilianB2/pc-gym/git/trees/{COMMIT}?recursive=1'
    if key not in SOURCE_PINS:
        raise ReproductionError('source', 'Choose experiment, metric, reward, or tree')
    return f'https://raw.githubusercontent.com/MaximilianB2/pc-gym/{COMMIT}/{SOURCE_PINS[key][0]}'


@dataclass(frozen=True)
class SourceEvidence:
    key: str
    url: str
    sha256: str
    git_blob: str | None
    text: str

    @property
    def id(self):
        return digest(asdict(self))

    @classmethod
    def capture(cls, key, url, text):
        expected_url = source_url(key)
        if url != expected_url or not isinstance(text, str) or '\ufffd' in text or '\x00' in text:
            raise ReproductionError('source_identity', 'Source identity or UTF-8 content could not be verified')
        raw = text.encode('utf-8')
        if len(raw) > 1024 * 1024:
            raise ReproductionError('source_size', 'Source exceeds the inspection limit')
        blob = None
        if key != 'tree':
            blob = hashlib.sha1(f'blob {len(raw)}\0'.encode() + raw).hexdigest()
            if blob != SOURCE_PINS[key][1]:
                raise ReproductionError('source_changed', 'Source bytes differ from the reviewed pinned Git blob')
            ast.parse(text)
        else:
            tree = json.loads(text)
            if tree.get('truncated') is not False or not isinstance(tree.get('tree'), list):
                raise ReproductionError('tree_incomplete', 'A complete repository tree is required')
            if len(tree['tree']) > 20000 or any(not isinstance(x.get('path'), str) for x in tree['tree']):
                raise ReproductionError('tree_shape', 'Repository tree is invalid or too large')
        return cls(key, url, hashlib.sha256(raw).hexdigest(), blob, text)

    def locator(self, start=None, end=None):
        if self.key == 'tree':
            return dict(url=self.url, source_digest=self.sha256, kind='repository-tree')
        path = SOURCE_PINS[self.key][0]
        return dict(url=f'{REPOSITORY}/blob/{COMMIT}/{path}', commit=COMMIT,
                    path=path, source_digest=self.sha256, git_blob=self.git_blob,
                    start_line=start, end_line=end)


@dataclass(frozen=True)
class AuditFinding:
    code: str
    severity: str
    detail: str
    locators: tuple[dict, ...]

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class CodeAudit:
    claim_id: str
    source_ids: tuple[str, ...]
    findings: tuple[AuditFinding, ...]
    status: str

    @property
    def id(self):
        return digest(self.to_dict())

    def to_dict(self):
        return dict(claim_id=self.claim_id, source_ids=list(self.source_ids),
                    findings=[f.to_dict() for f in self.findings], status=self.status,
                    commit=COMMIT, original_artifacts='not-established',
                    paper_code_version_match='unverified', scientific_acceptance='unverified')


def audit_sources(claim_id, sources):
    sources = tuple(sources)
    by_key = {s.key: s for s in sources}
    if len(by_key) != len(sources) or set(by_key) != set(SOURCE_PINS) | {'tree'}:
        raise ReproductionError('audit_sources', 'Inspect all four pinned source objects first')
    findings = []
    metric = by_key['metric']
    function = next((n for n in ast.walk(ast.parse(metric.text))
                     if isinstance(n, ast.FunctionDef) and n.name == 'violation_rate'), None)
    point_mean = function and any(isinstance(n, ast.Return) and isinstance(n.value, ast.Call)
        and isinstance(n.value.func, ast.Attribute) and n.value.func.attr == 'mean'
        and len(n.value.args) == 1 and isinstance(n.value.args[0], ast.Name)
        and n.value.args[0].id == 'violations' and not n.value.keywords for n in ast.walk(function))
    findings.append(AuditFinding('metric-grain', 'blocking',
        'Eq. 37 describes one indicator per trajectory; violation_rate averages all supplied sample flags.'
        if point_mean else 'The metric implementation could not be classified; do not assume compatibility.',
        (metric.locator(function.lineno, function.end_lineno) if function else metric.locator(),
         dict(url='https://arxiv.org/html/2410.22093v4#S6.E37', paper=PAPER, page=20, equation=37))))
    experiment = by_key['experiment']
    tree = ast.parse(experiment.text)
    alias = next((n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                  and any(isinstance(t, ast.Name) and t.id == 'env_params' for t in n.targets)
                  and isinstance(n.value, ast.Name) and n.value.id == 'env_params_con'), None)
    if alias:
        findings.append(AuditFinding('shared-config', 'risk',
            'env_params aliases env_params_con before pop calls. Runtime impact depends on environment ownership; '
            'a revised rerun must use independent dictionaries and record that change.',
            (experiment.locator(alias.lineno, alias.end_lineno),)))
    reward = by_key['reward']
    bounds = next((n for n in ast.walk(ast.parse(reward.text)) if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Tuple) and [getattr(x, 'id', '') for x in t.elts]
                           == ['lower_bound', 'upper_bound'] for t in n.targets)), None)
    if bounds:
        findings.append(AuditFinding('bound-order', 'risk',
            'The source assigns [327, 321] to lower_bound, upper_bound. This is not the ordering of the paper bounds; '
            'the revised runner uses explicit inequality constraints, without relabeling the original experiment.',
            (reward.locator(bounds.lineno, bounds.end_lineno),)))
    paths = {entry['path'] for entry in json.loads(by_key['tree'].text)['tree']}
    missing = [PREFIX + name for name in EXPECTED_ARTIFACTS if PREFIX + name not in paths]
    if missing:
        findings.append(AuditFinding('original-artifacts', 'blocking',
            'Not found at the expected paths in the inspected commit: ' + ', '.join(missing)
            + '. This does not establish absence from other archives or author releases.',
            (by_key['tree'].locator(),)))
    findings.append(AuditFinding('paper-code-version', 'limitation',
        'The inspected commit is not established as the exact implementation used for arXiv v4. '
        'Newly trained policies are a new experiment, not recovered original checkpoints.',
        (experiment.locator(),)))
    return CodeAudit(claim_id, tuple(s.id for s in sources), tuple(findings), 'audited-with-gaps')


def case_summary():
    return dict(case_id='pcgym-cstr-table6-v1', paper=PAPER,
                paper_url='https://arxiv.org/abs/2410.22093v4', page=20, table=6, equation=37,
                repository=REPOSITORY, commit=COMMIT,
                reported=dict(zip(('base', 'shaped', 'oracle'), (0.0727, 0.0003, 0.0))),
                sources={key: source_url(key) for key in (*SOURCE_PINS, 'tree')},
                metric_grains=['episode-any', 'sample-fraction'],
                original_reproduction='blocked-pending-metric-and-artifact-resolution',
                profiles=['integration-smoke', 'audited-rerun'],
                note='Case metadata is not an observed PDF passage or a completed experiment.')
