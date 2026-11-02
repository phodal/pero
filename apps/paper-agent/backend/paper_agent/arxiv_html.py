"""Bounded LaTeXML HTML adapter. Produces values, never executable source HTML."""
from dataclasses import dataclass, field, replace
from html import escape
from html.parser import HTMLParser
import re
from urllib.parse import unquote, urljoin, urlsplit

from .scientific_document import (DocumentError, DocumentSource, ImageReference, Inline,
                                  PaperBlock, ParseLimits, ParseManifest, ScientificDocument, TableCell, SourceLocator, DocumentMetadata)

VOID = frozenset('area base br col embed hr img input link meta param source track wbr'.split())
DROP = frozenset('script style iframe object embed svg form button input textarea select template noscript'.split())
MATH = frozenset(('math mrow mi mn mo mtext ms mspace msup msub msubsup mfrac msqrt mroot '
                  'munder mover munderover mtable mtr mtd mlabeledtr mfenced menclose mpadded '
                  'mphantom mmultiscripts mprescripts none semantics').split())
MATH_ATTRS = frozenset(('display mathvariant stretchy fence separator accent accentunder '
                       'columnalign rowalign columnspan rowspan open close separators notation '
                       'linethickness bevelled').split())


@dataclass
class Node:
    tag: str
    attrs: dict[str, str]
    children: list = field(default_factory=list)
    start: int | None = None
    end: int | None = None
    start_line: int | None = None
    end_line: int | None = None
    inherited_conversion_error: bool = False

    def has(self, name):
        return name in self.attrs.get('class', '').split()

    def nodes(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.nodes()


class Tree(HTMLParser):
    def __init__(self, limits, original=""):
        super().__init__(convert_charrefs=True)
        self.root = Node('root', {})
        self.stack = [self.root]
        self.limits, self.count = limits, 0
        self.original = original
        self.line, self.line_start = 1, 0

    def source_offset(self):
        line, column = self.getpos()
        while self.line < line:
            self.line_start = self.original.find("\n", self.line_start) + 1
            self.line += 1
        return self.line_start + column

    def handle_starttag(self, tag, attrs):
        self.count += 1
        if self.count > self.limits.max_nodes or len(self.stack) > self.limits.max_depth:
            raise DocumentError('HTML node/depth limit exceeded', 'document_limit', 413)
        start = self.source_offset() if self.original else None
        node = Node(tag, dict((k, v or '') for k, v in attrs), start=start, start_line=self.getpos()[0] if start is not None else None)
        if tag in VOID and start is not None:
            node.end = start + len(self.get_starttag_text())
            node.end_line = node.start_line + self.get_starttag_text().count("\n")
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            node = self.stack.pop()
            if node.start is not None:
                node.end = node.start + len(self.get_starttag_text())
                node.end_line = node.start_line + self.get_starttag_text().count("\n")

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                if self.original:
                    end = self.original.find(">", self.source_offset())
                    self.stack[index].end = end + 1 if end >= 0 else None
                    self.stack[index].end_line = self.getpos()[0] if end >= 0 else None
                del self.stack[index:]
                break

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def _text(node):
    if isinstance(node, str):
        return node
    if node.tag in DROP or node.tag in ('annotation', 'annotation-xml'):
        return ''
    if node.tag == 'br':
        return '\n'
    return ''.join(_text(c) for c in node.children)


def _math(node):
    if isinstance(node, str):
        return escape(node)
    if node.tag not in MATH:
        return ''
    attributes = ''.join(f' {key}="{escape(value, quote=True)}"'
                         for key, value in sorted(node.attrs.items()) if key in MATH_ATTRS)
    if node.tag == 'math':
        attributes += ' xmlns="http://www.w3.org/1998/Math/MathML"'
    return f'<{node.tag}{attributes}>' + ''.join(_math(c) for c in node.children) + f'</{node.tag}>'


def safe_mathml(markup):
    """Re-establish the allowlist at the stored/exported-value boundary."""
    tree = Tree(ParseLimits(max_nodes=20_000, max_depth=100))
    tree.feed(markup)
    tree.close()
    return ''.join(_math(n) for n in tree.root.children if isinstance(n, Node) and n.tag == 'math')


def safe_link(url):
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.port not in (None, 443) or re.search(r'[\x00-\x20\\]', url)):
            return ''
    except ValueError:
        return ''
    return url


class Extractor:
    def __init__(self, source, limits, base_url, original):
        self.source, self.limits, self.base_url = source, limits, base_url
        self.blocks, self.warnings = [], set()
        self.text_length = 0
        self.original = original

    def content(self, node, warnings):
        if isinstance(node, str):
            return [Inline('text', node)] if node else []
        if node.has('ltx_ERROR') or node.has('ltx_error'):
            warnings.add('source-conversion-error')
        if node.tag in DROP:
            warnings.add('active-content-omitted')
            return []
        if node.tag == 'math':
            latex = node.attrs.get('alttext', '')
            if not latex:
                latex = next((''.join(_text(c) for c in n.children) for n in node.nodes() if n.tag == 'annotation'
                              and n.attrs.get('encoding') == 'application/x-tex'), '')
            if not any(n is not node and n.tag in MATH for n in node.nodes()):
                warnings.add('math-presentation-unavailable')
            if any(n.tag not in MATH | {'annotation', 'annotation-xml'} for n in node.nodes()):
                warnings.add('unsupported-math-element')
            return [Inline('math', _text(node).strip() or latex, latex, _math(node))]
        if node.tag == 'br':
            return [Inline('text', '\n')]
        if node.tag == 'a':
            raw = node.attrs.get('href', '')
            try:
                absolute = urljoin(self.base_url, raw)
            except ValueError:
                absolute = ''
            url = safe_link(absolute)
            parsed, source = urlsplit(url), urlsplit(self.source.url)
            target = unquote(parsed.fragment) if (parsed.scheme, parsed.netloc, parsed.path.rstrip('/')) == (
                source.scheme, source.netloc, source.path) else ''
            if raw and not url:
                warnings.add('unsafe-link-omitted')
            return [replace(item, kind='link' if item.kind == 'text' else item.kind, target=target, url=url)
                    for child in node.children for item in self.content(child, warnings)]
        if node.has('ltx_note'):
            warnings.add('inline-note-as-text')
        if node.tag == 'img':
            warnings.add('image-bytes-not-acquired')
            return [Inline('text', node.attrs.get('alt', ''))]
        return [part for child in node.children for part in self.content(child, warnings)]

    def add(self, kind, node, section='', level=0, aliases=(), cells=(), images=(), original_node=None, limitations=()):
        warnings = set(limitations)
        # Structural extraction can skip wrappers (sections, table rows, captions).
        # A declared conversion failure still applies to the retained subtree.
        if any(n.inherited_conversion_error or n.has('ltx_ERROR') or n.has('ltx_error')
               for n in (original_node or node).nodes()):
            warnings.add('source-conversion-error')
        content = tuple(self.content(node, warnings))
        if kind in ('code', 'algorithm', 'theorem'):
            content = (Inline('text', _text(node)),)
        anchors = tuple(dict.fromkeys((*aliases, *(n.attrs['id'] for n in node.nodes() if n.attrs.get('id')))))
        origin = original_node or node
        locator = SourceLocator(origin.start, origin.end, origin.start_line, origin.end_line) if origin.start is not None and origin.end is not None else None
        if locator is None:
            warnings.add('original-element-window-unavailable')
        self.warnings.update(warnings)
        block = PaperBlock(f'b{len(self.blocks) + 1:06}', kind, content, anchors, section, level, cells, images, locator, tuple(sorted(warnings)))
        if not block.text.strip() and not images:
            return ''
        self.text_length += len(block.text)
        if len(self.blocks) >= self.limits.max_blocks or self.text_length > self.limits.max_text:
            raise DocumentError('Extracted document limit exceeded', 'document_limit', 413)
        self.blocks.append(block)
        return block.id

    def table(self, node, section):
        tables = [n for n in node.nodes() if n.tag == 'table' and not n.has('ltx_equation')]
        table = tables[0] if tables else node
        if len(tables) > 1:
            self.warnings.add('nested-or-multiple-tables-as-text')
            self.add('table', node, section, limitations=('nested-or-multiple-tables-as-text',))
            return
        rows = [n for n in table.nodes() if n.tag == 'tr']
        cells, occupied, warnings = [], set(), set()
        for row, tr in enumerate(rows):
            column = 0
            for cell in (n for n in tr.children if isinstance(n, Node) and n.tag in ('td', 'th')):
                while (row, column) in occupied:
                    column += 1
                spans = []
                for attribute in ('rowspan', 'colspan'):
                    raw = cell.attrs.get(attribute, '1')
                    if not re.fullmatch(r'[1-9]\d{0,3}', raw):
                        raise DocumentError('Unsupported table span; retain the original source')
                    spans.append(int(raw))
                rowspan, colspan = spans
                if len(occupied) + rowspan * colspan > self.limits.max_table_slots:
                    raise DocumentError('Table cell limit exceeded', 'document_limit', 413)
                slots = {(r, c) for r in range(row, row + rowspan) for c in range(column, column + colspan)}
                if occupied & slots:
                    raise DocumentError('Overlapping table cells; retain the original source')
                occupied.update(slots)
                cells.append(TableCell(row, column, rowspan, colspan, cell.tag == 'th', tuple(self.content(cell, warnings))))
                column += colspan
        captions = [n for n in node.nodes() if n.tag in ('caption', 'figcaption')]
        caption = captions[0] if captions else Node('span', {}, [])
        if not cells:
            self.add('table', node, section, limitations=('table-structure-unavailable',))
        else:
            self.add('table', caption, section,
                     aliases=tuple(n.attrs['id'] for n in node.nodes() if n.attrs.get('id')), cells=tuple(cells), original_node=node, limitations=warnings)

    def walk(self, node, section='', aliases=(), inherited_conversion_error=False):
        if isinstance(node, str):
            if node.strip():
                self.warnings.add('unclassified-text-preserved')
                self.add('paragraph', Node('span', {}, [node], inherited_conversion_error=inherited_conversion_error), section, limitations=('unclassified-text-preserved',))
            return
        node.inherited_conversion_error = inherited_conversion_error
        conversion_error = inherited_conversion_error or node.has('ltx_ERROR') or node.has('ltx_error')
        if conversion_error:
            self.warnings.add('source-conversion-error')
        if node.tag in DROP:
            self.warnings.add('active-content-omitted')
            return
        if node.tag in ('header', 'footer', 'nav'):
            self.warnings.add('document-furniture-omitted')
            return
        if node.has('ltx_authors'):
            return
        if node.tag == 'section' or node.has('ltx_abstract') or node.has('ltx_bibliography'):
            current = section
            anchor = node.attrs.get('id', '')
            for child in node.children:
                before = len(self.blocks)
                self.walk(child, current, (anchor,) if anchor else (), conversion_error)
                if len(self.blocks) > before and self.blocks[before].kind == 'heading':
                    current = self.blocks[before].id
            return
        if node.tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            title = node.has('ltx_title_document') or (node.tag == 'h1' and not any(b.kind == 'title' for b in self.blocks))
            level = 2 if node.has('ltx_title_abstract') or _text(node).strip() == 'Abstract' else int(node.tag[1])
            self.add('title' if title else 'heading', node, section, level, aliases)
        elif node.tag == 'math':
            self.add('equation' if node.attrs.get('display') == 'block' else 'paragraph', node, section)
        elif node.has('ltx_equation') or node.has('ltx_equationgroup'):
            self.add('equation', node, section)
        elif node.tag == 'table' or node.has('ltx_table'):
            self.table(node, section)
        elif node.tag == 'figure' or node.has('ltx_figure'):
            images = []
            for image in (n for n in node.nodes() if n.tag == 'img'):
                try:
                    url = safe_link(urljoin(self.base_url, image.attrs.get('src', '')))
                except ValueError:
                    url = ''
                if url:
                    images.append(ImageReference(url, image.attrs.get('alt', '')))
            self.warnings.add('image-bytes-not-acquired')
            captions = [n for n in node.nodes() if n.tag == 'figcaption']
            caption = Node('div', {}, [part for n in captions for part in (n, '\n')]) if captions else node
            self.add('figure', caption, section,
                     aliases=tuple(n.attrs['id'] for n in node.nodes() if n.attrs.get('id')),
                     images=tuple(images), original_node=node)
        elif node.has('ltx_bibitem'):
            self.add('reference', node, section)
        elif node.tag == 'pre':
            self.add('code', node, section)
        elif node.has('ltx_note'):
            self.add('footnote', node, section)
        elif node.tag == 'p':
            self.add('paragraph', node, section)
        elif node.tag == 'li':
            limitations = ('nested-list-relationship-unavailable',) if any(isinstance(c, Node) and c.tag in ('ul', 'ol') for c in node.children) else ()
            self.add('list-item', node, section, limitations=limitations)
        else:
            if node.has('ltx_ERROR') or node.has('ltx_error'):
                self.add('paragraph', node, section)
                return
            if node.has('ltx_theorem') or node.has('ltx_algorithm'):
                kind = 'theorem' if node.has('ltx_theorem') else 'algorithm'
                self.add(kind, node, section, limitations=(kind + '-structure-unavailable',))
                return
            for child in node.children:
                self.walk(child, section, inherited_conversion_error=conversion_error)


def _scaffold_identity(root, article):
    """Read arXiv's server-rendered license watermark, not arbitrary body text."""
    candidates = []

    def contains_article(node):
        if node.tag in DROP:
            return False
        return node is article or any(contains_article(child) for child in node.children if isinstance(child, Node))

    def visit(node):
        if node.tag == 'article' or node.tag in DROP:
            return
        children = [child for child in node.children if isinstance(child, Node)]
        for index, child in enumerate(children):
            if (child.tag == 'div' and child.attrs.get('id') == 'infobox' and child.has('infobox')
                    and any(sibling.tag == 'div' and sibling.has('ltx_page_content')
                            and contains_article(sibling)
                            for sibling in children[index + 1:])):
                candidates.append((child, children[index + 1]))
            visit(child)

    visit(root)
    if len(candidates) > 1:
        raise DocumentError('Ambiguous HTML identity watermark', 'source_version_mismatch')
    if not candidates:
        return ()
    box, following = candidates[0]
    if (not following.has('ltx_page_content')
            or not contains_article(following)):
        return ()
    children = [child for child in box.children if isinstance(child, Node)]
    watermarks = [child for child in children if child.tag == 'div' and child.attrs.get('id') == 'watermark-tr']
    if len(watermarks) > 1:
        raise DocumentError('Ambiguous HTML identity watermark', 'source_version_mismatch')
    if len(children) != 2 or len(watermarks) != 1:
        return ()
    license_node, watermark = children
    if (watermark is not watermarks[0] or license_node.tag != 'a'
            or license_node.attrs.get('id') != 'license-tr'
            or license_node.attrs.get('href') != 'https://info.arxiv.org/help/license/index.html#licenses-available'
            or any(isinstance(child, Node) for child in watermark.children)):
        return ()
    match = re.fullmatch(
        r'\s*arXiv:(\d{4}\.\d{4,5}v[1-9]\d*)\s+(?:\[[A-Za-z][A-Za-z0-9.-]*\]\s+)?'
        r'\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\s*',
        ''.join(watermark.children))
    return (('scaffold:watermark-tr', match[1]),) if match else ()


def parse_arxiv_html(data: bytes, source_url: str, paper_id: str = '', *, limits=ParseLimits(), requested_url=None):
    if not isinstance(data, bytes) or len(data) > limits.max_bytes:
        raise DocumentError('HTML byte limit exceeded', 'document_limit', 413)
    source = DocumentSource.of(source_url, data, requested_url)
    try:
        text = data.decode('utf-8')  # Preserve a BOM in original character offsets.
    except UnicodeDecodeError as error:
        raise DocumentError('The HTML source must be UTF-8') from error
    tree = Tree(limits, text)
    tree.feed(text)
    tree.close()
    articles = [n for n in tree.root.nodes() if n.tag == 'article' and n.has('ltx_document')]
    if len(articles) != 1:
        raise DocumentError('No unique LaTeXML article; keep using the original PDF', 'html_unavailable', 422)
    identity_evidence = []
    for node in tree.root.nodes():
        declared, origin = '', ''
        if node.tag == 'meta' and node.attrs.get('name') == 'citation_arxiv_id':
            declared = node.attrs.get('content', '').removeprefix('arXiv:')
            origin = 'meta:citation_arxiv_id'
        elif (node.tag == 'meta' and node.attrs.get('name') == 'citation_pdf_url') or (node.tag == 'link' and 'canonical' in node.attrs.get('rel', '').split()):
            origin = 'meta:citation_pdf_url' if node.tag == 'meta' else 'link:canonical'
            raw = node.attrs.get('content' if node.tag == 'meta' else 'href', '')
            try:
                parsed = urlsplit(raw)
                match = re.fullmatch(r'/(?:abs|html|pdf)/(.+?)(?:\.pdf)?', parsed.path)
                if parsed.scheme == 'https' and parsed.netloc == 'arxiv.org' and not parsed.query and not parsed.fragment and match:
                    declared = match[1]
            except ValueError:
                pass
        if declared:
            identity_evidence.append((origin, declared))
    identity_evidence.extend(_scaffold_identity(tree.root, articles[0]))
    for _, declared in identity_evidence:
        if declared not in (source.arxiv_id, re.sub(r'v\d+$', '', source.arxiv_id)):
            raise DocumentError('HTML identity differs from the requested version', 'source_version_mismatch')
    explicit_response_version = any(declared == source.arxiv_id for _, declared in identity_evidence)
    base_url = source.url
    for node in tree.root.nodes():
        if node.tag == 'base':
            try:
                candidate = urljoin(source.url, node.attrs.get('href', ''))
            except ValueError:
                continue
            if candidate == source.url + '/':
                base_url = candidate
    extractor = Extractor(source, limits, base_url, text)
    extractor.walk(articles[0])
    if len(extractor.blocks) < 2 or not any(b.kind == 'title' for b in extractor.blocks):
        raise DocumentError('HTML article has no usable title/content', 'html_unavailable')
    if not explicit_response_version:
        extractor.warnings.add('response-version-unconfirmed')
    anchors, anchor_counts = {}, {}
    for block in extractor.blocks:
        for anchor in block.anchors:
            anchor_counts[anchor] = anchor_counts.get(anchor, 0) + 1
            if anchor in anchors and anchors[anchor] != block.id:
                extractor.warnings.add('ambiguous-source-anchor')
            anchors[anchor] = block.id
    def resolved(token):
        if not token.target:
            return token
        count = anchor_counts.get(token.target, 0)
        status = 'unresolved' if not count else 'source-anchor' if count == 1 else 'ambiguous'
        if status == 'unresolved':
            extractor.warnings.add('unresolved-reference')
        return replace(token, target_status=status)
    extractor.blocks = [replace(block, content=tuple(resolved(token) for token in block.content),
        cells=tuple(replace(cell, content=tuple(resolved(token) for token in cell.content)) for cell in block.cells))
        for block in extractor.blocks]
    author_groups = [node for node in articles[0].nodes() if node.has('ltx_authors')]
    authors = tuple(dict.fromkeys(_text(node).strip() for group in author_groups for node in group.nodes() if node.has('ltx_personname') and _text(node).strip()))
    if not authors:
        authors = tuple(dict.fromkeys(node.attrs.get('content', '') for node in tree.root.nodes() if node.tag == 'meta' and node.attrs.get('name') == 'citation_author' and node.attrs.get('content')))
    abstracts = [node for node in articles[0].nodes() if node.has('ltx_abstract')]
    abstract = ''.join(_text(child) for child in abstracts[0].children if not isinstance(child, Node) or child.tag not in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6')).strip() if len(abstracts) == 1 else ''
    doi = tuple(dict.fromkeys(node.attrs['content'] for node in tree.root.nodes() if node.tag == 'meta' and node.attrs.get('name') == 'citation_doi' and node.attrs.get('content')))
    dates = tuple(dict.fromkeys(node.attrs['content'] for node in tree.root.nodes() if node.tag == 'meta' and node.attrs.get('name') == 'citation_publication_date' and node.attrs.get('content')))
    if len(dates) > 1:
        extractor.warnings.add('ambiguous-publication-date')
    metadata = DocumentMetadata(next(b.text for b in extractor.blocks if b.kind == 'title'), authors, abstract,
                                (('arxiv', source.arxiv_id),) + tuple(('doi', value) for value in doi), dates[0] if len(dates) == 1 else None)
    return ScientificDocument(paper_id, source, tuple(extractor.blocks), tuple(sorted(extractor.warnings)), ParseManifest(limits=limits, source_identity='response-explicit-version' if explicit_response_version else 'version-unconfirmed', identity_evidence=tuple(identity_evidence)), metadata)
