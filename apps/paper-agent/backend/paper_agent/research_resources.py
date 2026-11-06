"""Research import values. External pages are evidence, never instructions."""
from dataclasses import asdict, dataclass, replace
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .model import ID, Invalid, digest, text
from .literature import ARXIV, PaperIdentity

KINDS = ('web_article', 'paper', 'pdf_candidate', 'source_archive', 'code', 'model', 'dataset', 'benchmark', 'service')


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
        parameters = parse_qsl(parts.query, keep_blank_values=True)
        credential_keys = {'token', 'access_token', 'api_key', 'apikey', 'auth', 'authorization',
                           'signature', 'sig', 'oauth_token', 'id_token', 'client_secret'}
        if any(key.lower() in credential_keys or key.lower().startswith(('x-amz-', 'x-goog-')) for key, _ in (*parameters, *parse_qsl(parts.fragment.lstrip('?'), keep_blank_values=True))):
            raise Invalid('Credential-bearing or signed URLs are not supported; use the public resource page')
        query = urlencode([(k, v) for k, v in parameters
                           if not k.lower().startswith('utm_') and k.lower() not in ('fbclid', 'gclid')])
        return cls(urlunsplit(('https', host, parts.path or '/', query, '')))


@dataclass(frozen=True)
class ResourceIdentity:
    identity: str
    url: str
    kind: str

    @classmethod
    def from_url(cls, value, label='', pdf_hint=False):
        url = PublicURL.parse(value).value
        parts = urlsplit(url)
        host, path = parts.hostname, parts.path.strip('/')
        segments = path.split('/')
        if host in ('arxiv.org', 'www.arxiv.org') and path.startswith(('src/', 'e-print/')):
            identifier = path.split('/', 1)[1]
            if ARXIV.fullmatch(identifier) and re.search(r'v[1-9]\d*$', identifier):
                return cls('arxiv-source:' + identifier, 'https://arxiv.org/src/' + identifier, 'source_archive')
            if ARXIV.fullmatch(identifier):
                return cls('url:' + url, url, 'source_archive')
        # Managed model/dataset artifacts retain their Data eligibility rules.
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
        if parts.path.lower().endswith(('.tar.gz', '.tgz', '.gz', '.tar', '.zip')):
            return cls('url:' + url, url, 'source_archive')
        # An explicit representation is reviewed as a file, not collapsed into
        # its work identity (which would discard the selected PDF/version).
        arxiv_pdf = host in ('arxiv.org', 'www.arxiv.org') and path.startswith('pdf/') and ARXIV.fullmatch(path[4:].removesuffix('.pdf'))
        if pdf_hint or parts.path.lower().endswith('.pdf') or arxiv_pdf:
            return cls('url:' + url.rstrip('/'), url, 'pdf_candidate')
        if host in ('github.com', 'www.github.com') and len(segments) >= 2 and segments[0].lower() not in ('features', 'topics', 'collections', 'orgs', 'settings', 'search'):
            repo = '/'.join(segments[:2]).removesuffix('.git').lower()
            if re.fullmatch(r'[a-z0-9_.-]+/[a-z0-9_.-]+', repo):
                return cls('github:' + repo, 'https://github.com/' + repo, 'code')
        try:
            paper = PaperIdentity.parse({'id': url})
            identity = re.sub(r'v\d+$', '', paper.id, flags=re.I).lower()
            source = 'arxiv' if paper.source == 'alphaxiv' else 'doi' if identity.startswith('10.') else paper.source
            canonical = 'https://arxiv.org/abs/' + identity if source == 'arxiv' else 'https://doi.org/' + identity if source == 'doi' else url
            return cls(source + ':' + identity, canonical, 'paper')
        except Invalid:
            pass
        if parts.path.lower().endswith('.pdf') or re.search(r'\bpdf\b', label, re.I):
            return cls('url:' + url.rstrip('/'), url, 'pdf_candidate')
        kind = 'benchmark' if re.search(r'benchmark|leaderboard|gift[- ]eval|fev[- ]bench', label, re.I) else 'web_article'
        return cls('url:' + url.rstrip('/'), url, kind)


@dataclass(frozen=True)
class Evidence:
    url: str
    label: str
    href: str = ''
    kind: str = 'link'
    position: int | None = None


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
        identity = digest(dict(source=source_url, revision=revision, filename=filename, sha256=sha256,
                               size=size, license=license, url=url, kind=kind))
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
    observedAt: str = ''
    workIdentity: str | None = None

    @property
    def id(self):
        return digest(self.identity)

    @classmethod
    def linked(cls, url, source_url, label='', context='', evidence_kind='link', position=None):
        url = PublicURL.parse(url).value
        identity = ResourceIdentity.from_url(url, label + ' ' + context, evidence_kind in ('citation_pdf_url', 'alternate_pdf'))
        relation = 'cites' if identity.kind == 'paper' else 'releases' if identity.kind == 'model' else 'implements' if identity.kind == 'code' else 'links_to'
        kind = identity.kind
        if re.search(r'benchmark|leaderboard|gift[- ]eval|fev[- ]bench', label + ' ' + context, re.I) and kind in ('service', 'dataset', 'web_article'):
            kind, relation = 'benchmark', 'evaluated_on'
        version = re.search(r'(?:/abs/|/pdf/|/html/|/src/|/e-print/)([^?]+?)(v\d+)(?:\.pdf)?$', urlsplit(url).path)
        revision = version[2] if version and urlsplit(url).hostname in ('arxiv.org', 'www.arxiv.org') else None
        unresolved = ('PDF candidate; paper identity and document version are unverified. No file has been downloaded.',) if kind == 'pdf_candidate' else ()
        if kind == 'source_archive':
            unresolved = ('Source candidate; archive contents and availability are unverified. Nothing is compiled or executed.',)
        if kind == 'source_archive' and urlsplit(url).path.lower().endswith('.zip'):
            unresolved = (*unresolved, 'ZIP source archives are unsupported; this link is reference-only.')
        work = 'arxiv:' + version[1] if revision else None
        if kind == 'source_archive' and urlsplit(url).hostname in ('arxiv.org', 'www.arxiv.org') and not revision:
            work = 'arxiv:' + urlsplit(url).path.split('/', 2)[-1]
            unresolved = (*unresolved, 'Select an explicit arXiv vN before downloading; latest version is not assumed.')
        if identity.identity.startswith(('hf:', 'github:')):
            pinned = re.search(r'/(?:tree|blob|resolve|commit)/([^/]+)', urlsplit(url).path)
            if pinned:
                revision = pinned[1]
                unresolved = ('Version-specific link saved as a reference; this path is not resolved or downloaded.',)
        return cls(identity.identity, kind, identity.url, url, label.strip()[:1000] or identity.url,
                   revision=revision, workIdentity=work, confidence='unresolved' if unresolved else 'explicit', unresolved=unresolved,
                   relation=relation, evidence=(Evidence(source_url, label.strip()[:500] or 'Explicit URL', url, evidence_kind, position),))

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
class ObservedLink:
    id: str
    href: str
    label: str
    kind: str
    position: int | None = None


@dataclass(frozen=True)
class ObservedPage:
    url: str
    text: str
    digest: str
    links: tuple[ObservedLink, ...]

    @classmethod
    def create(cls, url, body, links):
        body = body[:16000]
        page_digest = digest(dict(url=url, text=body, links=links))
        observed = tuple(ObservedLink(digest(dict(page=page_digest, **link)), **link) for link in links)
        return cls(url, body, page_digest, observed)

    @classmethod
    def from_record(cls, value):
        return cls(**{**value, 'links': tuple(ObservedLink(**link) for link in value['links'])})


@dataclass(frozen=True)
class ImportDraft:
    id: str
    seedUrl: str
    status: str
    resources: tuple[ResearchResource, ...] = ()
    warnings: tuple[str, ...] = ()
    error: str = ''
    createdAt: str = ''
    pages: tuple[ObservedPage, ...] = ()

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
                      'warnings': tuple(value['warnings']),
                      'pages': tuple(ObservedPage.from_record(p) for p in value.get('pages', ()))})


@dataclass(frozen=True)
class ArxivPaper:
    """A saved work identity; an unversioned snapshot cannot prove a PDF version."""
    work: str
    revision: str | None

    @classmethod
    def from_snapshot(cls, paper):
        values = []
        for reference in (paper.source_id, paper.pdf_url, paper.url, paper.full_text_url):
            if not reference:
                continue
            try:
                identity = PaperIdentity.parse({'id': reference})
            except Invalid:
                continue
            if identity.source == 'alphaxiv':
                values.append(identity.id)
        matches = [re.fullmatch(r'(.+?)(v[1-9]\d*)?', value, re.I) for value in values
                   if isinstance(value, str) and ARXIV.fullmatch(value)]
        if not matches:
            raise Invalid('This saved paper has no arXiv identity', 409)
        works = {match[1].lower() for match in matches}
        revisions = {match[2] for match in matches if match[2]}
        if paper.source_revision:
            revisions.add(paper.source_revision)
        if len(works) != 1 or len(revisions) > 1 or any(not re.fullmatch(r'v[1-9]\d*', r) for r in revisions):
            raise Invalid('Saved arXiv identities or versions conflict; review the original source', 409)
        return cls(next(iter(works)), next(iter(revisions), None))

    @property
    def identifier(self):
        return self.work + (self.revision or '')

    @property
    def pdf_url(self):
        return 'https://arxiv.org/pdf/' + self.identifier

    @classmethod
    def reading_view(cls, paper, include_content=True):
        # Derived presentation only: never rewrite an immutable saved snapshot.
        view = paper.to_dict(include_content)
        try:
            work = cls.from_snapshot(paper)
        except Invalid:
            return view
        view['pdfCandidateUrl'] = paper.pdf_url or work.pdf_url
        view['arxivUrl'] = 'https://arxiv.org/abs/' + work.identifier
        return view

    def accepts(self, source):
        return source.work == self.work and (not self.revision or self.revision == source.revision)


@dataclass(frozen=True)
class OfficialHtml:
    """An independently reviewed official HTML representation of a fixed work."""
    work: str
    revision: str

    @classmethod
    def from_resource(cls, resource):
        work = (resource.workIdentity or '').removeprefix('arxiv:')
        if (resource.kind not in ('paper', 'pdf_candidate')
                or resource.workIdentity != 'arxiv:' + work
                or not ARXIV.fullmatch(work) or re.search(r'v\d+$', work, re.I)
                or not re.fullmatch(r'v[1-9]\d*', resource.revision or '')):
            raise Invalid('Choose a paper or PDF with an explicit arXiv work and version for HTML', 409)
        for url in (resource.url, resource.originalUrl):
            parsed = urlsplit(url)
            if parsed.hostname in ('arxiv.org', 'www.arxiv.org'):
                match = re.fullmatch(r'/(?:abs|pdf|html)/(.+?)(v[1-9]\d*)(?:\.pdf)?', parsed.path)
                if match and (match[1].lower(), match[2]) != (work.lower(), resource.revision):
                    raise Invalid('The HTML work/version conflicts with the source reference', 409)
        return cls(work.lower(), resource.revision)

    @property
    def url(self):
        return 'https://arxiv.org/html/' + self.work + self.revision


@dataclass(frozen=True)
class ImportSelection:
    draftId: str
    resourceIds: tuple[str, ...]
    downloadIds: tuple[str, ...] = ()
    pdfIds: tuple[str, ...] = ()
    sourceIds: tuple[str, ...] = ()
    htmlIds: tuple[str, ...] = ()

    @classmethod
    def parse(cls, value, draft):
        if set(value) - {'draftId', 'resourceIds', 'downloadIds', 'pdfIds', 'sourceIds', 'htmlIds', 'confirmedDownloads'} or value.get('draftId') != draft.id:
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
        pdfs = value.get('pdfIds', [])
        candidates = {r.id for r in draft.resources if r.id in ids and r.kind == 'pdf_candidate'}
        if not isinstance(pdfs, list) or len(pdfs) > 16 or any(not isinstance(i, str) for i in pdfs) or len(set(pdfs)) != len(pdfs) or not set(pdfs) <= candidates:
            raise Invalid('Select only PDF candidates from selected references')
        sources = value.get('sourceIds', [])
        source_candidates = {r.id for r in draft.resources if r.id in ids and r.kind == 'source_archive'}
        if not isinstance(sources, list) or len(sources) > 16 or any(not isinstance(i, str) for i in sources) or len(set(sources)) != len(sources) or not set(sources) <= source_candidates:
            raise Invalid('Select only source archives from selected references')
        if any(r.id in sources and r.workIdentity and not r.revision for r in draft.resources):
            raise Invalid('Select an explicit arXiv source version before downloading')
        if any(r.id in sources and urlsplit(r.url).path.lower().endswith('.zip') for r in draft.resources):
            raise Invalid('ZIP source archives are unsupported; save references only')
        html = value.get('htmlIds', [])
        if not isinstance(html, list) or len(html) > 16 or any(not isinstance(i, str) for i in html) or len(set(html)) != len(html) or not set(html) <= set(ids):
            raise Invalid('Select only official HTML from selected references')
        html_targets = {}
        for resource in draft.resources:
            if resource.id in html:
                target = OfficialHtml.from_resource(resource).url
                if resource.id in html_targets and html_targets[resource.id] != target:
                    raise Invalid('Choose one explicit version for each HTML reference')
                html_targets[resource.id] = target
        if (downloads or pdfs or sources or html) and value.get('confirmedDownloads') is not True:
            raise Invalid('Confirm selected download sizes and licenses before continuing')
        return cls(draft.id, tuple(ids), tuple(downloads), tuple(pdfs), tuple(sources), tuple(html))


@dataclass(frozen=True)
class ProgramHtmlAuthorization:
    """An explicit program policy, distinct from manual download confirmation."""
    programId: str
    protocolDigest: str
    checkpoint: str
    candidateId: str
    sourceUrl: str

    def validate(self, program, resource):
        if any(not isinstance(v, str) or not ID.fullmatch(v) for v in (self.programId, self.protocolDigest, self.checkpoint, self.candidateId)):
            raise Invalid('Invalid program HTML authorization')
        candidate = program.candidate(self.candidateId)
        candidate_source = OfficialHtml.from_resource(ResearchResource.linked(candidate.officialHtmlUrl or candidate.url, candidate.url, candidate.title))
        if (program.id != self.programId or digest(program.protocol.to_dict()) != self.protocolDigest
                or program.checkpoint != self.checkpoint or program.protocol.acquisition != 'public_fulltext'
                or candidate.decision != 'include' or candidate_source.url != self.sourceUrl
                or OfficialHtml.from_resource(resource).url != self.sourceUrl):
            raise Invalid('Official HTML is outside the approved program snapshot', 403)


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
    pdfDownloadIds: tuple[str, ...] = ()
    sourceDownloadIds: tuple[str, ...] = ()
    htmlDownloadIds: tuple[str, ...] = ()
    programAuthorization: ProgramHtmlAuthorization | None = None

    def approved_html(self, resource_id):
        if resource_id not in self.htmlDownloadIds and self.programAuthorization is None:
            raise Invalid('This official HTML was not independently confirmed in the research review', 403)
        resource = next((r for r in self.resources if r.id == resource_id), None)
        if resource is None:
            raise Invalid('Approved HTML reference is unavailable; inspect the source again', 409)
        target = OfficialHtml.from_resource(resource)
        if self.programAuthorization and target.url != self.programAuthorization.sourceUrl:
            raise Invalid('HTML resource differs from the program authorization', 403)
        return resource

    def to_dict(self):
        result = {**asdict(self), 'resources': [r.to_dict() for r in self.resources]}
        if not self.htmlDownloadIds:
            result.pop('htmlDownloadIds')
        if self.programAuthorization is None:
            result.pop('programAuthorization')
        return result

    @classmethod
    def from_record(cls, value):
        return cls(**{**value, 'resources': tuple(ResearchResource.from_record(r) for r in value['resources']),
                      'downloadIds': tuple(value['downloadIds']), 'identities': tuple(value['identities']),
                      'pdfDownloadIds': tuple(value.get('pdfDownloadIds', ())),
                      'sourceDownloadIds': tuple(value.get('sourceDownloadIds', ())),
                      'htmlDownloadIds': tuple(value.get('htmlDownloadIds', ())),
                      'programAuthorization': ProgramHtmlAuthorization(**value['programAuthorization']) if value.get('programAuthorization') else None})

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
        html = []
        if previous:
            for resource in previous.resources:
                current = selected.get(resource.id)
                if resource.id in previous.htmlDownloadIds and current and (resource.workIdentity, resource.revision, resource.kind) == (current.workIdentity, current.revision, current.kind):
                    html.append(resource.id)
        for resource in draft.resources:
            if resource.id in selection.htmlIds:
                target = OfficialHtml.from_resource(resource).url
                aliases = {resource.identity, *resource.aliases}
                html.extend(item.id for item in selected.values()
                            if aliases.intersection((item.identity, *item.aliases))
                            and item.kind in ('paper', 'pdf_candidate') and item.workIdentity == resource.workIdentity
                            and item.revision == resource.revision and OfficialHtml.from_resource(item).url == target)
        return cls(previous.id if previous else seed.id, previous.seedUrl if previous else draft.seedUrl,
                   seed.title, tuple(selected.values()), previous.createdAt if previous else now, now,
                   tuple(dict.fromkeys((*(previous.downloadIds if previous else ()), *selection.downloadIds))), identities,
                   tuple(dict.fromkeys((*(previous.pdfDownloadIds if previous else ()), *selection.pdfIds))),
                   tuple(dict.fromkeys((*(previous.sourceDownloadIds if previous else ()), *selection.sourceIds))),
                   tuple(dict.fromkeys(html)))
