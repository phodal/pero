# Selected research source profile

This profile composes the original Chinese skills from
[Deep-Research-skills](https://github.com/Weizhena/Deep-Research-skills/tree/6ce38f60e3f8b22502c29873f96503a4e0c5addb).
The inspected revision is `6ce38f60e3f8b22502c29873f96503a4e0c5addb`, licensed
under MIT, copyright 2026 Lan Zheng. The selected checkout's `LICENSE` is
copied into every prepared package view. `source.json` records the exact
selected files and SHA-256 digests; a changed source requires another review
and an explicit manifest update.

The original source contains `research`, `research-deep`, `research-report`,
`research-add-items`, `research-add-fields`, one `web-search-agent`, five
strategy modules and its Python validator. It does not declare a skill called
`deep-research`. The additional `deep-research:deep-research` entry composes
the original three main stages, so a caller's unique bare `deep-research`
reference resolves to the selected dependency.

Selection requires all of these CLI options, alongside normal provider,
workspace and session-directory options:

```text
--research-source /absolute/path/to/Deep-Research-skills
--research-python /absolute/path/to/venv/bin/python3
--plugin-model opus=EXPLICIT_PROVIDER_MODEL_ID
--enable-shell
--web-provider deepseek-api
```

The selected Python must already import PyYAML under `-I`. Preparation checks
this with an argv-based subprocess and never installs dependencies or contacts
a package registry. Model routing remains explicit: the original `model: opus`
is preserved. Web provider credentials use the existing explicit Web options.
The ACP client must negotiate the `pero.userQuestions` extension and implement
its input UI. No question is presented as a permission request.

`Prepare` reads the exact inspected resources through descriptor-bound scoped
readers and writes a content-addressed package under
`SESSION_DIRECTORY/snapshots/research/DIGEST`. It leaves the checkout and all
global skill directories unchanged. Package publication uses `os.Root` and
rejects a symlink in the `research` parent or a changed existing snapshot.
`SOURCE.json` records the source revision, license, selected interpreter and
PyYAML version, and each migration's source path, target path, action and
before/after SHA-256. Repeating the same input reuses the verified view.

Only the original global module/validator paths and Python executable are
adapted. The original `Task` calls use the selected profile's opt-in legacy
alias to the same Agent lifecycle, with actual background settlement notices.
The validator body remains byte-identical in `validate_json.upstream.py`.
A thin launcher rejects missing JSON, an empty selection and an explicitly
missing schema before executing that body; these cases otherwise permit the
original validator to return success without validating an item.

The three stages remain in the root session to preserve human confirmation of
the framework, time range, existing fields, batch sizing, final outline,
subsequent batches and report summary fields. Item researchers run as real
background subagents. They read their original strategy modules, retrieve
evidence, write item JSON and execute the original validator. A file's presence
alone does not count as successful completion. The workflow requires a real
settled task and successful validation. Background tasks use the existing live
session lifecycle; this profile does not promise detached execution after the
parent exits or background resumption after a process restart.

Report generation follows the original skill's generated Python script and
produces the actual topic `report.md`. The compatibility entry requires `Read`
of that file before returning to the calling analysis. When preserving raw
research, the workflow uses approved Bash copying and byte comparison to keep
the report unchanged; it does not save a Skill definition response as a report.
The caller then creates its source ledger, cited report and summary.

An opt-in loopback CLI test exercises both the original skills and original
validator, including six real ACP questions, two background researchers, ten
searches, two fetches with isolated extraction, real Python validation and
report generation, byte-identical raw preservation and the caller's completed
artifacts. Set `PERO_RESEARCH_SOURCE`, `PERO_RESEARCH_PYTHON` and
`PERO_KNOWLEDGE_SOURCE` to the selected local checkouts/interpreter, then run:

```sh
go test -race ./researchprofile ./cmd/pero-agent-acp -run 'Test(Snapshot|SourceAdaptation|InspectedSource|ResearchSelection|ResearchCLIOriginal)' -count=1
```

The model and Web data in this test are loopback fixtures. It verifies actual
runtime wiring and artifact flow, rather than real-world research quality.
No paid API request is made. The adapter currently supports Linux and macOS;
other platforms return an explicit unsupported error.
