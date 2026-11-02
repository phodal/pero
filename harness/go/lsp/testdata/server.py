"""Local stdio fixture, shared by language-server and CLI composition tests."""
import json
import os
import sys

mode = os.environ.get("LSP_FIXTURE_MODE", "normal")
log_path = os.environ["LSP_FIXTURE_LOG"]
uri = ""
version = 0
text = ""
pending = None
span = {"start": {"line": 1, "character": 5}, "end": {"line": 1, "character": 10}}


def send(value):
    body = json.dumps(value, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(("Content-Length: %d\r\n\r\n" % len(body)).encode() + body)
    sys.stdout.buffer.flush()


def answer(message, result=None, error=None):
    reply = {"jsonrpc": "2.0", "id": message["id"]}
    reply["error" if error else "result"] = error if error else result
    send(reply)


def item(name="Greet"):
    return {"name": name, "kind": 12, "uri": uri, "range": span,
            "selectionRange": span, "data": {"proof": "roundtrip"}}


while True:
    length = None
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            sys.exit(0)
        if line in (b"\r\n", b"\n"):
            break
        name, value = line.split(b":", 1)
        if name.lower() == b"content-length":
            length = int(value)
    message = json.loads(sys.stdin.buffer.read(length))
    method = message.get("method", "")
    params = message.get("params") or {}
    with open(log_path, "a", encoding="utf-8") as log:
        log.write(json.dumps({"method": method, "params": params,
                              "result": message.get("result"),
                              "pid": os.getpid(), "cwd": os.getcwd()}, ensure_ascii=False) + "\n")
    if not method:
        continue
    if method == "initialize":
        if mode == "startup-hang":
            pending = message
            continue
        capabilities = {"positionEncoding": "utf-8" if mode == "wrong-encoding" else "utf-16", "textDocumentSync": {"openClose": True, "change": 1},
                        "definitionProvider": True, "referencesProvider": True, "implementationProvider": True,
                        "hoverProvider": mode != "missing-capability", "documentSymbolProvider": True,
                        "workspaceSymbolProvider": True, "callHierarchyProvider": True}
        if mode.startswith("after-edit"):
            capabilities["textDocumentSync"]["save"] = {"includeText": True}
        answer(message, {"capabilities": capabilities})
    elif method == "initialized":
        send({"jsonrpc": "2.0", "id": "configuration-fixture", "method": "workspace/configuration",
              "params": {"items": [{"section": "fixture"}]}})
        send({"jsonrpc": "2.0", "id": "edit-fixture", "method": "workspace/applyEdit",
              "params": {"edit": {"changes": {"file:///should-not-exist": []}}}})
    elif method == "textDocument/didOpen":
        uri = params["textDocument"]["uri"]
        version = params["textDocument"]["version"]
        text = params["textDocument"]["text"]
    elif method == "textDocument/didSave":
        if mode == "after-edit-crash":
            os._exit(7)
        if mode == "after-edit-hang":
            continue
        if mode.startswith("after-edit"):
            assert params["text"] == text
            send({"jsonrpc": "2.0", "method": "textDocument/publishDiagnostics",
                  "params": {"uri": uri, "version": version,
                             "diagnostics": [{"range": span, "severity": 1, "message": "saved file type error"}] if "BROKEN" in text else []}})
    elif method in ("textDocument/definition", "textDocument/implementation"):
        answer(message, [{"targetUri": uri, "targetRange": span, "targetSelectionRange": span}])
    elif method == "textDocument/references":
        if params["context"]["includeDeclaration"] is not True:
            answer(message, error={"code": -32602, "message": "declaration required"})
        else:
            answer(message, [{"uri": uri, "range": span}])
    elif method == "textDocument/hover":
        if mode.startswith("diagnostics"):
            def publish(target, revision, text):
                send({"jsonrpc": "2.0", "method": "textDocument/publishDiagnostics",
                      "params": {"uri": target, "version": revision,
                                 "diagnostics": [{"range": span, "severity": 1, "source": "fixture", "message": text}] if text else []}})
            publish(uri, version, "fixture type error 🧪")
            publish(uri, version - 1, "stale error")
            publish("file:///unselected.go", version, "foreign error")
            if mode == "diagnostics-clear":
                publish(uri, version, "")
        if mode in ("cancel", "uncancellable"):
            pending = message
            open(log_path + ".query-ready", "w").close()
            continue
        if mode == "crash" and not os.path.exists(log_path + ".crashed"):
            open(log_path + ".crashed", "w").close()
            os._exit(7)
        answer(message, {"contents": [{"language": "go", "value": "func Greet()"}, "Fixture documentation"]})
    elif method == "textDocument/documentSymbol":
        answer(message, [{"name": "Greet", "kind": 12, "range": span, "selectionRange": span,
                          "children": [{"name": "nested", "kind": 13, "range": span, "selectionRange": span}]}])
    elif method == "workspace/symbol":
        if params["query"] != "Greet":
            answer(message, error={"code": -32602, "message": "cursor identifier required"})
        else:
            answer(message, [{"name": "Greet", "kind": 12, "location": {"uri": uri, "range": span}}])
    elif method == "textDocument/prepareCallHierarchy":
        answer(message, [item()])
    elif method in ("callHierarchy/incomingCalls", "callHierarchy/outgoingCalls"):
        if params["item"].get("data") != {"proof": "roundtrip"}:
            answer(message, error={"code": -32602, "message": "opaque item not retained"})
        else:
            direction = "from" if method.endswith("incomingCalls") else "to"
            answer(message, [{direction: item("Caller" if direction == "from" else "Callee"), "fromRanges": [span]}])
    elif method == "$/cancelRequest":
        if mode != "uncancellable" and pending and params["id"] == pending["id"]:
            answer(pending, error={"code": -32800, "message": "cancelled"})
            pending = None
    elif method == "shutdown":
        if mode != "shutdown-hang":
            answer(message)
    elif method == "exit":
        sys.exit(0)
    elif "id" in message:
        answer(message, error={"code": -32601, "message": "not implemented"})
