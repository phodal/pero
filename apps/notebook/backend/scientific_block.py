"""Reference proposals for registered scientific blocks.

The Host token gate stays in the notebook server. This module does not grant
permission from proposal fields. Accept appends one revision; reject does not.
"""

from contextlib import closing
from copy import deepcopy
from dataclasses import dataclass
import json
import re

from block_registry import proposal_adapter, register_operation, register_proposal
from document import NotebookDocument, block_id, fields, integer, string
from store import RevisionConflict
from templates import preserve_template_origins


def _source(value):
    source = fields(value, {'app', 'kind', 'id', 'version', 'locator'})
    for key in ('app', 'kind', 'id', 'version', 'locator'):
        string(source[key], f'reference {key}', 1024, required=key in {'app', 'kind', 'id', 'version'})
        if re.search(r'[\x00-\x1f\x7f]', source[key]):
            raise ValueError('Invalid reference identity')
    return {key: source[key] for key in ('app', 'kind', 'id', 'version', 'locator')}


def accept_reference(attrs, label, source):
    """Replace the label and pinned reference. Snapshot and template lineage stay."""
    updated = dict(attrs)
    updated['label'] = string(label, 'reference label', 200)
    updated['source'] = _source(source)
    return updated


@dataclass(frozen=True)
class ProposeReference:
    """Agent operation. It records a proposal and does not edit the document."""

    proposal_id: str
    block_id: str
    label: str
    source: dict
    registry_op: str = 'propose_reference'
    identity: str = ''

    def __post_init__(self):
        if not self.identity:
            object.__setattr__(self, 'identity', self.block_id)


def parse_propose_reference(value, _new_id):
    data = fields(value, {'op', 'proposalId', 'blockId', 'label', 'source'})
    if data['op'] != 'propose_reference':
        raise ValueError('Unsupported Notebook operation')
    return ProposeReference(block_id(data['proposalId']), block_id(data['blockId']),
                            string(data['label'], 'reference label', 200), _source(data['source']))


def apply_propose_reference(_document, operation):
    if isinstance(operation, ProposeReference):
        raise ValueError('A reference proposal cannot be mixed with document edits')


register_operation('propose_reference', parse_propose_reference, apply_propose_reference)


@dataclass(frozen=True)
class BlockReview:
    proposal_id: str
    expected_revision: int
    decision: str

    @classmethod
    def parse(cls, value):
        data = fields(value, {'proposalId', 'expectedRevision', 'decision'})
        if data['decision'] not in ('accept', 'reject'):
            raise ValueError('A proposal is accepted or rejected')
        return cls(block_id(data['proposalId']), integer(data['expectedRevision'], 'expected revision'), data['decision'])


class BlockProposalStore:
    def __init__(self, entries):
        self.entries = entries
        with closing(entries._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS scientific_block_proposals (
                entry_id TEXT NOT NULL, proposal_id TEXT NOT NULL, request TEXT NOT NULL,
                receipt TEXT NOT NULL, PRIMARY KEY (entry_id, proposal_id))''')

    def list(self, identity):
        with closing(self.entries._connect()) as connection:
            self.entries._read(connection, identity)
            return [json.loads(row['receipt']) for row in connection.execute(
                'SELECT receipt FROM scientific_block_proposals WHERE entry_id = ? ORDER BY rowid', (identity,))]

    def propose(self, identity, expected_revision, proposal: ProposeReference):
        request = json.dumps({'blockId': proposal.block_id, 'label': proposal.label, 'source': proposal.source},
                              sort_keys=True, ensure_ascii=False)
        with closing(self.entries._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            prior = connection.execute(
                'SELECT request, receipt FROM scientific_block_proposals WHERE entry_id = ? AND proposal_id = ?',
                (identity, proposal.proposal_id)).fetchone()
            if prior:
                if prior['request'] != request:
                    raise ValueError('This proposal id was already used with different input')
                receipt = json.loads(prior['receipt'])
                entry = self.entries._read(connection, identity, receipt['revision'])
                return {'entry': entry.wire(), 'proposal': receipt, 'replayed': True}
            current = self.entries._read(connection, identity)
            if current.revision != expected_revision:
                raise RevisionConflict(current.revision)
            target = current.document.block(proposal.block_id)
            if target is None or proposal_adapter(target['type']) is None:
                raise ValueError('This block does not accept reference proposals')
            receipt = {'proposalId': proposal.proposal_id, 'decision': 'pending', 'blockId': proposal.block_id,
                       'baseRevision': current.revision, 'revision': current.revision, 'label': proposal.label,
                       'source': proposal.source}
            connection.execute('INSERT INTO scientific_block_proposals VALUES (?, ?, ?, ?)',
                               (identity, proposal.proposal_id, request, json.dumps(receipt, ensure_ascii=False)))
            return {'entry': current.wire(), 'proposal': receipt, 'replayed': False}

    def review(self, identity, review: BlockReview):
        with closing(self.entries._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            prior = connection.execute(
                'SELECT request, receipt FROM scientific_block_proposals WHERE entry_id = ? AND proposal_id = ?',
                (identity, review.proposal_id)).fetchone()
            if prior is None:
                raise ValueError('Proposal was not found')
            receipt = json.loads(prior['receipt'])
            if receipt['decision'] != 'pending':
                if receipt['decision'] != review.decision:
                    raise ValueError('This proposal was already reviewed with a different decision')
                entry = self.entries._read(connection, identity, receipt['revision'])
                return {'entry': entry.wire(), 'proposal': receipt, 'replayed': True}
            current = self.entries._read(connection, identity)
            if current.revision != review.expected_revision or current.revision != receipt['baseRevision']:
                raise RevisionConflict(current.revision)
            if review.decision == 'reject':
                receipt = {**receipt, 'decision': 'reject'}
                connection.execute('UPDATE scientific_block_proposals SET receipt = ? WHERE entry_id = ? AND proposal_id = ?',
                                   (json.dumps(receipt, ensure_ascii=False), identity, review.proposal_id))
                return {'entry': current.wire(), 'proposal': receipt, 'replayed': False}
            document = current.document
            target = document.block(receipt['blockId'])
            if target is None:
                raise ValueError('Block was not found in this revision')
            adapter = proposal_adapter(target['type'])
            if adapter is None:
                raise ValueError('This block does not accept reference proposals')
            before = deepcopy(document.wire())
            target['attrs'] = adapter(target['attrs'], receipt['label'], receipt['source'])
            after = document.wire()
            preserve_template_origins(before, after)
            updated = NotebookDocument.parse(after)
            entry = self.entries._insert(connection, identity, current.revision + 1, updated)
            if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='drafts'").fetchone():
                connection.execute('DELETE FROM drafts WHERE entry_id = ? AND document = ?', (identity, updated.serialized()))
            receipt = {**receipt, 'decision': 'accept', 'revision': entry.revision}
            connection.execute('UPDATE scientific_block_proposals SET receipt = ? WHERE entry_id = ? AND proposal_id = ?',
                               (json.dumps(receipt, ensure_ascii=False), identity, review.proposal_id))
            return {'entry': entry.wire(), 'proposal': receipt, 'replayed': False}


def block_proposal_route(owner, method, path, body):
    match = re.fullmatch(r'/api/entries/([a-f0-9]{32})/block-proposals', path)
    if not match:
        return None
    if method == 'GET':
        return 200, {'proposals': owner.list(match[1])}
    if method == 'POST':
        return 200, owner.review(match[1], BlockReview.parse(body()))
    return None


# Imported by the server so evidence and experiment proposals resolve without editing the route.
for _name in ('evidence', 'experiment'):
    if proposal_adapter(_name) is None:
        register_proposal(_name, accept_reference)
