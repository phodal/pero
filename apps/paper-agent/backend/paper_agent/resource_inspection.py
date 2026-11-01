"""Explicit links and provider metadata, bounded to one research neighborhood."""
from dataclasses import dataclass, replace
from html.parser import HTMLParser
import io
import json
import re
import time
from urllib.parse import quote, urljoin, urlsplit

from .literature import LiteratureClient, _scalars
from .model import Invalid
from .research_resources import Evidence, ImportDraft, PublicURL, ResearchAsset, ResearchResource
from .resource_fetch import PublicMetadata


@dataclass(frozen=True)
class PageLink:
    url: str
    label: str
    context: str


class ResearchPage(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url, self.metadata, self.links, self.body = url, {}, [], []
        self.ignored, self.anchor, self.heading, self.title = [], None, '', ''
        self.in_heading, self.in_title, self.main_seen = False, False, False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style', 'nav', 'footer', 'noscript'):
            self.ignored.append(tag)
        if self.ignored:
            return
        if tag in ('main', 'article') and not self.main_seen:
            self.main_seen = True
            self.body, self.links = [], []
        if tag == 'meta':
            name = attrs.get('name') or attrs.get('property') or ''
            content = attrs.get('content') or ''
            self.metadata.setdefault(name.lower(), []).append(content[:4000])
        if tag == 'title':
            self.in_title = True
        if re.fullmatch('h[1-6]', tag):
            self.in_heading, self.heading = True, ''
        if tag == 'a' and attrs.get('href'):
            self.anchor = [urljoin(self.url, attrs['href']), [], self.heading]

    def handle_endtag(self, tag):
        if self.ignored:
            if tag == self.ignored[-1]:
                self.ignored.pop()
            return
        if tag == 'title':
            self.in_title = False
        if re.fullmatch('h[1-6]', tag):
            self.in_heading = False
        if tag == 'a' and self.anchor:
            if len(self.links) < 200:
                url, label, context = self.anchor
                self.links.append(PageLink(url, ' '.join(label).strip()[:500], context[:500]))
            self.anchor = None

    def handle_data(self, data):
        if self.ignored:
            return
        data = ' '.join(data.split())
        if not data:
            return
        if self.in_title:
            self.title += data
        if self.in_heading:
            self.heading += data
        if self.anchor:
            self.anchor[1].append(data)
        if sum(map(len, self.body)) < 16000:
            self.body.append(data)

    def first(self, *keys):
        return next((self.metadata[k][0] for k in keys if self.metadata.get(k)), '')


class InspectionCancelled(Exception):
    pass


class ResourceInspector:
    """A single bounded inspection. The fetch seam is also used by literature.py."""
    def __init__(self, fetch=None, clock=time.monotonic):
        self.fetch = fetch or PublicMetadata().fetch
        self.clock = clock

    def inspect(self, draft, cancelled):
        started, requests, resources, warnings = self.clock(), 0, {}, []

        def fetch(url, **_options):
            nonlocal requests
            if cancelled.is_set():
                raise InspectionCancelled()
            remaining = 50 - (self.clock() - started)
            if requests >= 18 or remaining <= 0:
                raise Invalid('Inspection limit reached; unresolved references remain saved')
            requests += 1
            return self.fetch(url, timeout=min(6, remaining), limit=1024 * 1024)

        def add(resource):
            if len(resources) >= 32 and resource.id not in resources:
                return
            previous = resources.get(resource.id)
            resources[resource.id] = previous.merge(resource) if previous else resource

        seed = ResearchResource.linked(draft.seedUrl, draft.seedUrl, 'Submitted research link')
        add(seed)
        try:
            if seed.kind == 'web_article':
                page = fetch(seed.url)
                parsed = ResearchPage(page.url)
                parsed.feed(page.text)
                seed = replace(seed, title=(parsed.first('og:title', 'citation_title') or parsed.title.strip() or seed.url)[:1000],
                               excerpt='\n'.join(parsed.body)[:8000], authors=tuple(a.strip()[:300] for a in parsed.metadata.get('citation_author', parsed.metadata.get('author', [])) if a.strip())[:30],
                               confidence='metadata', evidence=(Evidence(page.url, 'Page title, byline and explicit links'),))
                add(seed)
                for link in parsed.links:
                    try:
                        resource = ResearchResource.linked(link.url, page.url, link.label, link.context)
                    except Invalid:
                        continue
                    # Navigation, images, and same-page anchors are not research candidates.
                    if resource.id == seed.id or (resource.kind == 'web_article' and not re.search(r'paper|project|research|code|model|benchmark|bigquery|forecast', link.label, re.I)):
                        continue
                    if re.search(r'bigquery|forecast', link.label, re.I) and resource.kind == 'web_article':
                        resource = replace(resource, kind='service')
                    add(resource)
            # Discover only seed-linked resources and one metadata link neighborhood.
            processed = set()
            while True:
                pending = [r for r in resources.values() if r.id not in processed and r.kind in ('code', 'model', 'dataset', 'paper', 'benchmark', 'service')]
                if not pending:
                    break
                resource = min(pending, key=lambda r: {'model': 0, 'code': 1, 'paper': 2}.get(r.kind, 3))
                processed.add(resource.id)
                try:
                    updated, links = self.resolve(resource, fetch)
                    add(updated)
                    for linked in links:
                        add(linked)
                except (Invalid, ValueError, TypeError, KeyError) as error:
                    detail = error.detail if isinstance(error, Invalid) else "Provider metadata could not be verified"
                    add(replace(resource, confidence='unresolved', unresolved=(*resource.unresolved, detail)))
                if len(processed) >= 12:
                    warnings.append('Follow-up lookup limit reached; remaining links are unverified.')
                    break
            if not any(r.kind == 'paper' for r in resources.values()):
                warnings.append('No identifiable paper link was found. This article is not a peer-reviewed paper.')
            if not any(r.kind == 'dataset' for r in resources.values()):
                warnings.append('No concrete downloadable dataset was identified; benchmark links are references only.')
            return draft.finish(resources.values(), warnings)
        except InspectionCancelled:
            return draft.finish(resources.values(), warnings, 'cancelled', 'Inspection cancelled. Saved references are unchanged.')
        except Invalid as error:
            add(replace(seed, confidence='unresolved', unresolved=(error.detail,)))
            # A failed seed fetch is still reviewable as an explicitly unresolved reference.
            return draft.finish(resources.values(), (*warnings, error.detail), 'ready')

    def resolve(self, resource, fetch):
        links = []
        if resource.unresolved and resource.revision and resource.identity.startswith(('hf:', 'github:')):
            return resource, links
        if resource.identity.startswith('hf:'):
            original_kind = resource.identity.split(':')[1]
            prefix = {'model': 'models', 'dataset': 'datasets', 'service': 'spaces'}[original_kind]
            path = urlsplit(resource.url).path.strip('/')
            repo = path.removeprefix('datasets/').removeprefix('spaces/')
            document = fetch('https://huggingface.co/api/' + prefix + '/' + repo + '?blobs=true')
            value = _scalars(json.loads(document.text))
            if not isinstance(value, dict):
                raise Invalid('Hugging Face metadata is unavailable')
            revision = value.get('sha')
            revision = revision if isinstance(revision, str) and re.fullmatch(r'[a-f0-9]{40}', revision) else None
            card = value.get('cardData') if isinstance(value.get('cardData'), dict) else {}
            license = card.get('license_name') or card.get('license')
            license = license.strip() if isinstance(license, str) and len(license) <= 200 and license.strip().lower() not in ('other', 'unknown', '', 'none', 'null', 'n/a', 'unspecified') else None
            unresolved = []
            if not license:
                unresolved.append('License is unknown; download unavailable.')
            if not revision:
                unresolved.append('Revision is unresolved; download unavailable.')
            restricted = bool(value.get('private') or value.get('gated'))
            if restricted:
                unresolved.append('Private or gated resource; no authenticated download is attempted.')
            assets = []
            siblings = value.get('siblings') or []
            if not isinstance(siblings, list):
                siblings = []
                unresolved.append('File metadata is unavailable; download disabled.')
            for file in siblings[:1000]:
                if not isinstance(file, dict):
                    continue
                name, lfs = file.get('rfilename'), file.get('lfs')
                if not (original_kind in ('model', 'dataset') and resource.kind != 'benchmark' and license and revision and not restricted and isinstance(name, str) and isinstance(lfs, dict) and re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*/[A-Za-z0-9_][A-Za-z0-9_.-]*', repo)):
                    continue
                size, sha = lfs.get('size'), lfs.get('sha256')
                if (type(size) is not int or not 0 < size <= 100 * 1024**3 or not isinstance(sha, str) or not re.fullmatch('[a-f0-9]{64}', sha)
                        or len(name.rsplit('/', 1)[-1]) > 200 or any(not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', p) for p in name.split('/')) or '\\' in name or re.search(r'[\x00-\x1f]', name)):
                    continue
                if len(assets) >= 16:
                    unresolved.append('File list exceeds the 16-file review limit; additional files are not offered.')
                    break
                asset_url = resource.url + '/resolve/' + revision + '/' + quote(name, safe='/')
                assets.append(ResearchAsset.create(resource.title[:300], original_kind, name, size, license, revision, resource.url, asset_url, sha))
            tags = value.get('tags', [])
            for tag in tags if isinstance(tags, list) else []:
                if isinstance(tag, str) and tag.startswith('arxiv:'):
                    try:
                        links.append(ResearchResource.linked('https://arxiv.org/abs/' + tag[6:], resource.url, 'Paper cited by the model card (may describe an earlier version)'))
                    except Invalid:
                        pass
            resource = replace(resource, title=(value.get('id') if isinstance(value.get('id'), str) else resource.title)[:1000], revision=revision, license=license,
                               size=sum(a.size for a in assets) if assets else None, assets=tuple(assets), confidence='metadata',
                               unresolved=tuple(unresolved), evidence=(*resource.evidence, Evidence(document.url, 'Hugging Face API metadata; file sizes and LFS SHA-256 at revision')))
        elif resource.kind == 'code' and resource.identity.startswith('github:'):
            repo = resource.identity.removeprefix('github:')
            document = fetch('https://api.github.com/repos/' + repo)
            value = _scalars(json.loads(document.text))
            if not isinstance(value, dict) or value.get('private') or not isinstance(value.get('full_name'), str) or not value['full_name']:
                raise Invalid('Public GitHub repository metadata is unavailable')
            license = value.get('license') or {}
            license = license.get('spdx_id') if isinstance(license, dict) else None
            license = license if isinstance(license, str) and license and license != 'NOASSERTION' else None
            resource = replace(resource, title=value['full_name'][:1000], license=license, confidence='metadata',
                               excerpt=(value.get('description') if isinstance(value.get('description'), str) else '')[:2000], unresolved=('Repository saved as reference only; cloning is not part of import.',),
                               evidence=(*resource.evidence, Evidence(document.url, 'GitHub public repository metadata')))
        elif resource.kind == 'paper':
            # Reuse the existing stable identifier/resolver, but route all its HTTP through this inspection's budget.
            def literature_fetch(url, *, timeout, headers):
                page = fetch(url)
                response = io.BytesIO(page.text.encode('utf-8'))
                response.status, response.headers = 200, {'Content-Type': page.content_type}
                return response
            value = LiteratureClient(fetch=literature_fetch).read({'id': resource.originalUrl if resource.revision else resource.url, 'full': False})
            aliases = tuple('doi:' + value['doi'].lower().removeprefix('https://doi.org/') for _ in [0] if value.get('doi'))
            resource = replace(resource, title=value['title'][:1000], authors=tuple(value.get('authors', []))[:100],
                               excerpt=value.get('content', '')[:8000], contentKind=value.get('contentKind', 'abstract'), aliases=aliases,
                               confidence='metadata', evidence=(*resource.evidence, Evidence(value.get('metadataUrl', resource.url), 'Literature metadata; cited work, not necessarily this release')))
        return resource, links
