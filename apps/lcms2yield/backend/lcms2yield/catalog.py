"""Load the vendored released reaction table. The bytes are pinned; nothing is downloaded."""
import csv
import hashlib
from pathlib import Path

from .domain import COLUMNS, REACTION_SHA256, Invalid, ReactionRow

TABLE = Path(__file__).resolve().parent.parent / 'data' / 'Reaction.csv'


def load_rows(path=TABLE):
    data = Path(path).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != REACTION_SHA256:
        raise Invalid('asset', 'Reaction.csv is not the pinned LCMS2Yield release table')
    text = data.decode('utf-8')
    reader = csv.DictReader(text.splitlines())
    if reader.fieldnames != list(COLUMNS):
        raise Invalid('schema', 'Reaction.csv columns do not match the pinned release')
    rows = [ReactionRow.parse(index, raw) for index, raw in enumerate(reader)]
    if not rows:
        raise Invalid('population', 'The yield table is empty')
    return tuple(rows)
