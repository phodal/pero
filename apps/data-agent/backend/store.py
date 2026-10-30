"""App-private immutable source storage. Host supplies the data root."""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import tempfile
from dataset import Dataset, Invalid
from view import metadata


@dataclass(frozen=True)
class DatasetId:
    value: str

    def __post_init__(self):
        if not isinstance(self.value, str) or not re.fullmatch(r"[a-f0-9]{64}", self.value):
            raise Invalid("Invalid dataset identity")


class DatasetStore:
    def __init__(self, directory):
        self.root = Path(directory)
        self.root.mkdir(parents=True, exist_ok=True)
        self.current: Dataset | None = None

    def write(self, filename, content):
        descriptor, name = tempfile.mkstemp(prefix=".dataset-", dir=self.root)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as output:
                output.write(content)
            os.replace(name, self.root / filename)
        finally:
            Path(name).unlink(missing_ok=True)

    def put(self, dataset: Dataset):
        self.write(dataset.id + ".source", dataset.source)
        self.write(dataset.id + ".meta.json", json.dumps(metadata(dataset), ensure_ascii=False))
        self.current = dataset

    def read(self, identity: DatasetId) -> Dataset:
        if self.current is not None and self.current.id == identity.value:
            return self.current
        try:
            meta = json.loads((self.root / (identity.value + ".meta.json")).read_text())
            source = (self.root / (identity.value + ".source")).read_bytes().decode("utf-8")
        except FileNotFoundError:
            raise Invalid("The dataset is unavailable; import its source again") from None
        dataset = Dataset.parse(source, meta["name"], meta["format"] == "json_lines")
        if dataset.id != identity.value:
            raise Invalid("The saved source digest does not match this dataset")
        self.current = dataset
        return dataset

    def catalog(self):
        return [json.loads(path.read_text()) for path in sorted(self.root.glob("*.meta.json"))]
