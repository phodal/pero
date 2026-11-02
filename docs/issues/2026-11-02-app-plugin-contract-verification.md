---
kind: verification_report
date: 2026-11-02
related_issue: 2026-10-31-app-python-preparation.md
---

# Existing App recovery contract blocked by Python environment rebinding

While verifying App Agent Plugin integration against HEAD
`d1d0faed12b6bffca835f5cae920de9bc1cdc5c7` plus the working changes,
`tests/contracts/apps.mjs` reaches its final recovery assertion at line 231 and
returns `ok: false` when enabling `recoverable`.

This is supporting verification for the existing
[Python preparation incident](2026-10-31-app-python-preparation.md), not a new
active issue or a claim that the plugin implementation caused the failure.

## Observed failure

A temporary copy of the contract printed Host preparation events and the full
enable result. `UV_OFFLINE=1` kept the diagnostic run from downloading Python or
packages. The reported error was:

```text
Python environment installation failed (exit status: 1):       cache.. Retry after checking the installation log and network.
```

The installer events identify the real cause rather than the abbreviated tail:

```text
Creating <temp>/environment/pero-python312
Installing paper-dependency==1.0
Using Python 3.12.11 environment at: environment/pero-python312
Because paper-dependency was not found in the cache and you require
paper-dependency==1.0, we can conclude that your requirements are
unsatisfiable.
```

The fixture initially uses `python3` (3.14.7 on this machine). A second run with
`PERO_APP_PYTHON` set to the absolute real CPython 3.12.11 executable reaches the
same recovery failure. Merely selecting Python 3.12 does not repair this test.
Using the `~/.local/bin/python3.12` symlink instead also exposes an independent
venv bootstrap problem under `-I`; use the real interpreter path for diagnostics.

## Why the recovery does not take effect

1. The fixture deliberately changes its selected venv's `pyvenv.cfg` to
   `include-system-site-packages = true`, then enables the App.
2. `AppStore::prepare` calls `environment_matches_bundle`; that predicate includes
   isolation validation as well as the Python minor. The deliberately invalid
   config therefore causes preparation to bind the App to the separate managed
   `environment/pero-python312` directory and persist that choice.
3. The fixture restores the original venv and adds synthetic distribution
   metadata under `environments/recoverable`. A direct isolated Python check
   reports `importlib.metadata.version('paper-dependency') == '1.0'` there.
4. The running Host is still bound to `environment/pero-python312`, so the second
   enable checks the other directory and tries to install the synthetic package.

`git show HEAD:crates/pero-runtime/src/apps/mod.rs` has the same Python selection
and rebinding logic. The plugin change adds only
`self.prepare_agent_plugins(name)?` before that logic; this fixture declares no
dependencies and that function immediately returns an empty snapshot. A separate
clean-HEAD binary was not rebuilt, so this is source comparison plus observed
current execution, not a claimed clean-baseline test pass.

## Verification boundary and follow-up

No network access is needed to verify this contract correctly. Its recovery
fixture needs to restore the actual selected managed environment, or restart the
Host with an explicit valid isolated 3.12 binding before checking recovery.
Changing only environment variables cannot undo the in-process rebinding.

The original contract and preparation implementation were left unchanged. The
temporary instrumented script and its disposable Host/venv directories were
removed after the diagnostic runs. This contract remains a recorded blocker;
passing plugin-specific checks do not turn this failure into a passing result.
