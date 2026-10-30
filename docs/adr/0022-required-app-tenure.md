# Required App tenure

Status: implemented, 2026-10-30.

## Context

An App is already one package: `AppDefinition` from `app.json`, installed by
`AppStore` (`crates/pero-runtime/src/apps`). The product list in
`products/pero.json` only decides which pretrusted packages `BuiltinDiscovery`
may install once. After that, `InstallRecord.enabled` is an ordinary preference.
`set_enabled(false)` and `uninstall` are legal for every installed App,
including Virtual Cell and Paper Agent. ADR 0007 records that choice: a removal
is remembered so startup does not put the package back.

Insights is not an App. It is `WorkbenchPage::Insights`, drawn in
`project_view.rs` and opened by the `sidebar-insights` row. That page cannot
host Point's React recap. ADR 0007 already says a React panel mounts only as an
App document, in the existing content slot (`WorkspaceItem::App`,
`pero-app://`), not inside a GPUI view.

The workbench needs one App that stays installed and enabled, so that recap can
move into a panel later. A boolean on Insights, or a flag the shell is trusted
not to flip, does not do that.

## Decision

One App type stays. Tenure is a second fact, owned only by `AppStore`:

```text
enum Tenure { Optional, Required }
```

`Optional` is today's installation: it starts disabled, and enable, disable and
uninstall are transitions. `Required` is a name the composition root passes in
from the product. It is not a field of `app.json`, not a field of
`.installation.json`, and not something `BuiltinDiscovery` records. Discovery
still means "offered once". Tenure means "this identity has no disabled state".

`set_enabled(name, false)` and `uninstall(name)` refuse a `Required` name with
one named error. The Host arm in `crates/pero-host/src/apps.rs` maps that error
onto the existing `AppFailure`. It does not decide the rule again. If a
required App's installation file says disabled, `open` writes it back to
enabled. That reconciliation is the same transition, not a repair hidden in
Insights.

A required App is shown by the existing catalog and opened as
`WorkspaceItem::App`. It does not get a `WorkbenchPage`. The `sidebar-insights`
row is the current GPUI projection; it is not a second navigator and it is not
the place the React panel will live. When the panel exists, opening Insights is
the same action as opening any other App panel. The catalog row for a required
App has no disable or remove control, because those commands already failed in
the core.

The Insights panel, when added, may call the Host command already implemented
in `crates/pero-host/src/insights.rs`. That shell maps `sessions.jsonl` and
calls `crates/session-analysis`. The panel does not import the fold, does not
read git, and does not own memory. Its backend, if it has one, stores only
panel state. Point's recap sections stay in the panel; the fold stays in the
crate.

`Tenure` is checked for every App in those two transitions. Insights is only a
name on the required list.

## What this does not change

Optional builtins keep ADR 0007: they can be disabled and removed, and removal
still suppresses reinstall. This decision adds no marketplace, plugin host, or
sandbox. Insights is the Required panel `apps/insights`. The GPUI page is not
the product surface. The unmerged Pulse cabinet stays unused.
