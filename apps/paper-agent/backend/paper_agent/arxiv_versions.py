"""Official Atom identifiers freeze versions; titles/dates never infer a version."""
from dataclasses import dataclass, replace
import re
from urllib.parse import quote, urlsplit
import xml.etree.ElementTree as ET

from .literature import ARXIV
from .model import Invalid
from .research_resources import Evidence, ResearchResource


@dataclass(frozen=True)
class ArxivVersion:
    work: str
    revision: str
    metadata_url: str

    @classmethod
    def parse(cls, work, document):
        url = urlsplit(document.url)
        if url.scheme != 'https' or url.hostname not in ('export.arxiv.org', 'arxiv.org') or url.path != '/api/query' or url.username or url.password or url.port:
            raise Invalid('arXiv version metadata left the official API endpoint')
        if document.content_type not in ('application/atom+xml', 'application/xml', 'text/xml'):
            raise Invalid('Official arXiv version metadata did not return XML')
        if len(document.text) > 1024 * 1024 or re.search(r'<!\s*(DOCTYPE|ENTITY)\b', document.text, re.I):
            raise Invalid('Unsafe or oversized arXiv version metadata')
        try:
            root = ET.fromstring(document.text)
            entries = root.findall('{http://www.w3.org/2005/Atom}entry')
            if root.tag != '{http://www.w3.org/2005/Atom}feed' or len(entries) != 1:
                raise ValueError()
            ids = entries[0].findall('{http://www.w3.org/2005/Atom}id')
            if len(ids) != 1 or len(ids[0]):
                raise ValueError()
            identifier = ids[0].text or ''
            if len(identifier) > 256:
                raise ValueError()
            parsed = urlsplit(identifier.strip())
            value = parsed.path.removeprefix('/abs/')
            match = re.fullmatch(r'(.+?)(v[1-9]\d*)', value)
            if (parsed.scheme not in ('http', 'https') or parsed.hostname != 'arxiv.org' or parsed.username or parsed.password
                    or parsed.port or parsed.query or parsed.fragment or not parsed.path.startswith('/abs/')
                    or not ARXIV.fullmatch(value) or not match or match[1].lower() != work.lower()):
                raise ValueError()
        except (ET.ParseError, ValueError) as error:
            raise Invalid('Official arXiv metadata did not identify the requested work with an explicit version') from error
        return cls(work, match[2], document.url)


def unpinned_work(resource):
    if resource.revision:
        return None
    if resource.identity.startswith('arxiv:'):
        return resource.identity.removeprefix('arxiv:')
    url = urlsplit(resource.originalUrl)
    parts = url.path.strip('/').split('/', 1)
    if url.hostname in ('arxiv.org', 'www.arxiv.org') and len(parts) == 2 and parts[0] in ('abs', 'src', 'e-print', 'pdf'):
        work = parts[1].removesuffix('.pdf')
        if ARXIV.fullmatch(work) and not re.search(r'v\d+$', work):
            return work
    return None


def freeze_version(resource, version):
    evidence = Evidence(version.metadata_url, 'Official Atom entry.id fixes ' + version.work + version.revision,
                        'https://arxiv.org/abs/' + version.work + version.revision, 'arxiv_api_version')
    if resource.kind in ('source_archive', 'pdf_candidate'):
        endpoint = 'src' if resource.kind == 'source_archive' else 'pdf'
        pinned = ResearchResource.linked('https://arxiv.org/' + endpoint + '/' + version.work + version.revision,
                                         resource.originalUrl, resource.title, evidence_kind='documented_endpoint')
        return replace(pinned, evidence=(*resource.evidence, evidence, *pinned.evidence))
    return replace(resource, workIdentity='arxiv:' + version.work, revision=version.revision,
                   evidence=(*resource.evidence, evidence))


def metadata_url(work):
    return 'https://export.arxiv.org/api/query?id_list=' + quote(work, safe='')
