#!/usr/bin/env python3
"""Independently verify an approved Task Inbox patch on its original base."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import select
import sqlite3
import subprocess
import sys
import tempfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


@contextmanager
def inbox(cwd, database):
    with subprocess.Popen([sys.executable, "-B", str(cwd / "api.py"), str(database)],
                          cwd=cwd,
                          env={"PATH": os.defpath, "HOME": str(cwd.parent)},
                          stdout=subprocess.PIPE, text=True) as process:
        try:
            if not select.select([process.stdout], [], [], 10)[0]:
                raise RuntimeError("Inbox did not report a listening port")
            port = int(process.stdout.readline().strip())
            yield f"http://127.0.0.1:{port}"
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def request(origin, route, status, *, method="GET", payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    ask = Request(origin + route, method=method, data=body, headers={"Content-Type": "application/json"})
    try:
        response = urlopen(ask, timeout=5)
    except HTTPError as error:
        response = error
    with response:
        result = json.load(response)
        if response.status != status:
            raise AssertionError(f"{method} {route}: expected {status}, got {response.status}")
        return result


def require_bool_archived(body):
    rows = body["tasks"] if isinstance(body, dict) and "tasks" in body else [body]
    for row in rows:
        if type(row.get("archived")) is not bool:
            raise AssertionError(f"archived must be a JSON boolean, got {row.get('archived')!r}")
    return body


def check_inbox(worktree, scratch):
    with inbox(worktree, scratch / "fresh.db") as origin:
        assert request(origin, "/tasks", 200)["tasks"] == []
        fresh = require_bool_archived(request(origin, "/tasks", 201, method="POST", payload={"title": "Fresh task"}))
        assert fresh == {"id": 1, "title": "Fresh task", "archived": False}
    dbfile = scratch / "inbox.db"
    with sqlite3.connect(dbfile) as db:
        db.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL)")
        db.execute("INSERT INTO tasks (id, title) VALUES (17, 'Legacy task')")
    legacy = {"id": 17, "title": "Legacy task", "archived": False}
    archived = {**legacy, "archived": True}
    with inbox(worktree, dbfile) as origin:
        assert require_bool_archived(request(origin, "/tasks", 200))["tasks"] == [legacy]
        new = require_bool_archived(request(origin, "/tasks", 201, method="POST", payload={"title": "  New task  "}))
        assert new == {"id": 18, "title": "New task", "archived": False}
        request(origin, "/tasks", 400, method="POST", payload={"title": " "})
        for _ in range(2):
            assert require_bool_archived(request(origin, "/tasks/17/archive", 200, method="POST")) == archived
        for route in ("/tasks", "/tasks?view=active"):
            assert require_bool_archived(request(origin, route, 200))["tasks"] == [new]
        assert require_bool_archived(request(origin, "/tasks?view=archived", 200))["tasks"] == [archived]
        assert require_bool_archived(request(origin, "/tasks?view=all", 200))["tasks"] == [archived, new]
        for route in ("/tasks?view=bad", "/tasks?view=", "/tasks?view=active&view=active"):
            request(origin, route, 400)
        for route in ("/tasks/999/archive", "/tasks/999/restore", "/tasks/no/archive", "/tasks/0/restore",
                      "/tasks/9223372036854775808/archive"):
            request(origin, route, 404, method="POST")
    with inbox(worktree, dbfile) as origin:
        assert require_bool_archived(request(origin, "/tasks?view=archived", 200))["tasks"] == [archived]
        for _ in range(2):
            assert require_bool_archived(request(origin, "/tasks/17/restore", 200, method="POST")) == legacy
        assert require_bool_archived(request(origin, "/tasks?view=archived", 200))["tasks"] == []
    with inbox(worktree, dbfile) as origin:
        assert require_bool_archived(request(origin, "/tasks", 200))["tasks"] == [legacy, new]
    return ["fresh and legacy SQLite databases", "create and title validation", "archive and restore idempotency",
            "active, archived and all views", "invalid views and action routes", "persistence across two restarts"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True, help="Fixture repository containing the recorded base commit")
    parser.add_argument("--patch", type=Path, required=True)
    parser.add_argument("--approval", type=Path, required=True, help="Operator receipt with approved, base_sha and patch_sha256")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not __debug__:
        parser.error("run with Python assertions enabled")
    patch = args.patch.resolve(strict=True)
    approved = json.loads(args.approval.read_text())
    digest = hashlib.sha256(patch.read_bytes()).hexdigest()
    base = git(args.repo, "rev-parse", "HEAD")
    if approved.get("approved") is not True or approved.get("base_sha") != base or approved.get("patch_sha256") != digest:
        raise SystemExit("Approval does not match the exact patch and base SHA")
    with tempfile.TemporaryDirectory(prefix="pero-inbox-check-") as location:
        scratch = Path(location)
        worktree = scratch / "worktree"
        git(args.repo, "worktree", "add", "--detach", str(worktree), base)
        try:
            git(worktree, "apply", "--check", str(patch))
            git(worktree, "apply", str(patch))
            if set(git(worktree, "diff", "--name-only").splitlines()) != {"api.py", "store.py"}:
                raise AssertionError("Patch must change only api.py and store.py")
            if git(worktree, "ls-files", "--others", "--exclude-standard"):
                raise AssertionError("Patch introduced unexpected paths")
            checks = check_inbox(worktree, scratch)
        finally:
            git(args.repo, "worktree", "remove", "--force", str(worktree))
    with args.output.open("x") as output:
        json.dump({"passed": True, "base_sha": base, "patch_sha256": digest, "checks": checks}, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
