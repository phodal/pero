"""Metadata-only diagnostics around the real transport, never an identity authority."""
from hashlib import sha256
import json
from pathlib import Path
import re

from paper_agent.arxiv_html import DROP, Node, Tree
from paper_agent.resource_fetch import PublicMetadata
from paper_agent.scientific_document import DocumentError, ParseLimits


def response_summary(response):
    summary = dict(responseUrl=response.url, mime=response.mime, byteLength=len(response.data),
                   sha256=sha256(response.data).hexdigest(), identityAdmission='diagnostic-only')
    try:
        tree = Tree(ParseLimits())
        tree.feed(response.data.decode('utf-8'))
        tree.close()
    except (DocumentError, UnicodeDecodeError):
        return dict(summary, structure='unavailable')
    metadata, markers = [], []
    # Fixed metadata field names only; values are hashes and syntactic arXiv IDs.
    fields = {'citation_arxiv_id', 'citation_pdf_url', 'citation_id', 'arxiv_id',
              'dc.identifier', 'DC.identifier', 'og:url', 'twitter:url'}
    identity = re.compile(r'(?<![\w.])\d{4}\.\d{4,5}(?:v\d{1,6})?(?![\w.])')

    def visit(node, path):
        if node.tag in DROP or (node.tag == 'article' and node.has('ltx_document')):
            return
        # Restricted arXiv names and known LaTeXML page furniture, never arbitrary attrs.
        classes = [name for name in node.attrs.get('class', '').split()
                   if (re.fullmatch(r'arxiv[-_][a-zA-Z_-]{1,60}', name)
                       or name in {'ltx_page_header', 'ltx_page_footer', 'ltx_header'})][:4]
        tag = node.tag if node.tag in {'root', 'html', 'head', 'body', 'header', 'footer', 'nav', 'div', 'span', 'p', 'a', 'b', 'i', 'strong', 'small'} else 'other'
        location = path + [dict(tag=tag, classes=classes)]
        in_head = any(part['tag'] == 'head' for part in location)
        field = node.attrs.get('name') or node.attrs.get('property', '')
        if in_head and node.tag == 'meta' and field in fields:
            value = node.attrs.get('content', '')
            metadata.append(dict(field=field, sha256=sha256(value.encode()).hexdigest(),
                                 ids=identity.findall(value)[:8]))
        if in_head and node.tag == 'link' and 'canonical' in node.attrs.get('rel', '').split():
            value = node.attrs.get('href', '')
            metadata.append(dict(field='link:canonical', sha256=sha256(value.encode()).hexdigest(),
                                 ids=identity.findall(value)[:8]))
        for child in node.children:
            if isinstance(child, Node):
                visit(child, location)
            else:
                ids = re.findall(r'arXiv:\s*(\d{4}\.\d{4,5}(?:v\d{1,6})?)(?![\w.])', child)
                if ids:
                    markers.append(dict(path=location[-8:], ids=ids[:8],
                                        sha256=sha256(child.encode()).hexdigest()))

    visit(tree.root, [])
    return dict(summary, identityMetadata=metadata[:32], identityMetadataCount=len(metadata),
                outsideArticleMarkers=markers[:32], outsideArticleMarkerCount=len(markers))


class DiagnosticMetadata(PublicMetadata):
    def __init__(self, directory):
        super().__init__()
        self.directory = directory

    def fetch_html(self, url, **kwargs):
        response = super().fetch_html(url, **kwargs)
        (Path(self.directory) / 'response-summary.json').write_text(json.dumps(response_summary(response)))
        return response
