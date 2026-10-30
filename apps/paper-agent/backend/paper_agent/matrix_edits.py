"""Manual matrix revisions preserve the original Agent report and exact evidence."""
from dataclasses import dataclass, replace

from .model import Invalid, digest, mapping
from .reports import EvidenceMatrix


@dataclass(frozen=True)
class MatrixRevision:
    id: str
    report_id: str
    version: int
    matrix: EvidenceMatrix
    reason: str
    created_at: str

    @classmethod
    def create(cls, value, report, intent, version, now):
        value = mapping(value, 'matrix correction')
        if not report.report.matrix:
            raise Invalid('This report has no evidence matrix')
        reason = value.get('reason', '')
        if not isinstance(reason, str) or len(reason) > 2000:
            raise Invalid('Correction note exceeds 2,000 characters')
        matrix = EvidenceMatrix.parse(dict(columns=report.report.matrix.to_dict()['columns'], cells=[value.get('cell')]), intent.papers, intent.passages)
        identity = digest(dict(reportId=report.id, version=version, matrix=matrix.to_dict(), reason=reason, createdAt=now))
        return cls(identity, report.id, version, matrix, reason, now)

    def apply(self, matrix):
        cell = self.matrix.cells[0]
        remaining = tuple(c for c in matrix.cells if (c.paper_id, c.column_id) != (cell.paper_id, cell.column_id))
        return replace(matrix, cells=(*remaining, cell))

    def to_dict(self):
        return dict(id=self.id, reportId=self.report_id, version=self.version,
                    cell=self.matrix.to_dict()['cells'][0], reason=self.reason, createdAt=self.created_at, provenance='manual-correction')

    @classmethod
    def from_record(cls, value, report, intent):
        result = cls.create(value, report, intent, value['version'], value['createdAt'])
        if result.id != value['id']:
            raise Invalid('Stored matrix revision integrity check failed')
        return result
