# Automations

Pero-owned React/App SDK UI. Build inputs are this repository and frozen public
npm dependencies; no external Workbench checkout, runtime or scheduler is used.

The compact list supports search, templates, create/edit, enable/pause, manual
run, run history and existing-session navigation. New drafts and templates are
paused by default. Hourly/daily/weekly/monthly rules support intervals 1–366 and
IANA zones. Host resolves `Local` when saving. Unsupported advanced RRULEs are
rejected rather than approximated; existing rules retain their exact text when
edited. Legacy errors appear in the list and remain editable for explicit
re-save. Event-triggered rules are viewable but not editable here.

Only the declared `automation` capability is used: POST `/host/automation` with
`{method,path,body}`, receiving `{status,body}`. Host owns workspace/Agent
admission, permissions, persistence, scheduling and execution. A queued receipt
is not success; completion is not scientific validation. No global fetch hook,
connector capability, credentials or arbitrary code execution is introduced.

The editor has no native forms: Enter cannot navigate an iframe lacking
`allow-forms`; Ctrl/Cmd+Enter explicitly saves.

```sh
npm ci --prefix apps/automations --ignore-scripts
node scripts/build/automation-app.mjs
npm run typecheck --prefix apps/automations
node --test apps/automations/test/*.test.mjs
```

Optional built-UI loopback fixture:

```sh
node apps/automations/test/ui-smoke.mjs
```

It uses Playwright Chromium (or `PERO_CHROMIUM_PATH`) and an iframe with only
`allow-scripts allow-same-origin`. It checks legacy error/re-save affordance,
create/edit, enable/pause, run receipt, history/session navigation and templates.
Screenshots go to `test-results/automations/`. The mock Host is UI evidence only;
real Host/SQLite/ACP contracts belong to `tests/runtime/automation-app.mjs`.
For manual fixture inspection: `node apps/automations/test/preview.mjs`.
