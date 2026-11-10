"""Reference proposals for registered scientific blocks.

The Host token gate stays in the notebook server. This module does not grant
permission from proposal fields. Accept appends one revision; reject does not.
"""

from contextlib import closing
from dataclasses import dataclass
import json
import re

from block_registry import proposal_adapter, register_proposal
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
class BlockProposal:
    proposal_id: str
    expected_revision: int
    block_id: str
    decision: str
    label: str
    source: dict

    @classmethod
    def parse(cls, value):
        data = fields(value, {'proposalId', 'expectedRevision', 'blockId', 'decision', 'label', 'source'})
        decision = data['decision']
        if decision not in ('accept', 'reject'):
            raise ValueError('A proposal is accepted or rejected')
        return cls(block_id(data['proposalId']), integer(data['expectedRevision'], 'expected revision'),
                   block_id(data['blockId']), decision, string(data['label'], 'reference label', 200), _source(data['source']))

    def wire(self):
        return {'proposalId': self.proposal_id, 'expectedRevision': self.expected_revision, 'blockId': self.block_id,
                'decision': self.decision, 'label': self.label, 'source': self.source}


class BlockProposalStore:
    def __init__(self, entries):
        self.entries = entries
        with closing(entries._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS scientific_block_proposals (
                entry_id TEXT NOT NULL, proposal_id TEXT NOT NULL, request TEXT NOT NULL,
                receipt TEXT NOT NULL, PRIMARY KEY (entry_id, proposal_id))''')

    def review(self, identity, proposal: BlockProposal):
        request = json.dumps(proposal.wire(), sort_keys=True, ensure_ascii=False)
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
            if current.revision != proposal.expected_revision:
                raise RevisionConflict(current.revision)
            if proposal.decision == 'reject':
                receipt = {'proposalId': proposal.proposal_id, 'decision': 'reject', 'blockId': proposal.block_id,
                           'baseRevision': current.revision, 'revision': current.revision, 'replayed': False}
                connection.execute('INSERT INTO scientific_block_proposals VALUES (?, ?, ?, ?)',
                                   (identity, proposal.proposal_id, request, json.dumps(receipt)))
                return {'entry': current.wire(), 'proposal': receipt, 'replayed': False}
            document = current.document
            target = document.block(proposal.block_id)
            if target is None:
                raise ValueError('Block was not found in this revision')
            adapter = proposal_adapter(target['type'])
            if adapter is None:
                raise ValueError('This block does not accept reference proposals')
            before = document.wire()
            target['attrs'] = adapter(target['attrs'], proposal.label, proposal.source)
            after = document.wire()
            preserve_template_origins(before, after)
            updated = NotebookDocument.parse(after)
            entry = self.entries._insert(connection, identity, current.revision + 1, updated)
            if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='drafts'").fetchone():
                connection.execute('DELETE FROM drafts WHERE entry_id = ? AND document = ?', (identity, updated.serialized()))
            receipt = {'proposalId': proposal.proposal_id, 'decision': 'accept', 'blockId': proposal.block_id,
                       'baseRevision': current.revision, 'revision': entry.revision, 'source': proposal.source,
                       'label': proposal.label, 'replayed': False}
            connection.execute('INSERT INTO scientific_block_proposals VALUES (?, ?, ?, ?)',
                               (identity, proposal.proposal_id, request, json.dumps(receipt, ensure_ascii=False)))
            return {'entry': entry.wire(), 'proposal': receipt, 'replayed': False}


def block_proposal_route(owner, method, path, body):
    match = re.fullmatch(r'/api/entries/([a-f0-9]{32})/block-proposals', path)
    if not match:
        return None
    if method == 'GET':
        return 200, {'proposals': []}
    if method == 'POST':
        return 200, owner.review(match[1], BlockProposal.parse(body()))
    return None


# Imported by the server so evidence and experiment proposals resolve without editing the route.
for _name in ('evidence', 'experiment'):
    if proposal_adapter(_name) is None:
        register_proposal(_name, accept_reference)
