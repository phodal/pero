"""The versioned Notebook content accepted by storage and the App editor."""

from dataclasses import dataclass
from datetime import date
from hashlib import sha256
import base64
import binascii
import json
import math
import re
from urllib.parse import urlsplit
from workspace import NotebookMetadata, NotebookProcedure, parse_procedures
import unicodedata


MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
MAX_TITLE = 200
MAX_TEXT = 32_768
MAX_CELL = 4_096
MAX_ROWS = 200
MAX_COLUMNS = 50

BLOCK_ID = re.compile(r'[A-Za-z0-9_-]{1,128}')
CELL_ADDRESS = re.compile(r'([A-Z]{1,2})([1-9][0-9]{0,2})')
MARKS = {'bold', 'italic', 'strike', 'code', 'underline', 'subscript', 'superscript', 'textColor', 'textBackground', 'link'}
BLOCKS = {
    'paragraph', 'heading', 'blockquote', 'horizontalRule', 'codeBlock',
    'bulletList', 'orderedList', 'taskList', 'spreadsheet', 'evidence',
    'experiment', 'finding', 'section', 'attachment', 'savedSearch', 'inputTable', 'registrationTable', 'lookupTable', 'mixturePrep', 'appCanvas', 'sampleIntake', 'reactionScheme', 'chemical', 'sourceExcerpt',
}
CONTAINERS = {
    'doc': BLOCKS,
    'blockquote': BLOCKS,
    'listItem': BLOCKS,
    'taskItem': BLOCKS,
    'bulletList': {'listItem'},
    'orderedList': {'listItem'},
    'taskList': {'taskItem'},
    'paragraph': {'text', 'hardBreak', 'referenceMention'},
    'heading': {'text', 'hardBreak', 'referenceMention'},
    'codeBlock': {'text'},
    'section': BLOCKS,
}
REQUIRED_CHILDREN = {'doc', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'section'}
DOMAIN_BLOCKS = {'spreadsheet', 'evidence', 'experiment', 'finding', 'section', 'attachment', 'savedSearch', 'inputTable', 'registrationTable', 'lookupTable', 'mixturePrep', 'appCanvas', 'sampleIntake', 'reactionScheme', 'chemical', 'sourceExcerpt'}
SHA256 = re.compile(r'[a-f0-9]{64}')
RUN_ID = re.compile(r'[a-f0-9]{32}')
CONTROL_NAME = re.compile(r'[a-zA-Z0-9_-]{1,128}')
JSON_NUMBER = re.compile(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?')
VERDICTS = ('PASS', 'FAIL', 'INCONCLUSIVE')


def fields(value, required, optional=()):
    if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - set(optional):
        raise ValueError('Invalid object fields')
    return value


def string(value, name, maximum=MAX_TEXT, *, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError(f'Invalid {name}')
    return value


def integer(value, name, maximum=2_147_483_647, *, minimum=1):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f'Invalid {name}')
    return value


def block_id(value):
    if not isinstance(value, str) or not BLOCK_ID.fullmatch(value):
        raise ValueError('Invalid block ID')
    return value


def calendar_date(value):
    """An optional day label, not the time of a saved revision or experiment."""
    string(value, 'section date', 10)
    if value:
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError('Invalid section date')
        try:
            date.fromisoformat(value)
        except ValueError as error:
            raise ValueError('Invalid section date') from error


def attachment(value):
    """A bounded immutable file snapshot; only raster images are previewable."""
    filename = string(value['filename'], 'attachment filename', 255, required=True)
    if filename in {'.', '..'} or re.search(r'[\x00-\x1f\x7f/\\]', filename):
        raise ValueError('Invalid attachment filename')
    mime = string(value['mime'], 'attachment MIME type', 127, required=True)
    if not re.fullmatch(r'[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*', mime):
        raise ValueError('Invalid attachment MIME type')
    if mime.startswith('image/') and mime not in {'image/png', 'image/jpeg', 'image/webp'}:
        raise ValueError('Unsupported image type')
    data = string(value['data'], 'attachment data', 4 * ((512 * 1024 + 2) // 3))
    try:
        raw = base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError('Invalid attachment base64') from error
    if len(raw) > 512 * 1024 or base64.b64encode(raw).decode() != data:
        raise ValueError('Invalid attachment size or base64')
    if value['sha256'] != sha256(raw).hexdigest():
        raise ValueError('Attachment digest does not match its bytes')
    string(value['caption'], 'attachment caption', 2000)


def text_mark(value):
    """Interpret editor marks at the persistence boundary without active URL/CSS payloads."""
    fields(value, {'type'}, {'attrs'})
    kind = value['type']
    if not isinstance(kind, str) or kind not in MARKS:
        raise ValueError('Unknown text mark')
    attrs = value.get('attrs', {})
    if kind in {'textColor', 'textBackground'}:
        fields(attrs, {'tone'})
        if attrs['tone'] not in {'blue', 'green', 'rose', 'amber'}:
            raise ValueError('Invalid text color')
    elif kind == 'link':
        fields(attrs, {'href'}, {'target', 'rel', 'class', 'title'})
        href = string(attrs['href'], 'link URL', 2048, required=True)
        if (not re.match(r'^(?:https?://|mailto:)', href, re.I)
                or re.search(r'[\s\x00-\x20\x7f]', href)):
            raise ValueError('Invalid link URL')
        try:
            parsed = urlsplit(href)
            if parsed.scheme.lower() in {'http', 'https'} and not parsed.hostname:
                raise ValueError('Invalid link host')
            if parsed.scheme.lower() == 'mailto' and not parsed.path:
                raise ValueError('Invalid mail recipient')
        except ValueError as error:
            raise ValueError('Invalid link URL') from error
        if attrs.get('target') not in (None, '_blank') or attrs.get('rel') not in (None, 'noopener noreferrer nofollow'):
            raise ValueError('Invalid link behavior')
        if attrs.get('class') is not None or attrs.get('title') is not None:
            raise ValueError('Invalid link presentation')
    else:
        fields(attrs, set())


def check_coordinates(value, rows, columns):
    if not isinstance(value, dict) or len(value) > rows * columns:
        raise ValueError('Invalid spreadsheet cells')
    for address in value:
        match = CELL_ADDRESS.fullmatch(address) if isinstance(address, str) else None
        if not match:
            raise ValueError('Invalid cell address')
        column = 0
        for letter in match[1]:
            column = column * 26 + ord(letter) - ord('A') + 1
        if column > columns or int(match[2]) > rows:
            raise ValueError('Cell lies outside the spreadsheet')


def cell_values(value, rows=MAX_ROWS, columns=MAX_COLUMNS):
    check_coordinates(value, rows, columns)
    for content in value.values():
        string(content, 'cell value', MAX_CELL)
    return value


# Same external-calculation names as packages/notebook/src/formula-policy.ts.
EXTERNAL_FORMULAS = {
    'WEBSERVICE', 'FILTERXML', 'RTD', 'IMAGE', 'STOCKHISTORY', 'IMPORTDATA',
    'IMPORTXML', 'IMPORTHTML', 'IMPORTFEED', 'IMPORTRANGE', 'GOOGLEFINANCE',
    'CALL', 'REGISTER', 'REGISTER.ID', 'PY', 'PYTHON',
}


def _ignorable(character):
    return character.isspace() or unicodedata.category(character) == 'Cf'


def external_formula(value):
    """Whether calculation can reach another program or service.

    Unicode whitespace and format characters are ignored inside the name and
    before '('. NotebookDocument.parse does not use this check. A whole-document
    save stays readable when a cell already contains an external formula. Agent
    cell writes reject new ones. Excel export stores any that remain as text,
    not as a formula cell.
    """
    if not isinstance(value, str) or not value.startswith('='):
        return False
    index = 1
    length = len(value)
    while index < length:
        character = value[index]
        if character in ('"', "'"):
            quote = character
            index += 1
            while index < length:
                if value[index] == quote:
                    if index + 1 < length and value[index + 1] == quote:
                        index += 2
                        continue
                    index += 1
                    break
                index += 1
            continue
        if character == '|':
            return True
        if character.isascii() and (character.isalpha() or character == '_'):
            start = index
            index += 1
            while index < length and (
                value[index].isascii() and (value[index].isalnum() or value[index] in '._')
                or _ignorable(value[index])
            ):
                index += 1
            name = ''.join(part for part in value[start:index] if not _ignorable(part)).upper()
            while name.startswith('_XLFN.') or name.startswith('_XLUDF.'):
                name = name[6:] if name.startswith('_XLFN.') else name[7:]
            if index < length and value[index] == '(':
                tail = name.rpartition('.')[2]
                if name in EXTERNAL_FORMULAS or tail in EXTERNAL_FORMULAS:
                    return True
            continue
        index += 1
    return False


def evidence_ids(value):
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError('Invalid finding evidence IDs')
    ids = [block_id(identity) for identity in value]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate finding evidence IDs')
    return ids


def _digests(snapshot, names):
    for name in names:
        value = snapshot[name]
        if not isinstance(value, str) or not SHA256.fullmatch(value):
            raise ValueError(f'Invalid imported {name} digest')


def _paper_snapshot(snapshot, source):
    fields(snapshot, {'kind', 'reportId', 'intentId', 'exportSha256', 'citationIndex',
                      'paperId', 'paperContentDigest', 'passageId', 'documentId',
                      'fileDigest', 'page', 'start', 'end', 'quote', 'occurrences'})
    _digests(snapshot, ('reportId', 'intentId', 'exportSha256', 'paperId',
                        'passageId', 'documentId', 'fileDigest'))
    digest = snapshot['paperContentDigest']
    if not isinstance(digest, str) or not digest.startswith('sha256:') or not SHA256.fullmatch(digest[7:]):
        raise ValueError('Invalid imported paper content digest')
    integer(snapshot['page'], 'PDF page')
    # The portable snapshot uses the same bounds as the Notebook export importer.
    integer(snapshot['occurrences'], 'quote occurrences', 32_768)
    integer(snapshot['citationIndex'], 'citation index', 12 * 8 - 1, minimum=0)
    integer(snapshot['start'], 'quote start', minimum=0)
    integer(snapshot['end'], 'quote end', minimum=snapshot['start'] + 1)
    quote = string(snapshot['quote'], 'exact quote', 4_000, required=True)
    if snapshot['end'] - snapshot['start'] != len(quote):
        raise ValueError('Imported quote does not match its span')
    identity = snapshot['reportId']
    locator = f"pero-app-location://paper-agent/main/report/{identity}/citation/{snapshot['citationIndex']}"
    if source != dict(app='paper-agent', kind='report-citation', id=identity, version=identity, locator=locator):
        raise ValueError('Paper snapshot does not match its source reference')


def _control_snapshot(snapshot, source):
    fields(snapshot, {'kind', 'trialId', 'observationId', 'candidateId', 'scenarioId',
                      'phase', 'specHash', 'inputDigest', 'reportId', 'verifierVersion',
                      'verdict', 'checks', 'exportSha256'})
    _digests(snapshot, ('observationId', 'specHash', 'inputDigest', 'reportId', 'exportSha256'))
    trial = snapshot['trialId']
    if not isinstance(trial, str) or not RUN_ID.fullmatch(trial):
        raise ValueError('Invalid imported trial ID')
    identity = source['id']
    locator = f'pero-app-location://control-lab/main/experiment/{identity}/trial/{trial}'
    if not RUN_ID.fullmatch(identity) or source != dict(
            app='control-lab', kind='verification-report', id=identity,
            version=snapshot['reportId'], locator=locator):
        raise ValueError('Control Lab snapshot does not match its source reference')
    for key in ('candidateId', 'scenarioId'):
        value = snapshot[key]
        if not isinstance(value, str) or not CONTROL_NAME.fullmatch(value):
            raise ValueError(f'Invalid imported {key}')
    if snapshot['verifierVersion'] != 'control-lab-verifier-v1':
        raise ValueError('Unsupported imported verifier version')
    if snapshot['phase'] not in ('search', 'verification') or snapshot['verdict'] not in VERDICTS:
        raise ValueError('Invalid imported trial phase or verdict')
    checks = snapshot['checks']
    if not isinstance(checks, list) or not 1 <= len(checks) <= 64:
        raise ValueError('Invalid imported checks')
    report_checks = []
    for check in checks:
        fields(check, {'name', 'verdict', 'actual', 'limit', 'message'})
        string(check['name'], 'imported check name', 200, required=True)
        string(check['message'], 'imported check message', 4096)
        if check['verdict'] not in VERDICTS:
            raise ValueError('Invalid imported check verdict')
        values = {}
        for key in ('actual', 'limit'):
            value = check[key]
            if value is not None and (not isinstance(value, str) or len(value) > 96 or not JSON_NUMBER.fullmatch(value)):
                raise ValueError(f'Invalid imported check {key}')
            values[key] = None if value is None else json.loads(value)
            if values[key] is not None and not math.isfinite(values[key]):
                raise ValueError(f'Invalid imported check {key}')
        report_checks.append({**check, **values})
    body = {key: snapshot[key] for key in ('candidateId', 'specHash', 'verdict', 'verifierVersion')}
    body.update(checks=report_checks, evidence=[snapshot['observationId']])
    canonical = json.dumps(body, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    if sha256(canonical).hexdigest() != snapshot['reportId']:
        raise ValueError('Imported check values do not match their report digest')


def _snapshot(kind, snapshot, source):
    if snapshot is None:
        return
    if not isinstance(snapshot, dict) or source is None:
        raise ValueError('Imported snapshot requires its source reference')
    if kind == 'evidence' and snapshot.get('kind') == 'paper-report':
        _paper_snapshot(snapshot, source)
    elif kind == 'experiment' and snapshot.get('kind') == 'control-receipt':
        _control_snapshot(snapshot, source)
    else:
        raise ValueError('Invalid imported snapshot type')


def _attributes(kind, value, identities):
    required = {
        'spreadsheet': {'sheet'},
        'evidence': {'label', 'source'},
        'experiment': {'label', 'source'},
        'finding': {'claim', 'limitations', 'evidenceIds'},
        'section': {'label', 'date'},
        'attachment': {'filename', 'mime', 'data', 'caption', 'sha256'},
        'referenceMention': {'label', 'source'},
        'reactionScheme': {'reaction', 'record'},
        'chemical': {'chemical'},
        'sourceExcerpt': {'label', 'excerpt'},
        'sampleIntake': {'intake'},
        'appCanvas': {'label', 'binding'},
        'mixturePrep': {'label', 'mixture'},
        'inputTable': {'table', 'receipts'},
        'registrationTable': {'table', 'receipts'},
        'lookupTable': {'query', 'snapshot'},
        'savedSearch': {'label', 'queryId', 'queryRevision', 'mode', 'snapshot'},
    }.get(kind, set())
    if kind in DOMAIN_BLOCKS:
        required = required | {'blockId'}
    optional = {
        'heading': {'level'}, 'orderedList': {'start', 'type'},
        'taskItem': {'checked'}, 'codeBlock': {'language'},
        'spreadsheet': {'label', 'annotations', 'formats', 'rowHeights', 'columnWidths', 'merges'},
        'evidence': {'snapshot'}, 'experiment': {'snapshot'},
    }.get(kind, set())
    if kind not in {'doc', 'text', 'hardBreak', 'referenceMention'}:
        optional = optional | {'blockId', 'templateOrigin'}
    fields(value, required, optional)
    if value.get('templateOrigin') is not None:
        from templates import parse_template_origin
        parse_template_origin(value['templateOrigin'])
    identity = value.get('blockId')
    if identity is not None or kind in DOMAIN_BLOCKS:
        identity = block_id(identity)
        if identity in identities:
            raise ValueError('Duplicate block ID')
        identities.add(identity)
    if kind == 'heading' and 'level' in value:
        integer(value['level'], 'heading level', 6)
    elif kind == 'orderedList':
        if 'start' in value:
            # HTML ordered lists (and pasted Tiptap lists) allow zero and negative starts.
            integer(value['start'], 'list start', minimum=-2_147_483_648)
        if value.get('type') is not None and value['type'] not in ('1', 'a', 'A', 'i', 'I'):
            raise ValueError('Invalid list type')
    elif kind == 'taskItem' and 'checked' in value and type(value['checked']) is not bool:
        raise ValueError('Invalid checklist state')
    elif kind == 'codeBlock' and value.get('language') is not None:
        string(value['language'], 'code language', 128)
    elif kind == 'spreadsheet':
        if 'label' in value:
            string(value['label'], 'worksheet label', MAX_TITLE)
        sheet = fields(value['sheet'], {'rows', 'columns', 'cells'})
        rows = integer(sheet['rows'], 'row count', MAX_ROWS)
        columns = integer(sheet['columns'], 'column count', MAX_COLUMNS)
        cell_values(sheet['cells'], rows, columns)
        from grid import GridPresentation
        GridPresentation.parse(value, rows, columns)
        if 'annotations' in value:
            annotations = value['annotations']
            check_coordinates(annotations, rows, columns)
            for annotation in annotations.values():
                fields(annotation, {'unit', 'evidenceIds'})
                string(annotation['unit'], 'cell unit', 128)
                evidence_ids(annotation['evidenceIds'])
    elif kind in {'evidence', 'experiment'}:
        string(value['label'], 'reference label', MAX_TITLE)
        source = value['source']
        if source is not None:
            fields(source, {'app', 'kind', 'id', 'version', 'locator'})
            for key in ('app', 'kind', 'id', 'version', 'locator'):
                string(source[key], f'reference {key}', 1024, required=key in {'app', 'kind', 'id'})
        _snapshot(kind, value.get('snapshot'), source)
    elif kind == 'finding':
        string(value['claim'], 'claim')
        string(value['limitations'], 'limitations')
        evidence_ids(value['evidenceIds'])
    elif kind == 'section':
        string(value['label'], 'section title', MAX_TITLE)
        calendar_date(value['date'])
    elif kind == 'attachment':
        attachment(value)
    elif kind in {'inputTable', 'registrationTable', 'lookupTable'}:
        from catalog import validate_attribute
        validate_attribute(kind, {key: item for key, item in value.items() if key != 'templateOrigin'})
    elif kind == 'referenceMention':
        string(value['label'], 'mention label', 200, required=True)
        source = fields(value['source'], {'app', 'kind', 'id', 'version', 'locator'})
        for key, item in source.items():
            string(item, 'mention identity', 1024, required=key != 'locator')
            if re.search(r'[\x00-\x1f\x7f]', item):
                raise ValueError('Invalid mention identity')
    elif kind in {'reactionScheme', 'chemical'}:
        from scientific_designs import parse_scientific_attributes
        parse_scientific_attributes(kind, value)
    elif kind == 'sourceExcerpt':
        from source_excerpt import parse_source_excerpt_attributes
        parse_source_excerpt_attributes({key: value[key] for key in ('label', 'excerpt')})
    elif kind == 'sampleIntake':
        from sample_intake import validate_sample_intake_attributes
        validate_sample_intake_attributes({key: item for key, item in value.items() if key != 'templateOrigin'})
    elif kind == 'appCanvas':
        from app_canvas import AppCanvasBinding
        string(value['label'], 'App Canvas label', MAX_TITLE)
        AppCanvasBinding.parse(value['binding'])
    elif kind == 'mixturePrep':
        from mixture import parse_mixture_attributes
        parse_mixture_attributes(value)
    elif kind == 'savedSearch':
        from saved_search import parse_saved_search_attributes
        parse_saved_search_attributes(value)


def _node(value, allowed, identities, depth=0):
    fields(value, {'type'}, {'attrs', 'content', 'marks', 'text'})
    kind = value['type']
    if not isinstance(kind, str) or kind not in allowed or depth > 24:
        raise ValueError('Invalid document node type, placement, or nesting')
    _attributes(kind, value.get('attrs', {}), identities)
    if kind == 'text':
        string(value.get('text'), 'text')
        if not value['text']:
            raise ValueError('Empty text node')
    elif 'text' in value:
        raise ValueError('Only text nodes contain text')
    if 'marks' in value:
        marks = value['marks']
        if kind not in {'text', 'hardBreak', 'referenceMention'} or not isinstance(marks, list) or len(marks) > len(MARKS):
            raise ValueError('Invalid text marks')
        for mark in marks:
            text_mark(mark)
        if {'subscript', 'superscript'} <= {mark['type'] for mark in marks}:
            raise ValueError('Text cannot be both subscript and superscript')
        if len({mark['type'] for mark in marks}) != len(marks):
            raise ValueError('Duplicate text mark')
    if 'content' in value or kind in REQUIRED_CHILDREN or kind in {'listItem', 'taskItem'}:
        children = value.get('content')
        if kind not in CONTAINERS or not isinstance(children, list) or len(children) > 10_000:
            raise ValueError('Invalid node content')
        if kind in REQUIRED_CHILDREN and not children:
            raise ValueError('Container must have content')
        for child in children:
            _node(child, CONTAINERS[kind], identities, depth + 1)
        if kind in {'listItem', 'taskItem'} and (not children or children[0]['type'] != 'paragraph'):
            raise ValueError('List item must begin with a paragraph')
        if kind == 'codeBlock' and any(child.get('marks') for child in children):
            raise ValueError('Code blocks cannot contain text marks')


def nodes(node):
    yield node
    for child in node.get('content', ()):
        yield from nodes(child)


@dataclass(frozen=True)
class NotebookDocument:
    title: str
    content: dict
    metadata: NotebookMetadata | None = None
    procedures: tuple[NotebookProcedure, ...] | None = None
    template_origin: dict | None = None

    @classmethod
    def parse(cls, value):
        fields(value, {'schemaVersion', 'title', 'content'}, {'metadata', 'procedures', 'templateOrigin'})
        if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
            raise ValueError('Unsupported Notebook document version')
        title = string(value['title'], 'entry title', MAX_TITLE, required=True)
        identities = set()
        _node(value['content'], {'doc'}, identities)
        from templates import parse_template_origin
        origin = parse_template_origin(value['templateOrigin']) if value.get('templateOrigin') is not None else None
        document = cls(title, value['content'],
                       NotebookMetadata.parse(value['metadata']) if 'metadata' in value else None,
                       parse_procedures(value['procedures'], identities) if 'procedures' in value else None, origin)
        if len(document.serialized().encode()) > MAX_DOCUMENT_BYTES:
            raise ValueError('Notebook document exceeds the size limit')
        return document

    def wire(self):
        result = {'schemaVersion': 1, 'title': self.title, 'content': self.content}
        if self.metadata is not None:
            result['metadata'] = self.metadata.wire()
        if self.procedures is not None:
            result['procedures'] = [item.wire() for item in self.procedures]
        if self.template_origin is not None:
            result['templateOrigin'] = self.template_origin
        return result

    def serialized(self):
        return json.dumps(self.wire(), ensure_ascii=False, separators=(',', ':'), allow_nan=False)

    def nodes(self):
        """All recorded block trees: Notes, introductions, material notes and steps."""
        yield from nodes(self.content)
        for procedure in self.procedures or ():
            for root in procedure.content_roots():
                yield from nodes(root)

    def block(self, identity):
        return next((node for node in self.nodes() if node.get('attrs', {}).get('blockId') == identity), None)
