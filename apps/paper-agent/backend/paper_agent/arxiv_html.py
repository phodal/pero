"""Bounded LaTeXML HTML adapter. Produces values, never executable source HTML."""
from dataclasses import dataclass, field, replace
from html import escape
from html.parser import HTMLParser
import re
from urllib.parse import unquote, urljoin, urlsplit

from .scientific_document import (DocumentError, DocumentSource, ImageReference, Inline,
                                  PaperBlock, ParseLimits, ScientificDocument, TableCell)

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

    def has(self, name):
        return name in self.attrs.get('class', '').split()

    def nodes(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.nodes()


class Tree(HTMLParser):
    def __init__(self, limits):
        super().__init__(convert_charrefs=True)
        self.root = Node('root', {})
        self.stack = [self.root]
        self.limits, self.count = limits, 0

    def handle_starttag(self, tag, attrs):
        self.count += 1
        if self.count > self.limits.max_nodes or len(self.stack) > self.limits.max_depth:
            raise DocumentError('HTML node/depth limit exceeded', 'document_limit', 413)
        node = Node(tag, dict((k, v or '') for k, v in attrs))
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
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
    def __init__(self, source, limits, base_url):
        self.source, self.limits, self.base_url = source, limits, base_url
        self.blocks, self.warnings = [], set()
        self.text_length = 0

    def content(self, node):
        if isinstance(node, str):
            return [Inline('text', re.sub(r'\s+', ' ', node))] if node else []
        if node.tag in DROP:
            self.warnings.add('active-content-omitted')
            return []
        if node.tag == 'math':
            latex = node.attrs.get('alttext', '')
            if not latex:
                latex = next((''.join(_text(c) for c in n.children) for n in node.nodes() if n.tag == 'annotation'
                              and n.attrs.get('encoding') == 'application/x-tex'), '')
            if any(n.tag not in MATH | {'annotation', 'annotation-xml'} for n in node.nodes()):
                self.warnings.add('unsupported-math-element')
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
                self.warnings.add('unsafe-link-omitted')
            return [replace(item, kind='link' if item.kind == 'text' else item.kind, target=target, url=url)
                    for child in node.children for item in self.content(child)]
        if node.has('ltx_note'):
            self.warnings.add('inline-note-as-text')
        if node.tag == 'img':
            self.warnings.add('image-bytes-not-acquired')
            return [Inline('text', node.attrs.get('alt', ''))]
        return [part for child in node.children for part in self.content(child)]

    def add(self, kind, node, section='', level=0, aliases=(), cells=(), images=()):
        content = tuple(self.content(node))
        if kind == 'code':
            content = (Inline('text', _text(node)),)
        anchors = tuple(dict.fromkeys((*aliases, *(n.attrs['id'] for n in node.nodes() if n.attrs.get('id')))))
        block = PaperBlock(f'b{len(self.blocks) + 1:06}', kind, content, anchors, section, level, cells, images)
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
            self.add('table', node, section)
            return
        rows = [n for n in table.nodes() if n.tag == 'tr']
        cells, occupied = [], set()
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
                cells.append(TableCell(row, column, rowspan, colspan, cell.tag == 'th', tuple(self.content(cell))))
                column += colspan
        captions = [n for n in node.nodes() if n.tag in ('caption', 'figcaption')]
        caption = captions[0] if captions else Node('span', {}, [])
        if not cells:
            self.warnings.add('table-structure-unavailable')
            self.add('table', node, section)
        else:
            self.add('table', caption, section,
                     aliases=tuple(n.attrs['id'] for n in node.nodes() if n.attrs.get('id')), cells=tuple(cells))

    def walk(self, node, section='', aliases=()):
        if isinstance(node, str):
            if node.strip():
                self.warnings.add('unclassified-text-preserved')
                self.add('paragraph', Node('span', {}, [node]), section)
            return
        if node.tag in DROP:
            self.warnings.add('active-content-omitted')
            return
        if node.tag in ('header', 'footer', 'nav'):
            self.warnings.add('document-furniture-omitted')
            return
        if node.tag == 'section' or node.has('ltx_abstract') or node.has('ltx_bibliography'):
            current = section
            anchor = node.attrs.get('id', '')
            for child in node.children:
                before = len(self.blocks)
                self.walk(child, current, (anchor,) if anchor else ())
                if len(self.blocks) > before and self.blocks[before].kind == 'heading':
                    current = self.blocks[before].id
            return
        if node.tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            title = node.has('ltx_title_document') or node.tag == 'h1'
            level = 2 if node.has('ltx_title_abstract') or _text(node).strip() == 'Abstract' else int(node.tag[1])
            self.add('title' if title else 'heading', node, section, level, aliases)
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
                     images=tuple(images))
        elif node.has('ltx_bibitem'):
            self.add('reference', node, section)
        elif node.tag == 'pre':
            self.add('code', node, section)
        elif node.has('ltx_note'):
            self.add('footnote', node, section)
        elif node.tag == 'p':
            self.add('paragraph', node, section)
        elif node.tag == 'li' and not any(isinstance(c, Node) and c.tag in ('ul', 'ol') for c in node.children):
            self.add('list-item', node, section)
        else:
            if node.has('ltx_ERROR') or node.has('ltx_error'):
                self.warnings.add('source-conversion-error')
            if node.has('ltx_theorem') or node.has('ltx_algorithm'):
                self.warnings.add('theorem-or-algorithm-as-text')
            for child in node.children:
                self.walk(child, section)


def parse_arxiv_html(data: bytes, source_url: str, paper_id: str = '', *, limits=ParseLimits()):
    if not isinstance(data, bytes) or len(data) > limits.max_bytes:
        raise DocumentError('HTML byte limit exceeded', 'document_limit', 413)
    source = DocumentSource.of(source_url, data)
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError as error:
        raise DocumentError('The HTML source must be UTF-8') from error
    tree = Tree(limits)
    tree.feed(text)
    tree.close()
    articles = [n for n in tree.root.nodes() if n.tag == 'article' and n.has('ltx_document')]
    if len(articles) != 1:
        raise DocumentError('No unique LaTeXML article; keep using the original PDF', 'html_unavailable', 422)
    for node in tree.root.nodes():
        if node.tag == 'meta' and node.attrs.get('name') == 'citation_arxiv_id':
            declared = node.attrs.get('content', '').removeprefix('arXiv:')
            if declared not in (source.arxiv_id, re.sub(r'v\d+$', '', source.arxiv_id)):
                raise DocumentError('HTML identity differs from the requested version', 'source_version_mismatch')
    base_url = source.url
    for node in tree.root.nodes():
        if node.tag == 'base':
            try:
                candidate = urljoin(source.url, node.attrs.get('href', ''))
            except ValueError:
                continue
            if candidate == source.url + '/':
                base_url = candidate
    extractor = Extractor(source, limits, base_url)
    extractor.walk(articles[0])
    if len(extractor.blocks) < 2 or not any(b.kind == 'title' for b in extractor.blocks):
        raise DocumentError('HTML article has no usable title/content', 'html_unavailable')
    anchors = {}
    for block in extractor.blocks:
        for anchor in block.anchors:
            if anchor in anchors and anchors[anchor] != block.id:
                extractor.warnings.add('ambiguous-source-anchor')
            anchors[anchor] = block.id
    for block in extractor.blocks:
        tokens = (*block.content, *(token for cell in block.cells for token in cell.content))
        if any(token.target and token.target not in anchors for token in tokens):
            extractor.warnings.add('unresolved-reference')
    return ScientificDocument(paper_id, source, tuple(extractor.blocks), tuple(sorted(extractor.warnings)))
