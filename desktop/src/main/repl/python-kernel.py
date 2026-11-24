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
    def __init__(self, reader):
        self.reader = reader
        self.pending = {}
        self.receiving = None

    async def browser(self, request):
        return await self._call("browser", request)

    async def computer(self, request):
        return await self._call("computer", request)

    async def _receive(self):
        try:
            while self.pending:
                reply = json.loads(await self.reader.readline())
                if reply["type"] != "reply" or reply["id"] not in self.pending:
                    raise RuntimeError("Unexpected REPL tool response.")
                future = self.pending.pop(reply["id"])
                if not future.done():
                    future.set_result(reply["result"])
        except Exception as failure:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(failure)
            self.pending.clear()

    async def _call(self, capability, request):
        global sequence
        sequence += 1
        call_id = f"{cell}:{sequence}"
        future = asyncio.get_running_loop().create_future()
        self.pending[call_id] = future
        send("call", id=call_id, capability=capability, input=request)
        if self.receiving is None or self.receiving.done():
            self.receiving = asyncio.create_task(self._receive())
        result = await future
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


async def main():
    global cell, printed
    reader = asyncio.StreamReader(limit=16 * 1024 * 1024)
    transport, _ = await asyncio.get_running_loop().connect_read_pipe(
        lambda: asyncio.StreamReaderProtocol(reader), wire_in,
    )
    cua = Cua(reader)
    namespace = {"__name__": "__pero_repl__", "__builtins__": dict(vars(builtins), input=input_unavailable), "cua": cua}
    try:
        while line := await reader.readline():
            message = json.loads(line)
            if message["type"] != "exec":
                raise RuntimeError("Expected a REPL cell.")
            cell = message["id"]
            printed = 0
            previous = asyncio.all_tasks()
            error = None
            try:
                compiled = compile(message["code"], "<pero-cell>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
                completion = eval(compiled, namespace)
                if inspect.isawaitable(completion):
                    await completion
            except Exception as failure:
                error = "".join(traceback.format_exception_only(type(failure), failure))[:4096].strip()
            finally:
                # A cell's background tasks cannot run in another cell's authority.
                leftover = asyncio.all_tasks() - previous
                for task in leftover:
                    task.cancel()
                if leftover:
                    await asyncio.gather(*leftover, return_exceptions=True)
            send("done", **({"error": error} if error else {}))
            cell = None
            if cua.pending:
                return
    finally:
        transport.close()


asyncio.run(main())
