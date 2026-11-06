"""Source-bound experimental tables. Presentation never asserts scientific validity."""
from dataclasses import dataclass
from dataset import Dataset, Invalid
from view import DatasetView


@dataclass(frozen=True)
class TableColumn:
    field: str
    label: str
    unit: str


@dataclass(frozen=True)
class TableDocument:
    title: str
    description: str
    columns: tuple[TableColumn, ...]
    dataset: Dataset
    view: DatasetView

    @classmethod
    def admit(cls, value, dataset: Dataset, view: DatasetView):
        if not isinstance(value, dict) or set(value) - {"title", "description", "columns"}:
            raise Invalid("Table needs title, optional description and columns")
        title, description = value.get("title"), value.get("description", "")
        if not isinstance(title, str) or not title.strip() or len(title) > 160:
            raise Invalid("Table title must contain 1–160 characters")
        if not isinstance(description, str) or len(description) > 2048:
            raise Invalid("Table description must be at most 2048 characters")
        columns = value.get("columns")
        if not isinstance(columns, list) or not 1 <= len(columns) <= 16:
            raise Invalid("Choose 1–16 table columns")
        fields = {field.name for field in dataset.fields}
        parsed = []
        for column in columns:
            if not isinstance(column, dict) or set(column) - {"field", "label", "unit"}:
                raise Invalid("A table column contains field, optional label and unit")
            field = column.get("field")
            if not isinstance(field, str) or field not in fields or field in {c.field for c in parsed}:
                raise Invalid("Choose distinct fields present in the dataset")
            label, unit = column.get("label", field), column.get("unit", "")
            if any(not isinstance(s, str) or len(s) > 160 for s in (label, unit)) or not label.strip():
                raise Invalid("Column labels and units must be strings up to 160 characters")
            parsed.append(TableColumn(field, label, unit))
        return cls(title, description, tuple(parsed), dataset, view)

    def json(self):
        records = self.view.selection.apply(self.view.query.apply(self.dataset))
        if not 1 <= len(records) <= 100:
            raise Invalid("An inline table needs 1–100 selected records; select a smaller scope explicitly")
        rows = []
        for record in records:
            cells = []
            for column in self.columns:
                cell = record.cell(column.field)
                if cell and len(cell.display) > 1000:
                    raise Invalid("A table cell exceeds 1000 characters; choose scalar result fields")
                cells.append({"kind": cell.kind.value if cell else "missing",
                              "display": cell.display if cell else "—"})
            rows.append(cells)
        return {"title": self.title, "description": self.description,
                "columns": [{"field": c.field, "label": c.label, "unit": c.unit} for c in self.columns],
                "rows": rows,
                "source": {"label": self.dataset.name, "dataset": self.dataset.id,
                           "viewId": self.view.identity(self.dataset), "view": self.view.spec(),
                           "totalRecords": len(self.dataset.records),
                           "records": [{"ordinal": r.ordinal, "pointer": r.pointer, "line": r.line} for r in records]}}
