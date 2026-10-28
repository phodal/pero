---
kind: verification_report
date: 2026-10-28
---

# Zed composer alignment, batch 1

Scope and remaining batches: [parity matrix](../design-docs/zed-composer-parity.md).
Reference checkout: Zed `37faef81f74fc1bb08be9939c4cffc8ede6ced2f`.

## Implemented

The shared GPUI composer uses Kit popup menus for Agent, model, mode and reasoning
configuration. The old inline absolute-positioned Agent popup is removed. Menus
have accessible option names, current-value checkmarks and keyboard selection.
The toolbar can wrap at narrow widths.

`SessionSettings` owns advertised-choice validation. The ACP shell translates
modern config options and legacy session modes into that typed catalog. Unsupported
settings are absent. UI requests set a pending state, retain the last confirmed
label and disable sending until Agent acknowledgement or an error. Agent updates
and model changes refresh the catalog. Modes retain their advertised descriptions;
no Autopilot/allow-all mode is selected by the tests.

The installed official Copilot CLI is registered as `copilot --acp --stdio`.
Its native executable is not bundled. This is the Copilot ACP Agent path, not a
Copilot Chat model provider or edit-prediction implementation.

## Verification

- Rust contracts/runtime/Host tests passed: three contract tests and 19 runtime
  tests, including acknowledged settings, rejected/unknown choices, grouped
  options, legacy mode selection and continued conversation after rejection.
- Native and Wasm UI compilation passed; release Host and native UI built.
- Generated-contract/theme/locale checks passed (358 bilingual messages).
- Host JSONL conformance passed, exercising 25/36 declared event kinds, including
  the new `configuration_changed` payload and `configure` command.
- Copilot CLI 1.0.95 initialized against the actual native App. Menus contained
  its advertised models, Agent/Plan/Autopilot and available reasoning levels.
- Native UI changed Mode to Plan, then back to Agent. Keyboard Up/Enter selected
  max reasoning, then a menu action restored low. Journal receipts independently
  confirmed the corresponding actual Agent values.
- A real Copilot request returned exactly `PERO_COPILOT_OK`, visibly rendered in
  the native conversation, followed by a persisted `turn_finished` event.
- Twelve real configuration events validated against the generated schema.
  Machine-readable evidence is `test-results/copilot/native-result.json`; the
  isolated native verification profile is `target/native-composer-qa`.
- Switching to Auto subsequently removed the reasoning control when the Agent
  stopped advertising it. No fabricated fallback option was displayed.

## Limits

The App was subsequently in active use, so no forced restart or focus-taking
Electron fixture suite was run against that live session. Dark/narrow visual
acceptance and the modified Electron fixture regression remain pending. Their
test commands still use the fixture and do not establish Copilot execution.

Files/directories, symbols, threads, skills, images, selections, branch diff and
mention/slash completion remain batch 2; only the existing file attachment flow
is present. Direct Copilot Chat authentication/provider execution and editor
inline prediction remain separate. Full Zed feature parity is not claimed.
