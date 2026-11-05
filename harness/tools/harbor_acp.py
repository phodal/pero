"""Local pinned Pero ACP adapter for Harbor (an optional external dependency)."""
import asyncio
import hashlib
import json
from pathlib import Path
import shlex

from harbor.agents.installed.acp import AcpAgent, AcpOptions


class PeroOptions(AcpOptions):
    binary_path: Path
    image_input: bool = False


class PinnedPeroACP(AcpAgent):
    options_model = PeroOptions

    def __init__(self, binary_path: str, image_input: bool = False, **kwargs):
        self.binary_path = Path(binary_path).resolve(strict=True)
        self.image_input = image_input
        super().__init__(
            registry_entry={
                "id": "pero-agent-acp", "name": "Pero",
                "version": hashlib.sha256(self.binary_path.read_bytes()).hexdigest(),
                "description": "Pinned native Pero ACP diagnostic",
                "distribution": {"local": {"cmd": "/installed-agent/pero-launch.sh"}},
            },
            auth_policy="disabled", permission_mode="allow",
            binary_path=str(self.binary_path), image_input=image_input, **kwargs,
        )

    async def install(self, environment):
        await super().install(environment)
        await environment.upload_file(self.binary_path, "/installed-agent/pero-agent-acp")
        plugin = self.logs_dir / "neutral-plugin.json"
        plugin.write_text(json.dumps({"name": "terminal-bench-neutral", "version": "1.0.0"}))
        await environment.exec(command="mkdir -p /installed-agent/pero-plugin/.claude-plugin", user="root")
        await environment.upload_file(plugin, "/installed-agent/pero-plugin/.claude-plugin/plugin.json")
        launcher = self.logs_dir / "pero-launch.sh"
        image_flag = " --image-input" if self.image_input else ""
        launcher.write_text("""#!/bin/sh
set -eu
umask 077
echo "$$" > /logs/agent/pero-agent.pid
echo "$PPID" > /logs/agent/pero-runner.pid
touch /logs/agent/pero-http-attempts.log
exec /installed-agent/pero-agent-acp \\
  --endpoint https://api.deepseek.com/v1 --model deepseek-flash \\
  --api-key-env DEEPSEEK_API_KEY --plugin-dir /installed-agent/pero-plugin \\
  --workspace "$PWD" --session-dir /logs/agent/pero-sessions \\
  --http-attempt-audit /logs/agent/pero-http-attempts.log \\
  --max-requests 0 --max-turn-steps 0 --max-tokens 8192 --max-retries 0 \\
  --disable-thinking --defer-tool-loading --enable-shell --approval ask
""".rstrip() + image_flag + "\n")
        await environment.upload_file(launcher, "/installed-agent/pero-launch.sh")
        result = await environment.exec(
            command="chmod 755 /installed-agent/pero-agent-acp /installed-agent/pero-launch.sh", user="root")
        if result.return_code:
            raise RuntimeError("Could not stage executable Pero launcher")

    async def run(self, instruction, environment, context):
        try:
            await super().run(instruction=instruction, environment=environment, context=context)
        except asyncio.CancelledError:
            # A cancelled host Docker exec does not signal the container process.
            # Join the precise owned agent before Harbor starts its verifier.
            result = await environment.exec(
                command=f"{self._RUNNER_VENV_PATH}/bin/python -c {shlex.quote(_STOP_AGENT)}", user="root")
            if result.return_code:
                raise RuntimeError("Owned ACP agent termination was not confirmed before verification")
            raise


_STOP_AGENT = r'''
import json, os, signal, time
from pathlib import Path

receipt = {"started_at_unix": time.time(), "signal_sent": None}
pid_file = Path("/logs/agent/pero-agent.pid")
if pid_file.exists():
    pid = int(pid_file.read_text())
    executable = Path(f"/proc/{pid}/exe")
    receipt["pid"] = pid
    if executable.exists():
        # Rosetta exposes its interpreter in /proc/pid/exe; argv[0] retains
        # the staged binary selected by the PID-writing exec launcher.
        argv0 = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0", 1)[0]
        if argv0 != b"/installed-agent/pero-agent-acp":
            raise RuntimeError("Owned PID no longer identifies the staged agent")
        runner_pid = int(Path("/logs/agent/pero-runner.pid").read_text())
        runner_args = Path(f"/proc/{runner_pid}/cmdline").read_bytes().split(b"\0")
        parent = next(line.split()[1] for line in Path(f"/proc/{pid}/status").read_text().splitlines()
                      if line.startswith("PPid:"))
        if int(parent) != runner_pid or b"/installed-agent/acp_runner.py" not in runner_args:
            raise RuntimeError("Owned ACP runner identity was not confirmed")
        os.kill(pid, signal.SIGTERM)
        receipt["signal_sent"] = "SIGTERM"
        # The runner owns the agent's stdin pipe. Close it by terminating
        # that exact parent, allowing the ACP scanner to observe EOF.
        os.kill(runner_pid, signal.SIGTERM)
        receipt["runner_pid"] = runner_pid
        deadline = time.monotonic() + 10
        while executable.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        if executable.exists():
            # Escalation is retained as incomplete graceful cleanup evidence.
            os.kill(pid, signal.SIGKILL)
            receipt["signal_sent"] = "SIGKILL"
            deadline = time.monotonic() + 2
            while executable.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
        receipt["agent_process_stopped"] = not executable.exists()
    else:
        receipt["agent_process_stopped"] = True
else:
    receipt["agent_process_stopped"] = False
receipt["finished_at_unix"] = time.time()
Path("/logs/agent/pero-timeout-cleanup.json").write_text(json.dumps(receipt, indent=2) + "\n")
if not receipt["agent_process_stopped"] or receipt["signal_sent"] == "SIGKILL":
    raise RuntimeError("Graceful owned-agent cleanup was not confirmed")
'''
