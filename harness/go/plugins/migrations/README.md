# Selected configuration migration

`selected-config-v1.json` records 17 repairs across six anonymous plugin IDs.
Each file has its relative path, before/after SHA256 and typed actions. No source
repository identity, connection configuration or original instruction body is
copied into this directory. Existing connection values stay in the operator's
local package and are preserved by the transformations.

`replay.py` reads only explicitly supplied package roots. It performs no remote
fetch, dependency installation, hook execution, MCP connection or model request.
It validates every selected source and expected result digest before writing any
file. Replaying an already migrated snapshot reports `already-applied`.

Bind every ID used by the plan to its package directory:

```sh
python3 replay.py --check \
  --root P01=/absolute/plugin-01 --root P02=/absolute/plugin-02 \
  --root P08=/absolute/plugin-08 --root P10=/absolute/plugin-10 \
  --root P13=/absolute/plugin-13 --root P15=/absolute/plugin-15
```

Remove `--check` to apply. A digest mismatch refuses the migration instead of
guessing how to modify another revision. Current parser behavior remains strict;
these are source-package repairs.

| ID | Repair |
| --- | --- |
| P01 | Add the hooks wrapper; read nested tool input and confine memory targets after path resolution |
| P02 | Add the required agent name |
| P08 | Select the actual agent Markdown file and use the documented skill session substitution |
| P10 | Put the interpreter in command and its script path in args for three Python hooks |
| P13 | Add only required name/description metadata to eight agents; use subagent_type in their caller |
| P15 | Align the documented MCP alias and convert four timeout values from seconds to milliseconds |

The agent metadata repairs preserve default inherited tools and models. The
guard checks Write/Edit and notebook targets; it does not establish read-only
Bash or MCP policy. Successful configuration compilation does not prove external
dependencies, interactive UI or complete plugin workflows.

Run the local migration tests from this directory:

```sh
python3 -m unittest test_replay.py
```

Tests execute only the memory guard against disposable paths. They check real
exit codes for allowed targets, source writes, malformed payloads, top-level
field spoofing, traversal and symlink escapes. Other tests cover digest refusal,
complete preflight, idempotence and preservation of unrelated opaque fields.
