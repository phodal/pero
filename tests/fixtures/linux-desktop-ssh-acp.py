import json
import sys
import urllib.request


def send(payload):
    print(json.dumps({"jsonrpc": "2.0", **payload}), flush=True)


server = None
for line in sys.stdin:
    message = json.loads(line)
    method = message["method"]
    params = message.get("params", {})
    request = message.get("id")
    if method == "initialize":
        send({"id": request, "result": {"protocolVersion": 1, "agentCapabilities": {"mcpCapabilities": {"http": True}}}})
    elif method == "session/new":
        server = next(item for item in params["mcpServers"] if item["name"] == "pero-app-use")
        send({"id": request, "result": {"sessionId": "ssh-linux"}})
    elif method == "session/prompt":
        payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "computer_use", "arguments": {"operation": "status"},
        }}
        headers = {item["name"]: item["value"] for item in server["headers"]}
        headers["Content-Type"] = "application/json"
        post = urllib.request.Request(server["url"], data=json.dumps(payload).encode(), headers=headers)
        with urllib.request.urlopen(post, timeout=10) as response:
            result = json.load(response)["result"]["content"][0]["text"]
        send({"method": "session/update", "params": {"sessionId": "ssh-linux", "update": {
            "sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": f"SSH_COMPUTER:{result}"},
        }}})
        send({"id": request, "result": {"stopReason": "end_turn"}})
