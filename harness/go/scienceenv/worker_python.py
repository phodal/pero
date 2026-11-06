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


class Host:
    def mcp(self, server, tool, **kwargs):
        if not isinstance(server, str) or not isinstance(tool, str) or server == "" or tool == "":
            raise RuntimeError("host.mcp requires a server and a tool")
        write_frame("MCP", json.dumps({"server": server, "tool": tool, "arguments": kwargs}).encode("utf-8"))
        kind, payload = read_frame()
        if kind != "MCPRESULT":
            raise RuntimeError("host.mcp did not receive a result")
        message = json.loads(payload.decode("utf-8"))
        if not message.get("ok"):
            raise RuntimeError(message.get("error") or "host.mcp failed")
        return message.get("value")


if REPL:
    host = Host()
    module = types.ModuleType("host")
    module.mcp = host.mcp
    sys.modules["host"] = module
    NS["host"] = module


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
        if kind != "EXEC":
            write_frame("RESULT", json.dumps({"stdout": "", "stderr": "", "error": "unexpected frame " + kind}).encode("utf-8"))
            continue
        stdout, stderr, error = run(payload.decode("utf-8"))
        write_frame("RESULT", json.dumps({"stdout": stdout, "stderr": stderr, "error": error}).encode("utf-8"))


if __name__ == "__main__":
    try:
        main()
    except EOFError:
        pass
