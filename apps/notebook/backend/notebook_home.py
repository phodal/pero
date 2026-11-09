"""Read-only Notebook home projection. Labels never represent Host membership or identity."""
from contextlib import closing
from dataclasses import dataclass


@dataclass(frozen=True)
class NotebookHomeEntry:
    identity: str
    title: str
    revision: int
    project: str
    author: str

    def wire(self):
        return dict(entryId=self.identity, title=self.title, revision=self.revision,
                    project=self.project, author=self.author)


def notebook_home(entries):
    # Read one consistent head set; use the existing document parser/store boundary.
    with closing(entries._connect()) as connection:
        connection.execute('BEGIN')
        heads = connection.execute('''SELECT entry_id, MAX(revision) AS revision FROM revisions
            GROUP BY entry_id ORDER BY MAX(updated_at) DESC, entry_id LIMIT 501''').fetchall()
        result = []
        for row in heads[:500]:
            entry = entries._read(connection, row['entry_id'], row['revision'])
            metadata = entry.document.metadata
            result.append(NotebookHomeEntry(entry.identity, entry.document.title, entry.revision,
                                           metadata.project if metadata else '', metadata.author if metadata else ''))
        return {'scope': 'local-display-labels', 'limited': len(heads) > 500, 'entries': [entry.wire() for entry in result]}
