"""Deterministic acceptance Agent. All browser actions target the owned fixture."""
import base64
import hashlib
import json
import platform
import sys
import urllib.request


def send(payload):
    print(json.dumps({"jsonrpc": "2.0", **payload}), flush=True)


def rpc(server, method, params):
    headers = {item["name"]: item["value"] for item in server["headers"]}
    headers["Content-Type"] = "application/json"
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    post = urllib.request.Request(server["url"], data=json.dumps(payload).encode(), headers=headers)
    with urllib.request.urlopen(post, timeout=15) as response:
        return json.load(response)["result"]


def browser(server, **arguments):
    return rpc(server, "tools/call", {"name": "browser_use", "arguments": arguments})


def exercise(server, prompt):
    tool = next(tool for tool in rpc(server, "tools/list", {})["tools"] if tool["name"] == "browser_use")
    actions = [option["properties"]["action"]["const"] for option in tool["inputSchema"]["anyOf"]]
    tabs = json.loads(browser(server, action="tabs")["content"][0]["text"])["tabs"]
    result = {"platform": platform.system(), "tabs": tabs, "actions": actions}
    if "Exercise the owned Chrome fixture" in prompt:
        title = "SSH Browser fixture"
    elif "Exercise the owned embedded fixture" in prompt:
        title = "SSH Embedded fixture"
    else:
        return result
    tab = next(item for item in tabs if item["title"] == title)["tabId"]
    forbidden = browser(server, action="files")
    assert forbidden["isError"], forbidden
    locate = browser(server, action="locate", tabId=tab,
                     locator={"by": "role", "role": "button", "name": "Mark fixture"})
    ref = json.loads(locate["content"][0]["text"])["nodes"][0]["ref"]
    click = browser(server, action="click", tabId=tab, ref=ref)
    result["click"] = json.loads(click["content"][0]["text"])
    found = browser(server, action="wait", tabId=tab, locator={"by": "testId", "value": "effect"},
                    condition={"kind": "text", "value": "Trusted remote click"})
    result["verified"] = json.loads(found["content"][0]["text"])
    pixels = browser(server, action="screenshot", tabId=tab)
    image = next(item for item in pixels["content"] if item["type"] == "image")
    receipt = json.loads(pixels["content"][0]["text"])["receipt"]
    decoded = base64.b64decode(image["data"])
    assert hashlib.sha256(decoded).hexdigest() == receipt["sha256"], receipt
    result["screenshot"] = {"mimeType": image["mimeType"], "receipt": receipt}
    return result


server = None
for line in sys.stdin:
    message = json.loads(line)
    method = message["method"]
    params = message.get("params", {})
    request = message.get("id")
    if method == "initialize":
        send({"id": request, "result": {
            "protocolVersion": 1, "agentCapabilities": {"mcpCapabilities": {"http": True}},
        }})
    elif method == "session/new":
        server = next(item for item in params["mcpServers"] if item["name"] == "pero-app-use")
        send({"id": request, "result": {"sessionId": "ssh-browser"}})
    elif method == "session/prompt":
        prompt = "\n".join(item["text"] for item in params["prompt"] if item["type"] == "text")
        try:
            result = exercise(server, prompt)
        except Exception as error:
            result = {"error": str(error)}
        send({"method": "session/update", "params": {"sessionId": "ssh-browser", "update": {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "SSH_BROWSER:" + json.dumps(result)},
        }}})
        send({"id": request, "result": {"stopReason": "end_turn"}})
