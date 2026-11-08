"""Validate and apply the scoped edits exposed to the Host Agent."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import re

from document import (
    MAX_COLUMNS, MAX_ROWS, NotebookDocument, block_id, cell_values, check_coordinates,
    evidence_ids, fields, integer, nodes, string,
)


@dataclass(frozen=True)
class SetCells:
    identity: str
    values: dict[str, str]


@dataclass(frozen=True)
class ReplaceText:
    identity: str
    match: str
    replacement: str


@dataclass(frozen=True)
class AddFinding:
    identity: str
    claim: str
    limitations: str
    evidence: list[str]


@dataclass(frozen=True)
class InsertTextBlock:
    identity: str
    kind: str
    text: str
    after: str | None


@dataclass(frozen=True)
class InsertSpreadsheet:
    identity: str
    name: str
    rows: int
    columns: int
    cells: dict[str, str]
    after: str | None


@dataclass(frozen=True)
class MoveBlock:
    identity: str
    anchor: str
    after: bool


@dataclass(frozen=True)
class DeleteBlock:
    identity: str


def _insertion_anchor(value):
    return block_id(value['afterBlockId']) if 'afterBlockId' in value else None


def parse_operations(values, new_id):
    if not isinstance(values, list) or not 1 <= len(values) <= 20:
        raise ValueError('Expected one to twenty Notebook operations')
    operations = []
    for value in values:
        if not isinstance(value, dict):
            raise ValueError('Expected a Notebook operation object')
        op = value.get('op')
        if op == 'set_cells':
            fields(value, {'op', 'blockId', 'cells'})
            cells = cell_values(value['cells'])
            if not cells:
                raise ValueError('Select at least one cell')
            operations.append(SetCells(block_id(value['blockId']), cells))
        elif op == 'replace_text':
            fields(value, {'op', 'blockId', 'match', 'replacement'})
            match = string(value['match'], 'matched text')
            if not match:
                raise ValueError('Matched text must be nonempty')
            operations.append(ReplaceText(block_id(value['blockId']), match, string(value['replacement'], 'replacement')))
        elif op == 'add_finding':
            fields(value, {'op', 'claim', 'limitations', 'evidenceIds'})
            operations.append(AddFinding(new_id(), string(value['claim'], 'claim', required=True),
                                         string(value['limitations'], 'limitations'), evidence_ids(value['evidenceIds'])))
        elif op == 'insert_text_block':
            fields(value, {'op', 'kind', 'text'}, {'afterBlockId'})
            if value['kind'] not in ('paragraph', 'heading', 'codeBlock'):
                raise ValueError('Choose a paragraph, heading, or code block')
            operations.append(InsertTextBlock(new_id(), value['kind'], string(value['text'], 'block text', required=True),
                                              _insertion_anchor(value)))
        elif op == 'insert_spreadsheet':
            fields(value, {'op', 'name', 'rows', 'columns', 'cells'}, {'afterBlockId'})
            name = string(value['name'], 'worksheet name', 31, required=True)
            if re.search(r"[\\/*?:\[\]\x00-\x1f]|^'|'$", name) or name.lower() == 'history':
                raise ValueError('Invalid Excel worksheet name')
            rows = integer(value['rows'], 'row count', MAX_ROWS)
            columns = integer(value['columns'], 'column count', MAX_COLUMNS)
            operations.append(InsertSpreadsheet(new_id(), name, rows, columns, cell_values(value['cells'], rows, columns),
                                                 _insertion_anchor(value)))
        elif op == 'move_block':
            fields(value, {'op', 'blockId', 'anchorBlockId', 'side'})
            identity, anchor = block_id(value['blockId']), block_id(value['anchorBlockId'])
            if identity == anchor or value['side'] not in ('before', 'after'):
                raise ValueError('Choose a different anchor and a valid move side')
            operations.append(MoveBlock(identity, anchor, value['side'] == 'after'))
        elif op == 'delete_block':
            fields(value, {'op', 'blockId'})
            operations.append(DeleteBlock(block_id(value['blockId'])))
        else:
            raise ValueError('Unsupported Notebook operation')
    return operations


def _replace_text(block, operation):
    if block['type'] not in {'paragraph', 'heading', 'codeBlock'}:
        raise ValueError('Text replacement requires a paragraph, heading, or code block')
    children = block.get('content', [])
    spans = [child['text'] if child['type'] == 'text' else '\n' for child in children]
    content = ''.join(spans)
    start = content.find(operation.match)
    if start < 0 or content.find(operation.match, start + 1) >= 0:
        raise ValueError('Text replacement requires exactly one matching occurrence')
    offset = 0
    for index, span in enumerate(spans):
        child = children[index]
        if offset <= start and start + len(operation.match) <= offset + len(span) and child['type'] == 'text':
            local = start - offset
            text = span[:local] + operation.replacement + span[local + len(operation.match):]
            if text:
                child['text'] = text
            else:
                children.pop(index)
            return
        offset += len(span)
    raise ValueError('Text replacement must stay within one formatted text segment')


def _top_level_index(blocks, identity):
    for index, block in enumerate(blocks):
        if block.get('attrs', {}).get('blockId') == identity:
            return index
    raise ValueError('Structural edits require a top-level block ID')


def _insert_at(blocks, block, after):
    index = len(blocks) if after is None else _top_level_index(blocks, after) + 1
    blocks.insert(index, block)


def _references(block):
    attrs = block.get('attrs', {})
    if block['type'] == 'finding':
        yield from attrs['evidenceIds']
    elif block['type'] == 'spreadsheet':
        for annotation in attrs.get('annotations', {}).values():
            yield from annotation['evidenceIds']


def apply_operations(original, operations):
    document = NotebookDocument(original.title, deepcopy(original.content))
    blocks = document.content['content']
    for operation in operations:
        if isinstance(operation, AddFinding):
            for identity in operation.evidence:
                evidence = document.block(identity)
                if not evidence or evidence['type'] not in {'evidence', 'experiment'}:
                    raise ValueError('Finding must reference an evidence or experiment block in this entry')
                source = evidence['attrs']['source']
                if not source or not source['version'].strip():
                    raise ValueError('Finding evidence must have a pinned version')
            blocks.append({
                'type': 'finding',
                'attrs': {'blockId': operation.identity, 'claim': operation.claim,
                          'limitations': operation.limitations, 'evidenceIds': operation.evidence},
            })
            continue
        if isinstance(operation, InsertTextBlock):
            attrs = {'blockId': operation.identity}
            if operation.kind == 'heading':
                attrs['level'] = 2
            content = []
            lines = [operation.text] if operation.kind == 'codeBlock' else operation.text.split('\n')
            for index, line in enumerate(lines):
                if index:
                    content.append({'type': 'hardBreak'})
                if line:
                    content.append({'type': 'text', 'text': line})
            _insert_at(blocks, {'type': operation.kind, 'attrs': attrs, 'content': content}, operation.after)
            continue
        if isinstance(operation, InsertSpreadsheet):
            labels = [
                node['attrs'].get('label', '').lower()
                for node in nodes(document.content) if node['type'] == 'spreadsheet'
            ]
            names = {label for label in labels if label.strip()}
            next_sheet = 1
            for label in labels:
                if not label.strip():
                    while f'sheet{next_sheet}' in names:
                        next_sheet += 1
                    names.add(f'sheet{next_sheet}')
            if operation.name.lower() in names:
                raise ValueError('Worksheet names must be unique within a notebook')
            _insert_at(blocks, {'type': 'spreadsheet', 'attrs': {
                'blockId': operation.identity, 'label': operation.name,
                'sheet': {'rows': operation.rows, 'columns': operation.columns,
                          'cells': {key: value for key, value in operation.cells.items() if value}},
            }}, operation.after)
            continue
        if isinstance(operation, MoveBlock):
            block = blocks.pop(_top_level_index(blocks, operation.identity))
            blocks.insert(_top_level_index(blocks, operation.anchor) + int(operation.after), block)
            continue
        if isinstance(operation, DeleteBlock):
            removed = blocks.pop(_top_level_index(blocks, operation.identity))
            identities = {node.get('attrs', {}).get('blockId') for node in nodes(removed)}
            if any(identity in identities for node in nodes(document.content) for identity in _references(node)):
                raise ValueError('A Finding or cell annotation still references this block')
            continue
        block = document.block(operation.identity)
        if block is None:
            raise ValueError('Block ID is not present in this revision')
        if isinstance(operation, SetCells):
            if block['type'] != 'spreadsheet':
                raise ValueError('Cell updates require a spreadsheet block')
            sheet = block['attrs']['sheet']
            check_coordinates(operation.values, sheet['rows'], sheet['columns'])
            for address, value in operation.values.items():
                if value:
                    sheet['cells'][address] = value
                else:
                    sheet['cells'].pop(address, None)
        else:
            _replace_text(block, operation)
    return NotebookDocument.parse(document.wire())
