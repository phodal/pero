"""SQLite I/O for derived local copies and immutable, hashed query receipts."""
from dataclasses import asdict, dataclass
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
from threading import Event
from time import perf_counter

from semantics import ReadGrant


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                       allow_nan=False) + '\n').encode()


def save(path, value):
    content = encoded(value)
    with path.open('xb') as stream:
        stream.write(content)
    return sha256(content).hexdigest()


@dataclass(frozen=True)
class DataSnapshot:
    version: str
    database: Path
    database_sha256: str
    export_file: str
    export_sha256: str
    asset_id: str
    asset_sha256: str
    dataset_id: str
    source_sha256: str
    definitions_sha256: str
    synthetic_sha256: str
    schema_sha256: str


@dataclass(frozen=True)
class QueryRows:
    rows: tuple[dict, ...]
    elapsed_seconds: float


class ReadOnlyQuery:
    def __init__(self, database: Path, grant: ReadGrant, vm_budget: int):
        self.database, self.grant, self.vm_budget = database, grant, vm_budget

    def execute(self, sql, parameters, cancel=None, started=None):
        cancel = cancel if cancel is not None else Event()
        if cancel.is_set():
            raise sqlite3.OperationalError('interrupted: cancelled before execution')
        steps = 0

        def progress():
            nonlocal steps
            steps += 100
            if started is not None:
                started.set()
            return int(cancel.is_set() or steps >= self.vm_budget)

        def authorize(action, first, second, database, trigger):
            if action == sqlite3.SQLITE_SELECT:
                return sqlite3.SQLITE_OK
            if action == sqlite3.SQLITE_READ and self.grant.permits_read(first, second, database):
                return sqlite3.SQLITE_OK
            if action == sqlite3.SQLITE_FUNCTION and second.lower() in ('count', 'sum', 'avg', 'round', 'min', 'max'):
                return sqlite3.SQLITE_OK
            return sqlite3.SQLITE_DENY

        start = perf_counter()
        connection = sqlite3.connect(self.database.resolve().as_uri() + '?mode=ro', uri=True)
        try:
            connection.execute('PRAGMA query_only=ON')
            connection.enable_load_extension(False)
            connection.row_factory = sqlite3.Row
            connection.set_authorizer(authorize)
            connection.set_progress_handler(progress, 100)
            rows = tuple(dict(row) for row in connection.execute(sql, parameters))
        finally:
            connection.close()
        return QueryRows(rows, perf_counter() - start)


@dataclass(frozen=True)
class QueryReceipt:
    question: str
    repetition: int
    status: str
    reason: str
    actor: str
    project: str
    read_grant: tuple
    snapshot: dict
    definition: dict | None
    parameters: dict
    row_count: int
    presentation_rows: tuple
    truncated: bool
    result_file: str | None
    result_sha256: str | None
    elapsed_seconds: float
    sqlite_version: str
    arm: str = 'D_manual_reference'
    model_run: bool = False

    @classmethod
    def record(cls, directory, intent, decision, grant, snapshot, repetition, rows, cap):
        result_file = result_hash = None
        if rows is not None:
            result_file = f'{intent.question}-{repetition}.rows.json'
            result_hash = save(directory / result_file, rows.rows)
        result = rows.rows if rows is not None else ()
        source = asdict(snapshot)
        source['database'] = snapshot.database.name
        receipt = cls(intent.question, repetition, decision.status, decision.reason, grant.actor,
                      grant.project, grant.columns, source,
                      asdict(decision.definition) if decision.definition else None,
                      dict(intent.parameters), len(result), result[:cap], len(result) > cap,
                      result_file, result_hash, rows.elapsed_seconds if rows else 0,
                      sqlite3.sqlite_version)
        name = f'{intent.question}-{repetition}.receipt.json'
        save(directory / name, asdict(receipt))
        return name

    @staticmethod
    def replay(path):
        """Read the stored evidence only; never execute SQL or ask a model."""
        receipt = json.loads(path.read_bytes())
        if receipt['result_file']:
            content = (path.parent / receipt['result_file']).read_bytes()
            if sha256(content).hexdigest() != receipt['result_sha256']:
                raise ValueError('Stored result hash mismatch')
            rows = json.loads(content)
            if len(rows) != receipt['row_count']:
                raise ValueError('Stored result count mismatch')
        return receipt
