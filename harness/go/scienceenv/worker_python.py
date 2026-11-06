"""Persistent Python cell worker for the science kernel.

The supervisor speaks length-prefixed frames on stdin/stdout. Cell prints stay
in the result frame. host.mcp exists only when PERO_SCIENCE_REPL=1.
"""

import ast
import io
import json
import os
import sys
import traceback
import types

PROTO_IN = sys.stdin.buffer
PROTO_OUT = sys.stdout.buffer
LIMIT = int(os.environ.get("PERO_SCIENCE_OUTPUT_BYTES", "262144"))
REPL = os.environ.get("PERO_SCIENCE_REPL") == "1"
NS = {"__name__": "__main__"}


def read_exact(n):
    buf = bytearray()
    while len(buf) < n:
        chunk = PROTO_IN.read(n - len(buf))
        if not chunk:
            raise EOFError("kernel protocol closed")
        buf += chunk
    return bytes(buf)


def read_frame():
    header = PROTO_IN.readline()
    if not header:
        raise EOFError("kernel protocol closed")
    kind, _, rest = header.decode("utf-8").rstrip("\r\n").partition(" ")
    return kind, read_exact(int(rest))


def write_frame(kind, payload):
    PROTO_OUT.write(f"{kind} {len(payload)}\n".encode("ascii"))
    PROTO_OUT.write(payload)
    PROTO_OUT.flush()


def clip(text):
    raw = text.encode("utf-8")
    if len(raw) <= LIMIT:
        return text
    return raw[:LIMIT].decode("utf-8", "ignore") + "\n...[truncated]"


class CredentialUnavailable(RuntimeError):
    pass


class Credentials:
    def request(self, name):
        raise CredentialUnavailable(f"no {name} credential is configured")


class Host:
    def _call(self, method, **fields):
        if method == "mcp" and not REPL:
            raise RuntimeError("host.mcp is available only in the repl kernel")
        fields["method"] = method
        write_frame("HOST", json.dumps(fields).encode("utf-8"))
        kind, payload = read_frame()
        if kind != "MCPRESULT":
            raise RuntimeError("host call did not receive a result")
        message = json.loads(payload.decode("utf-8"))
        if not message.get("ok"):
            raise RuntimeError(message.get("error") or "host call failed")
        return message.get("value")

    def mcp(self, server, tool, **kwargs):
        if not isinstance(server, str) or not isinstance(tool, str) or server == "" or tool == "":
            raise RuntimeError("host.mcp requires a server and a tool")
        return self._call("mcp", server=server, tool=tool, arguments=kwargs)

    def get_user_email(self):
        return self._call("get_user_email")

    def artifact_path(self, version_id):
        if not isinstance(version_id, str) or version_id == "":
            raise RuntimeError("host.artifact_path requires a version id")
        return self._call("artifact_path", version_id=version_id)


def install_host():
    host = Host()
    module = types.ModuleType("host")
    module.mcp = host.mcp
    module.get_user_email = host.get_user_email
    module.artifact_path = host.artifact_path
    module.credentials = Credentials()
    module.CredentialUnavailable = CredentialUnavailable
    sys.modules["host"] = module
    NS["host"] = module


install_host()


def constant(node):
    if isinstance(node, ast.Constant):
        return True
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return all(constant(item) for item in node.elts)
    if isinstance(node, ast.Dict):
        return all(key is not None and constant(key) and constant(value) for key, value in zip(node.keys, node.values))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub, ast.Not, ast.Invert)):
        return constant(node.operand)
    return False


def load_skill(source):
    tree = ast.parse(source, "<skill>", "exec")
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Import, ast.ImportFrom, ast.Pass)):
            continue
        if isinstance(node, ast.Assign) and constant(node.value):
            continue
        if isinstance(node, ast.AnnAssign) and (node.value is None or constant(node.value)):
            continue
        raise ValueError(f"skill kernel.py line {getattr(node, 'lineno', '?')} is not a function or constant")
    exec(compile(tree, "<skill>", "exec"), NS, NS)


def run(code):
    stdout, stderr = io.StringIO(), io.StringIO()
    error = ""
    try:
        tree = ast.parse(code, "<cell>", "exec")
        tail = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            tail = ast.Expression(tree.body.pop().value)
        with_out, with_err = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = stdout, stderr
        try:
            if tree.body:
                exec(compile(tree, "<cell>", "exec"), NS, NS)
            if tail is not None:
                value = eval(compile(tail, "<cell>", "eval"), NS, NS)
                if value is not None:
                    print(repr(value))
        finally:
            sys.stdout, sys.stderr = with_out, with_err
    except BaseException as exc:
        if isinstance(exc, KeyboardInterrupt):
            raise
        error = traceback.format_exc()
    return clip(stdout.getvalue()), clip(stderr.getvalue()), clip(error)


def main():
    while True:
        kind, payload = read_frame()
        source = payload.decode("utf-8")
        if kind == "LOAD":
            error = ""
            try:
                load_skill(source)
            except ValueError as exc:
                error = str(exc)
            except BaseException as exc:
                if isinstance(exc, KeyboardInterrupt):
                    raise
                error = traceback.format_exc()
            write_frame("RESULT", json.dumps({"stdout": "", "stderr": "", "error": error}).encode("utf-8"))
            continue
        if kind != "EXEC":
            write_frame("RESULT", json.dumps({"stdout": "", "stderr": "", "error": "unexpected frame " + kind}).encode("utf-8"))
            continue
        stdout, stderr, error = run(source)
        write_frame("RESULT", json.dumps({"stdout": stdout, "stderr": stderr, "error": error}).encode("utf-8"))


if __name__ == "__main__":
    try:
        main()
    except EOFError:
        pass
