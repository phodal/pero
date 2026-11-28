"""SQLite storage for the inbox."""
import sqlite3
from contextlib import closing


class Inbox:
    def __init__(self, path):
        self.path = path
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL)")

    def create(self, title):
        with closing(sqlite3.connect(self.path)) as db, db:
            created = db.execute("INSERT INTO tasks (title) VALUES (?)", (title,))
            return {"id": created.lastrowid, "title": title}

    def list(self):
        with closing(sqlite3.connect(self.path)) as db:
            return [{"id": task_id, "title": title}
                    for task_id, title in db.execute("SELECT id, title FROM tasks ORDER BY id")]
