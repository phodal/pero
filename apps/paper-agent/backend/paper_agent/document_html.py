"""Offline HTML export from the scientific IR; no source scripts or image loads."""
from html import escape

from .arxiv_html import safe_link, safe_mathml
from .scientific_document import ScientificDocument

STYLE = '''
:root { color-scheme: light dark; }
body { margin: 2rem auto; padding: 0 1rem; max-width: 76ch; font: 16px/1.65 system-ui; }
body { color: CanvasText; background: Canvas; }
a { color: LinkText; } a:focus-visible { outline: 2px solid; outline-offset: 3px; }
h1,h2,h3,h4,h5,h6 { line-height: 1.25; scroll-margin-top: 1rem; }
.block { scroll-margin-top: 1rem; } .block:target { outline: 2px solid; outline-offset: 4px; }
.equation,.table,pre { overflow-x: auto; } math[display=block] { margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; } th,td { border: 1px solid GrayText; padding: .4rem .6rem; }
details code { overflow-wrap: anywhere; }
figure { margin: 1.5rem 0; } .meta,figcaption,details { font-size: .875rem; }
pre { white-space: pre; } .paragraph,.footnote,.reference,.list-item { white-space: pre-wrap; }
@media (max-width: 600px) { body { margin: 1rem auto; } h1 { font-size: 1.6rem; } }
'''


def render_document(document: ScientificDocument) -> str:
    anchors, ambiguous = {}, set()
    for block in document.blocks:
        for anchor in block.anchors:
            if anchor in anchors and anchors[anchor] != block.id:
                ambiguous.add(anchor)
            anchors[anchor] = block.id
    for anchor in ambiguous:
        anchors.pop(anchor, None)

    def inline(tokens):
        output = []
        for token in tokens:
            content = (safe_mathml(token.mathml) or escape(token.text)) if token.kind == 'math' else escape(token.text)
            url = ('#' + anchors[token.target]) if token.target in anchors else safe_link(token.url)
            if url:
                attrs = '' if url.startswith('#') else ' target="_blank" rel="noopener noreferrer"'
                content = f'<a href="{escape(url, quote=True)}"{attrs}>{content}</a>'
            output.append(content)
        return ''.join(output)

    body = []
    for block in document.blocks:
        identity = escape(block.id, quote=True)
        content = inline(block.content)
        if block.kind in ('title', 'heading'):
            tag = 'h1' if block.kind == 'title' else f'h{min(6, max(2, block.level))}'
            body.append(f'<{tag} id="{identity}">{content}</{tag}>')
        elif block.kind == 'table' and block.cells:
            rows = {}
            for cell in block.cells:
                tag = 'th' if cell.header else 'td'
                rows.setdefault(cell.row, []).append(
                    f'<{tag} rowspan="{cell.row_span}" colspan="{cell.column_span}">{inline(cell.content)}</{tag}>')
            table = ''.join('<tr>' + ''.join(row) + '</tr>' for row in rows.values())
            body.append(f'<div class="block table" id="{identity}" tabindex="0"><table>'
                        f'<caption>{content}</caption>{table}</table></div>')
        elif block.kind == 'figure':
            links = ''.join(f'<li><a href="{escape(safe_link(image.url), quote=True)}" target="_blank" '
                            f'rel="noopener noreferrer">{escape(image.alt or "View source image")}</a></li>'
                            for image in block.images if safe_link(image.url))
            body.append(f'<figure class="block" id="{identity}"><figcaption>{content}</figcaption>'
                        '<p class="meta">Image bytes were not acquired.</p>' + (f'<ul>{links}</ul>' if links else '') + '</figure>')
        else:
            tag = 'pre' if block.kind == 'code' else 'div'
            body.append(f'<{tag} class="block {escape(block.kind, quote=True)}" id="{identity}">{content}</{tag}>')
    outline = ''.join(f'<li><a href="#{escape(item["id"], quote=True)}">{escape(item["title"])}</a></li>'
                      for item in document.outline())
    warnings = ''.join(f'<li>{escape(item)}</li>' for item in document.warnings)
    source = escape(safe_link(document.source.url), quote=True)
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
            'style-src \'unsafe-inline\'; img-src \'none\'; base-uri \'none\'; form-action \'none\'">'
            f'<title>{escape(document.title)}</title><style>{STYLE}</style></head><body>'
            f'<header><p class="meta"><a href="{source}" target="_blank" rel="noopener noreferrer">'
            f'{escape(document.source.arxiv_id)}</a> · Derived HTML · PDF alignment unavailable</p>'
            f'<details><summary>Source and limitations</summary><p>Parser: {escape(document.parser)}</p>'
            f'<p>Source SHA-256: <code>{escape(document.source.digest)}</code></p>'
            '<p>Normalized HTML is not an observed PDF passage or scientific verification.</p>'
            f'<ul>{warnings}</ul></details></header>'
            f'<nav aria-label="Contents"><details><summary>Contents</summary><ol>{outline}</ol></details></nav>'
            '<main>' + ''.join(body) + '</main></body></html>')
