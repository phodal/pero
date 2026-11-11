"""Notebook Interop v0: a projection of a saved revision, never an execution owner."""
from dataclasses import dataclass
from hashlib import sha256

from document import NotebookDocument


@dataclass(frozen=True)
class NotebookDescriptor:
    identity: str
    revision: int
    document: NotebookDocument

    def wire(self):
        location = f'pero-app-location://notebook/main/entry/{self.identity}/revision/{self.revision}'
        content_digest = sha256(self.document.serialized().encode('utf-8')).hexdigest()
        references = []
        for node in self.document.nodes():
            attrs = node.get('attrs', {})
            if node['type'] in ('evidence', 'experiment') and attrs.get('source'):
                references.append({'blockId': attrs['blockId'], 'sourceRef': attrs['source'],
                                   'snapshot': attrs.get('snapshot')})
        return {
            'schema': 'pero.notebook-interop.v0',
            'descriptor': {
                'app': 'notebook', 'kind': 'lab', 'id': self.identity,
                'title': self.document.title, 'revision': self.revision, 'location': location,
                'capabilities': ['read', 'edit', 'export'],
                'formats': [
                    {'id': 'notebook-json', 'scope': 'entry', 'roundTrip': 'lossless'},
                    {'id': 'ipynb', 'scope': 'embedded-document', 'roundTrip': 'original-source'},
                    {'id': 'html', 'scope': 'publication', 'roundTrip': 'read-only'},
                    {'id': 'xlsx', 'scope': 'worksheets', 'roundTrip': 'values-formulas-names'},
                ],
            },
            'resourceRef': {'app': 'notebook', 'kind': 'entry', 'id': self.identity,
                            'revision': str(self.revision), 'revisionKind': 'saved-revision', 'location': location},
            'snapshot': {'kind': 'notebook-document', 'sha256': content_digest,
                         'encoding': 'NotebookDocument.serialized UTF-8',
                         'read': {'action': 'read-entry', 'entryId': self.identity, 'revision': self.revision, 'offset': 0}},
            'references': references,
            'actions': {
                'describe': 'describe-notebook', 'read': 'read-entry',
                'propose_change': 'apply-edits:propose_reference',
                'apply_after_authorization': 'apply-edits',
                'execute': None, 'cancel': None, 'export': 'read-entry',
            },
            'authority': 'Host App Use grants; edits require baseRevision; execution belongs to the referenced App',
            'acceptance': 'not-assessed',
        }
