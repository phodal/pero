"""Persistent Python cells in the Native shell's sandboxed interpreter."""
import ast
import asyncio
import builtins
import inspect
import json
import sys
import traceback

wire_in, wire_out = sys.stdin, sys.stdout
cell = None
sequence = 0
printed = 0


def send(kind, **fields):
    wire_out.write(json.dumps({"type": kind, "cell": cell, **fields}) + "\n")
    wire_out.flush()


class CellOutput:
    def write(self, text):
        global printed
        if cell is not None and text and printed < 32 * 1024:
            text = text[: 32 * 1024]
            printed += len(text)
            send("write", text=text)
        return len(text)

    def flush(self):
        pass


class CuaError(RuntimeError):
    def __init__(self, message, result):
        super().__init__(message)
        self.result = result


class Cua:
    async def browser(self, request):
        return self._call("browser", request)

    async def computer(self, request):
        return self._call("computer", request)

    def _call(self, capability, request):
        global sequence
        sequence += 1
        call_id = f"{cell}:{sequence}"
        send("call", id=call_id, capability=capability, input=request)
        reply = json.loads(wire_in.readline())
        if reply["type"] != "reply" or reply["id"] != call_id:
            raise RuntimeError("Unexpected REPL tool response.")
        result = reply["result"]
        if "error" in result:
            raise CuaError(result["error"], result.get("value"))
        return result["value"]

    def emit_image(self, result):
        if not result.get("imageId"):
            raise ValueError("This result has no image.")
        send("image", id=result["imageId"])


def input_unavailable(*args, **kwargs):
    raise RuntimeError("This REPL has no interactive stdin.")


sys.stdout = sys.stderr = CellOutput()
sys.stdin = None
namespace = {"__name__": "__pero_repl__", "__builtins__": dict(vars(builtins), input=input_unavailable), "cua": Cua()}


async def finish(value):
    await value


while line := wire_in.readline():
    message = json.loads(line)
    if message["type"] != "exec":
        raise RuntimeError("Expected a REPL cell.")
    cell = message["id"]
    printed = 0
    try:
        compiled = compile(message["code"], "<pero-cell>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        completion = eval(compiled, namespace)
        if inspect.isawaitable(completion):
            asyncio.run(finish(completion))
    except Exception as failure:
        send("done", error="".join(traceback.format_exception_only(type(failure), failure))[:4096].strip())
    else:
        send("done")
    finally:
        cell = None
