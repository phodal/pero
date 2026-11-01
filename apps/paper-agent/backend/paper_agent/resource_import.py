"""Research import values and bounded discovery over the existing Paper store.

The HTML, metadata and README are observations, never instructions or authority.
This module does not download binaries, clone repositories or start an Agent.
"""
from dataclasses import asdict, dataclass, replace
import hashlib
import json
import re
from urllib.parse import quote, unquote, urlsplit

from .resource_web import PageLink, PublicWeb, ResearchHTML, canonical_url

MAX_RESOURCES = 30
MAX_FETCHES = 12
IDENTITY = re.compile(r'[a-f0-9]{64}')
REPO = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]*')
ARXIV = re.compile(r'(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?', re.I)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def bounded_text(value, maximum=1000):
    return value[:maximum] if isinstance(value, str) else ''


@dataclass(frozen=True)
class Reading:
    source: str
    sourceId: str
    title: str
    url: str
    authors: tuple[str, ...]
    contentKind: str
    content: str
    limitation: str = ''

    def document(self):
        return {**asdict(self), 'authors': list(self.authors)}


@dataclass(frozen=True)
class Evidence:
    sourceUrl: str
    label: str
    method: str = 'direct-link'


@dataclass(frozen=True)
class Resource:
    id: str
    kind: str
    url: str
    canonicalId: str
    title: str
    relation: str
    evidence: tuple[Evidence, ...]
    provider: str = ''
    providerId: str = ''
    revision: str = ''
    license: str = ''
    sizeBytes: int | None = None
    status: str = 'linked'
    warning: str = ''
    reading: Reading | None = None

    def document(self, include_content=False):
        result = asdict(self)
        if not include_content:
            result.pop('reading')
        return result

    @classmethod
    def stored(cls, value):
        data = dict(value)
        data['evidence'] = tuple(Evidence(**item) for item in data['evidence'])
        if data.get('reading'):
            data['reading'] = Reading(**{**data['reading'], 'authors': tuple(data['reading']['authors'])})
        return cls(**data)


def identify(url, source_url, label='', seed=False):
    url = canonical_url(url)
    parsed = urlsplit(url)
    host, path = parsed.hostname, unquote(parsed.path).strip('/')
    parts = path.split('/')
    kind, provider, provider_id, revision = 'web_article', '', '', ''
    relation = 'source' if seed else 'related'
    if host in ('github.com', 'www.github.com') and len(parts) >= 2:
        owner, repo = parts[:2]
        repo = repo.removesuffix('.git')
        if all(REPO.fullmatch(value) for value in (owner, repo)) and owner.lower() not in ('features', 'topics', 'collections', 'settings', 'orgs', 'users', 'marketplace'):
            provider_id = f'{owner}/{repo}'
            url = 'https://github.com/' + provider_id.lower()
            kind, provider = 'code', 'github'
    elif host in ('huggingface.co', 'www.huggingface.co'):
        if len(parts) >= 2 and parts[0] == 'papers' and ARXIV.fullmatch(parts[1]):
            return identify('https://arxiv.org/abs/' + parts[1], source_url, label, seed)
        prefix = parts[0] if parts[0] in ('models', 'datasets', 'spaces') else 'models'
        names = parts[1:] if parts[0] in ('models', 'datasets', 'spaces') else parts
        if len(names) >= 2 and all(REPO.fullmatch(value) for value in names[:2]):
            provider_id = '/'.join(names[:2])
            provider = 'huggingface'
            kind = {'models': 'model', 'datasets': 'dataset', 'spaces': 'service'}[prefix]
            url = 'https://huggingface.co/' + ('' if prefix == 'models' else prefix + '/') + provider_id
    elif host in ('arxiv.org', 'www.arxiv.org', 'alphaxiv.org', 'www.alphaxiv.org'):
        candidate = re.sub(r'^(abs|pdf|overview)/', '', path).removesuffix('.pdf')
        matched = ARXIV.fullmatch(candidate)
        if matched:
            provider_id, revision = matched.group(1), matched.group(2) or ''
            url, kind, provider = 'https://arxiv.org/abs/' + provider_id, 'paper', 'arxiv'
    elif host in ('doi.org', 'dx.doi.org') and re.fullmatch(r'10\.\d{4,9}/\S+', path):
        provider_id, kind, provider = path.lower(), 'paper', 'doi'
        url = 'https://doi.org/' + provider_id
    elif host == 'openalex.org' and re.fullmatch(r'W\d+', path):
        provider_id, kind, provider = path, 'paper', 'openalex'
    if not seed:
        relation = 'cites' if kind == 'paper' else 'related'
        if re.search(r'benchmark|evaluation|gift.eval|fev.bench', label, re.I):
            relation = 'evaluated_on'
            if kind in ('web_article', 'service'):
                kind = 'benchmark'
    identity = f'{provider}:{provider_id.lower() if provider in ("github", "doi") else provider_id}' if provider else url
    # HF has separate model/dataset/space namespaces with potentially identical names.
    if provider == 'huggingface':
        identity = f'huggingface:{prefix}:{provider_id}'
    return Resource(fingerprint(identity), kind, url, identity, label[:1000] or provider_id or url,
                    relation, (Evidence(source_url, label[:300], 'user-link' if seed else 'direct-link'),),
                    provider, provider_id, revision)


class Discovery:
    def __init__(self, web=None, read_paper=None):
        self.web = web if web is not None else PublicWeb()
        self.read_paper = read_paper

    def inspect(self, url):
        seed_url = canonical_url(url)
        resources, warnings, requests, paper_reads = {}, [], 0, 0

        def read(address):
            nonlocal requests
            if requests >= MAX_FETCHES:
                raise ValueError('Discovery reached its 12-request limit')
            requests += 1
            return self.web.read(address)

        def resolve(item):
            nonlocal paper_reads
            if item.kind == 'paper':
                if paper_reads >= 4:
                    raise ValueError('Discovery reached its four-paper reading limit')
                paper_reads += 1
            return self._resolve(item, read)

        def add(link, source, seed=False):
            try:
                item = identify(link.url, source, link.label, seed)
            except ValueError:
                return None
            prior = resources.get(item.id)
            if prior:
                evidence = tuple(dict.fromkeys((*prior.evidence, *item.evidence)))[:8]
                resources[item.id] = replace(prior, evidence=evidence)
                return item.id
            if len(resources) >= MAX_RESOURCES:
                if 'Only the first 30 resources are shown.' not in warnings:
                    warnings.append('Only the first 30 resources are shown.')
                return None
            resources[item.id] = item
            return item.id

        seed_id = add(PageLink(seed_url, ''), seed_url, True)
        seed = resources[seed_id]
        if not seed.provider:
            # The seed must be readable; failed secondary lookups remain partial results.
            document = read(seed_url)
            if document.mime not in ('text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown'):
                raise ValueError('Use an article, project page or supported research URL')
            page = ResearchHTML(document.url)
            page.feed(document.text())
            content = page.content()
            if not content:
                raise ValueError('No readable text found; try the original project or paper URL')
            final = identify(document.url, document.url, page.heading(), True)
            # Preserve the original request as evidence when following a public redirect.
            final = replace(final, evidence=(Evidence(seed_url, 'Submitted URL', 'user-link'),), status='resolved',
                reading=Reading('web-article', final.id, page.heading(), final.url, (), 'full-text', content,
                    'Research web article, not necessarily a formal paper. HTML text extraction.' +
                    (' Text or links were truncated at the discovery limit.' if page.truncated else '')))
            resources = {final.id: final}
            seed_url, seed_id = final.url, final.id
            for link in page.links:
                candidate = identify(link.url, document.url, link.label)
                if candidate.provider or re.search(r'paper|code|model|data|benchmark|project|forecast|repository', link.label, re.I):
                    add(link, document.url)
            for key in ('citation_doi', 'citation_arxiv_id', 'citation_pdf_url'):
                value = page.metadata.get(key)
                if value:
                    target = ('https://doi.org/' + value if key == 'citation_doi' and not value.startswith('https://') else
                              'https://arxiv.org/abs/' + value if key == 'citation_arxiv_id' else value)
                    add(PageLink(target, page.heading()), document.url)
            if page.truncated:
                warnings.append('The source text or link list exceeded a discovery limit; the saved excerpt is incomplete.')
        # One provider expansion pass, then resolve newly discovered papers only.
        initial = list(resources)
        for identity in initial:
            item = resources[identity]
            if not item.provider:
                continue
            try:
                enriched, links, source = resolve(item)
                resources[identity] = enriched
                for link in links:
                    add(link, source)
            except (OSError, ValueError, KeyError, TypeError) as error:
                resources[identity] = replace(item, status='unavailable', warning=str(error)[:300])
        for identity in list(resources):
            item = resources[identity]
            if identity not in initial and item.kind == 'paper':
                try:
                    enriched, _, _ = resolve(item)
                    resources[identity] = enriched
                except (OSError, ValueError, KeyError, TypeError) as error:
                    resources[identity] = replace(item, status='unavailable', warning=str(error)[:300])
        if not any(item.kind == 'paper' for item in resources.values()):
            warnings.append('No formal paper was found within the followed links. No paper was inferred from the article title.')
        if any(item.status == 'unavailable' for item in resources.values()):
            warnings.append('Some metadata could not be resolved. References can still be saved.')
        return seed_url, tuple(resources.values()), tuple(warnings)

    def _resolve(self, item, read):
        links = []
        source = item.url
        if item.provider == 'github':
            root = 'https://api.github.com/repos/' + item.providerId
            data = read(root).json()
            license_info = data.get('license') or {}
            if not isinstance(license_info, dict):
                raise ValueError('Invalid GitHub license metadata')
            license_name = bounded_text(license_info.get('spdx_id'), 200)
            if license_name == 'NOASSERTION':
                license_name = ''
            branch = bounded_text(data.get('default_branch'), 200)
            commit = read(root + '/commits/' + quote(branch, safe='')).json() if branch else {}
            revision = bounded_text(commit.get('sha'), 64)
            if revision and not re.fullmatch(r'[a-f0-9]{40,64}', revision):
                raise ValueError('GitHub returned an invalid commit')
            result = replace(item, title=bounded_text(data.get('full_name')) or item.title,
                             revision=revision, license=license_name, status='resolved')
            if revision:
                # README metadata is not a checkout and never executes repository code.
                source = f'https://raw.githubusercontent.com/{item.providerId}/{revision}/README.md'
                try:
                    text = read(source).text()
                    for target in re.findall(r'https://[^\s<>"\)\]]+', text)[:128]:
                        try:
                            candidate = identify(target.rstrip('.,'), source)
                            if candidate.provider and candidate.id != item.id:
                                links.append(PageLink(target.rstrip('.,'), 'Referenced by repository README'))
                        except ValueError:
                            pass
                except (OSError, ValueError) as error:
                    result = replace(result, warning='README links unavailable: ' + str(error)[:200])
            return result, links, source
        if item.provider == 'huggingface':
            namespace = item.canonicalId.split(':')[1]
            data = read(f'https://huggingface.co/api/{namespace}/{item.providerId}?blobs=true').json()
            revision = bounded_text(data.get('sha'), 64)
            if not re.fullmatch(r'[a-f0-9]{40,64}', revision):
                raise ValueError('Hugging Face did not provide an immutable revision')
            card = data.get('cardData') or {}
            license_name = card.get('license', '') if isinstance(card, dict) else ''
            license_name = ', '.join(license_name) if isinstance(license_name, list) and all(isinstance(x, str) for x in license_name) else bounded_text(license_name, 200)
            siblings = data.get('siblings', [])
            if not isinstance(siblings, list):
                raise ValueError('Invalid Hugging Face file metadata')
            sizes = []
            for file in siblings:
                lfs = file.get('lfs') if isinstance(file, dict) else None
                sizes.append(file.get('size', lfs.get('size') if isinstance(lfs, dict) else None) if isinstance(file, dict) else None)
            size = sum(sizes) if sizes and all(type(n) is int and n >= 0 for n in sizes) else None
            tags = data.get('tags') or []
            if not isinstance(tags, list):
                raise ValueError('Invalid Hugging Face paper tags')
            for tag in tags:
                if isinstance(tag, str) and tag.startswith('arxiv:') and ARXIV.fullmatch(tag[6:]):
                    links.append(PageLink('https://arxiv.org/abs/' + tag[6:], 'Paper referenced by model or dataset metadata'))
            warning = 'Access approval may be required at the provider.' if data.get('gated') else ''
            return replace(item, title=bounded_text(data.get('id')) or item.title, revision=revision,
                           license=license_name[:200], sizeBytes=size, status='resolved', warning=warning), links, item.url
        if item.kind == 'paper' and self.read_paper is not None:
            # Existing literature client retains its source allowlist and bounded reads.
            reading = self.read_paper({'id': item.url + (item.revision if item.provider == 'arxiv' else ''), 'full': False})
            content = bounded_text(reading.get('content'), 60000)
            if not content:
                raise ValueError('Paper metadata has no readable content')
            source_kind = reading.get('contentKind', 'abstract')
            if source_kind not in ('abstract', 'report', 'full-text'):
                raise ValueError('Unsupported literature content kind')
            saved = Reading(bounded_text(reading.get('source'), 40) or item.provider,
                bounded_text(reading.get('sourceId', reading.get('id', item.providerId)), 250),
                bounded_text(reading.get('title')) or item.title, item.url + (item.revision if item.provider == 'arxiv' else ''),
                tuple(bounded_text(author, 300) for author in reading.get('authors', [])[:30]), source_kind, content,
                'Linked reference; this does not establish that the paper describes the same model version.' +
                (' Content excerpt was truncated.' if len(str(reading.get('content', ''))) > 60000 else ''))
            return replace(item, title=saved.title, status='resolved', reading=saved), [], item.url
        return item, [], item.url


class ResourceImports:
    """IO shell using ResearchStore's lock, immutable records and paper writer."""
    def __init__(self, store, save_reading, discovery=None):
        self.store, self.save_reading = store, save_reading
        self.discovery = discovery if discovery is not None else Discovery()

    def command(self, value, now):
        if not isinstance(value, dict):
            raise ValueError('Expected a resource-import object')
        action = value.get('action')
        fields = {'inspect': {'action', 'url'}, 'save': {'action', 'draftId', 'resourceIds'},
                  'get': {'action', 'id'}, 'list': {'action'}}
        if action not in fields or set(value) != fields[action]:
            raise ValueError('Supply exactly the fields required by inspect, save, get or list')
        if action == 'inspect':
            seed, resources, warnings = self.discovery.inspect(value['url'])
            content = dict(seedUrl=seed, resources=[item.document(True) for item in resources], warnings=list(warnings))
            identity = fingerprint(content)
            with self.store.lock:
                if identity not in self.store._list('resource-drafts'):
                    self.store._write('resource-drafts', identity, dict(id=identity, createdAt=now, **content))
                return self._preview(self.store._read('resource-drafts', identity))
        if action == 'save':
            selected = value['resourceIds']
            if (not isinstance(selected, list) or not 1 <= len(selected) <= MAX_RESOURCES
                    or any(not isinstance(item, str) or not IDENTITY.fullmatch(item) for item in selected)
                    or len(set(selected)) != len(selected)):
                raise ValueError('Select between 1 and 30 distinct resource IDs')
            with self.store.lock:
                draft = self.store._read('resource-drafts', value['draftId'])
                all_resources = {item['id']: Resource.stored(item) for item in draft['resources']}
                if any(identity not in all_resources for identity in selected):
                    raise ValueError('Selection contains a resource outside this draft')
                bundle_id = fingerprint(draft['seedUrl'])
                record_id = fingerprint(dict(bundleId=bundle_id, draftId=draft['id'], selected=sorted(selected)))
                if record_id not in self.store._list('resource-bundles'):
                    papers, items = [], []
                    for identity in selected:
                        item = all_resources[identity]
                        public = item.document()
                        if item.reading:
                            paper = self.save_reading(item.reading.document(), now)
                            public['paperId'] = paper['id']
                            papers.append(paper['id'])
                        items.append(public)
                    records = [self.store._read('resource-bundles', key) for key in self.store._list('resource-bundles')]
                    sequence = max((record['sequence'] for record in records if record['bundleId'] == bundle_id), default=0) + 1
                    self.store._write('resource-bundles', record_id, dict(id=record_id, bundleId=bundle_id,
                        seedUrl=draft['seedUrl'], createdAt=now, sequence=sequence, resources=items, paperIds=papers,
                        warnings=draft['warnings']))
                return self._bundle(bundle_id)
        if action == 'get':
            if not isinstance(value['id'], str) or not IDENTITY.fullmatch(value['id']):
                raise ValueError('Invalid resource record ID')
            if value['id'] in self.store._list('resource-drafts'):
                return self._preview(self.store._read('resource-drafts', value['id']))
            return self._bundle(value['id'])
        with self.store.lock:
            identities = dict.fromkeys(self.store._read('resource-bundles', key)['bundleId'] for key in self.store._list('resource-bundles'))
            return {'bundles': [self._bundle(identity) for identity in identities]}

    def _preview(self, record):
        return {**record, 'resources': [Resource.stored(item).document() for item in record['resources']],
                'status': 'partial' if record['warnings'] else 'ready'}

    def _bundle(self, identity):
        with self.store.lock:
            records = [self.store._read('resource-bundles', key) for key in self.store._list('resource-bundles')]
            records = sorted((record for record in records if record['bundleId'] == identity), key=lambda r: r['sequence'])
            if not records:
                raise ValueError('Research bundle not found')
            resources, paper_ids = {}, set()
            for record in records:
                resources.update((item['id'], item) for item in record['resources'])
                paper_ids.update(record['paperIds'])
            items = list(resources.values())
            # This is a portable request, not an authorization or a trusted source manifest.
            # Data must resolve it again before admitting any files for download.
            handoff = {'schema': 'pero.research-assets.v1', 'bundleId': identity,
                       'resources': [{'kind': item['kind'], 'repoId': item['providerId'], 'revision': item['revision'],
                                      'sourceUrl': item['url']} for item in items
                                     if item['provider'] == 'huggingface' and item['kind'] in ('model', 'dataset') and item['revision']]}
            return dict(id=identity, seedUrl=records[-1]['seedUrl'], status='saved', resources=items,
                        paperIds=sorted(paper_ids), warnings=records[-1]['warnings'], handoff=handoff)
