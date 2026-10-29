"""User-curated comparison cells reference saved source annotations."""
from dataclasses import dataclass

from .model import digest, text


@dataclass(frozen=True)
class ReadingCell:
    id: str
    annotation_id: str
    column: str
    created_at: str

    @classmethod
    def create(cls, annotation, column, now):
        column = text(column, 80, 'matrix column')
        return cls(digest(dict(annotationId=annotation.id, column=column)), annotation.id, column, now)

    @classmethod
    def from_record(cls, value):
        return cls(value['id'], value['annotationId'], value['column'], value['createdAt'])

    def to_dict(self):
        return dict(id=self.id, annotationId=self.annotation_id, column=self.column, createdAt=self.created_at)
