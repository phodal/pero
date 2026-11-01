"""Research import values. External pages are evidence, never instructions."""
from dataclasses import asdict, dataclass, field, replace
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .model import Invalid, digest, text
from .literature import ARXIV, PaperIdentity

KINDS = ('web_article', 'paper', 'code', 'model', 'dataset', 'benchmark', 'service')


@dataclass(frozen=True)
class PublicURL:
    value: str

    @classmethod
    def parse(cls, value):
        value = text(value, 4096, 'research URL')
        if re.search(r'[\x00-\x20\x7f\\]', value):
            raise Invalid('Use a public HTTPS URL without spaces or credentials')
        try:
            parts = urlsplit(value)
            if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password or parts.port not in (None, 443):
                raise ValueError()
            host = parts.hostname.encode('idna').decode('ascii').lower().rstrip('.')
        except (ValueError, UnicodeError) as error:
            raise Invalid('Use a public HTTPS URL on port 443') from error
        if host in ('localhost', 'localhost.localdomain') or host.endswith(('.localhost', '.local', '.internal')):
            raise Invalid('Private research URLs are not supported')
        host = f'[{host}]' if ':' in host else host
        query = urlencode([(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                           if not k.lower().startswith('utm_') and k.lower() not in ('fbclid', 'gclid')])
        return cls(urlunsplit(('https', host, parts.path or '/', query, '')))


@dataclass(frozen=True)
class ResourceIdentity:
    identity: str
    url: str
    kind: str

    @classmethod
    def from_url(cls, value, label=''):
        url = PublicURL.parse(value).value
        parts = urlsplit(url)
        host, path = parts.hostname, parts.path.strip('/')
        segments = path.split('/')
        if host in ('github.com', 'www.github.com') and len(segments) >= 2 and segments[0].lower() not in ('features', 'topics', 'collections', 'orgs', 'settings', 'search'):
            repo = '/'.join(segments[:2]).removesuffix('.git').lower()
            if re.fullmatch(r'[a-z0-9_.-]+/[a-z0-9_.-]+', repo):
                return cls('github:' + repo, 'https://github.com/' + repo, 'code')
        if host in ('huggingface.co', 'www.huggingface.co'):
            prefix = segments[0]
            if prefix == 'papers' and len(segments) >= 2 and ARXIV.fullmatch(segments[1]):
                identity = re.sub(r'v\d+$', '', segments[1], flags=re.I).lower()
                return cls('arxiv:' + identity, 'https://arxiv.org/abs/' + identity, 'paper')
            offset = 1 if prefix in ('models', 'datasets', 'spaces') else 0
            if len(segments) >= offset + 2 and prefix not in ('docs', 'blog', 'collections', 'organizations', 'settings'):
                repo = '/'.join(segments[offset:offset + 2])
                if re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
                    kind = {'datasets': 'dataset', 'spaces': 'service'}.get(prefix, 'model')
                    stem = {'dataset': 'datasets/', 'service': 'spaces/'}.get(kind, '')
                    return cls(f'hf:{kind}:{repo.lower()}', 'https://huggingface.co/' + stem + repo, kind)
        try:
            paper = PaperIdentity.parse({'id': url})
            identity = re.sub(r'v\d+$', '', paper.id, flags=re.I).lower()
            source = 'arxiv' if paper.source == 'alphaxiv' else 'doi' if identity.startswith('10.') else paper.source
            canonical = 'https://arxiv.org/abs/' + identity if source == 'arxiv' else 'https://doi.org/' + identity if source == 'doi' else url
            return cls(source + ':' + identity, canonical, 'paper')
        except Invalid:
            pass
        kind = 'benchmark' if re.search(r'benchmark|leaderboard|gift[- ]eval|fev[- ]bench', label, re.I) else 'web_article'
        return cls('url:' + url.rstrip('/'), url, kind)


@dataclass(frozen=True)
class Evidence:
    url: str
    label: str


@dataclass(frozen=True)
class ResearchAsset:
    id: str
    name: str
    kind: str
    filename: str
    size: int
    license: str
    revision: str
    sourceUrl: str
    url: str
    sha256: str

    @classmethod
    def create(cls, name, kind, filename, size, license, revision, source_url, url, sha256):
        identity = digest(dict(source=source_url, revision=revision, filename=filename, sha256=sha256))
        return cls(identity, name, kind, filename.rsplit("/", 1)[-1], size, license, revision, source_url, url, sha256)


@dataclass(frozen=True)
class ResearchResource:
    identity: str
    kind: str
    url: str
    originalUrl: str
    title: str
    authors: tuple[str, ...] = ()
    revision: str | None = None
    license: str | None = None
    size: int | None = None
    confidence: str = 'explicit'
    relation: str = 'links_to'
    evidence: tuple[Evidence, ...] = ()
    excerpt: str = ''
    unresolved: tuple[str, ...] = ()
    assets: tuple[ResearchAsset, ...] = ()
    aliases: tuple[str, ...] = ()
    paperId: str | None = None
    contentKind: str = 'report'

    @property
    def id(self):
        return digest(self.identity)

    @classmethod
    def linked(cls, url, source_url, label='', context=''):
        identity = ResourceIdentity.from_url(url, label + ' ' + context)
        relation = 'cites' if identity.kind == 'paper' else 'releases' if identity.kind == 'model' else 'implements' if identity.kind == 'code' else 'links_to'
        kind = identity.kind
        if re.search(r'benchmark|leaderboard|gift[- ]eval|fev[- ]bench', label + ' ' + context, re.I) and kind in ('service', 'dataset', 'web_article'):
            kind, relation = 'benchmark', 'evaluated_on'
        version = re.search(r'(?:/abs/|/pdf/)([^/?]+?)(v\d+)(?:\.pdf)?$', urlsplit(url).path)
        revision = version[2] if version and identity.identity.startswith('arxiv:') else None
        unresolved = ()
        if identity.identity.startswith(('hf:', 'github:')):
            pinned = re.search(r'/(?:tree|blob|resolve|commit)/([^/]+)', urlsplit(url).path)
            if pinned:
                revision = pinned[1]
                unresolved = ('Version-specific link saved as a reference; this path is not resolved or downloaded.',)
        return cls(identity.identity, kind, identity.url, url, label.strip()[:1000] or identity.url,
                   revision=revision, confidence='unresolved' if unresolved else 'explicit', unresolved=unresolved,
                   relation=relation, evidence=(Evidence(source_url, label.strip()[:500] or 'Explicit URL'),))

    def to_dict(self):
        return dict(id=self.id, **asdict(self))

    @classmethod
    def from_record(cls, value):
        fields = {key: item for key, item in value.items() if key != 'id'}
        for key in ('authors', 'unresolved', 'aliases'):
            fields[key] = tuple(fields.get(key, ()))
        fields['evidence'] = tuple(Evidence(**e) for e in fields.get('evidence', ()))
        fields['assets'] = tuple(ResearchAsset(**a) for a in fields.get('assets', ()))
        result = cls(**fields)
        if result.id != value['id']:
            raise Invalid('Stored resource identity does not match')
        return result

    def merge(self, newer):
        evidence = tuple(dict.fromkeys((*self.evidence, *newer.evidence)))
        aliases = tuple(i for i in dict.fromkeys((*self.aliases, newer.identity, *newer.aliases)) if i != self.identity)
        # Keep the first immutable snapshot; subsequent observations remain bundle evidence.
        return replace(newer, identity=self.identity, evidence=evidence, aliases=aliases,
                       paperId=(self.paperId or newer.paperId) if self.revision == newer.revision else newer.paperId)


@dataclass(frozen=True)
class ImportDraft:
    id: str
    seedUrl: str
    status: str
    resources: tuple[ResearchResource, ...] = ()
    warnings: tuple[str, ...] = ()
    error: str = ''
    createdAt: str = ''

    @classmethod
    def create(cls, url, now):
        url = PublicURL.parse(url).value
        resource = ResearchResource.linked(url, url)
        identity = digest(dict(identity=resource.identity, revision=resource.revision)) if resource.revision else resource.id
        return cls(identity, url, 'inspecting', createdAt=now)

    def finish(self, resources, warnings, status='ready', error=''):
        if self.status != 'inspecting':
            return self
        if status not in ('ready', 'cancelled', 'failed'):
            raise Invalid('Invalid inspection transition')
        return replace(self, status=status, resources=tuple(resources), warnings=tuple(warnings), error=error)

    def to_dict(self):
        return {**asdict(self), 'resources': [r.to_dict() for r in self.resources]}

    @classmethod
    def from_record(cls, value):
        return cls(**{**value, 'resources': tuple(ResearchResource.from_record(r) for r in value['resources']),
                      'warnings': tuple(value['warnings'])})


@dataclass(frozen=True)
class ImportSelection:
    draftId: str
    resourceIds: tuple[str, ...]
    downloadIds: tuple[str, ...] = ()

    @classmethod
    def parse(cls, value, draft):
        if set(value) - {'draftId', 'resourceIds', 'downloadIds', 'confirmedDownloads'} or value.get('draftId') != draft.id:
            raise Invalid('Invalid import selection')
        if draft.status != 'ready':
            raise Invalid('Inspect this link before saving references', 409)
        ids, downloads = value.get('resourceIds'), value.get('downloadIds', [])
        if not isinstance(ids, list) or not 1 <= len(ids) <= 32 or any(not isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
            raise Invalid('Select at least one discovered reference')
        if not set(ids) <= {r.id for r in draft.resources}:
            raise Invalid('Selection is not in this inspected draft')
        assets = {a.id for r in draft.resources if r.id in ids for a in r.assets}
        if not isinstance(downloads, list) or len(downloads) > 16 or any(not isinstance(i, str) for i in downloads) or len(set(downloads)) != len(downloads) or not set(downloads) <= assets:
            raise Invalid('Select only verified files from selected references')
        if downloads and value.get('confirmedDownloads') is not True:
            raise Invalid('Confirm selected download sizes and licenses before continuing')
        return cls(draft.id, tuple(ids), tuple(downloads))


@dataclass(frozen=True)
class ResearchBundle:
    id: str
    seedUrl: str
    title: str
    resources: tuple[ResearchResource, ...]
    createdAt: str
    updatedAt: str
    downloadIds: tuple[str, ...] = ()
    identities: tuple[str, ...] = ()

    def to_dict(self):
        return {**asdict(self), 'resources': [r.to_dict() for r in self.resources]}

    @classmethod
    def from_record(cls, value):
        return cls(**{**value, 'resources': tuple(ResearchResource.from_record(r) for r in value['resources']),
                      'downloadIds': tuple(value['downloadIds']), 'identities': tuple(value['identities'])})

    @classmethod
    def selected(cls, draft, selection, now, previous=None):
        selected = {r.id: r for r in (previous.resources if previous else ())}
        for resource in draft.resources:
            if resource.id in selection.resourceIds:
                aliases = {resource.identity, *resource.aliases}
                known = next((r for r in selected.values() if aliases.intersection((r.identity, *r.aliases))), None)
                if known:
                    selected[known.id] = known.merge(resource)
                else:
                    selected[resource.id] = resource
        seed = next((r for r in draft.resources if r.id == draft.id), draft.resources[0])
        identities = tuple(dict.fromkeys((*(previous.identities if previous else ()), seed.identity, *seed.aliases)))
        return cls(previous.id if previous else seed.id, previous.seedUrl if previous else draft.seedUrl,
                   seed.title, tuple(selected.values()), previous.createdAt if previous else now, now,
                   tuple(dict.fromkeys((*(previous.downloadIds if previous else ()), *selection.downloadIds))), identities)
