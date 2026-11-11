"""The read-only SQLite boundary shared by Data and its offline evaluation."""
from dataclasses import dataclass
from pathlib import Path
import sqlite3
from threading import Event
from time import perf_counter
from semantic_domain import ReadGrant


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
            cursor = connection.execute(sql, parameters)
            names = tuple(column[0] for column in cursor.description or ())
            if len(names) != len(set(names)):
                raise ValueError('Query result columns need unique names; alias duplicate join columns')
            rows = tuple(dict(row) for row in cursor)
        finally:
            connection.close()
        return QueryRows(rows, perf_counter() - start)
