<p align="center">
  <img src="docs/assets/openpero-mark.svg" width="72" alt="Pero logo">
</p>

<h1 align="center">Pero</h1>

<p align="center">
  <b>Read papers, run research Apps, and inspect the evidence behind a result.</b>
</p>

<p align="center">
  <a href="#try-pero">Try Pero</a> ·
  <a href="#a-research-example">Research example</a> ·
  <a href="#status">Status</a> ·
  <a href="DEVELOPMENT.md">Development</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

Pero is a desktop research workbench for researchers and scientific software builders. Bring source papers, domain Apps and Agent conversations into one workspace, then review saved results and the sources behind them.

- **Read with evidence.** Paper saves original PDFs, supports questions over selected sources, and links cited reports back to observed passages.
- **Inspect data and explore a method.** Data checks and charts selected dataset versions without a model. Virtual Cell provides a cell atlas, local reaction simulation and bounded perturbation comparisons. Domain Apps own their inputs and results.
- **Keep work connected.** Local research projects link goals to App records; Agent sessions retain tool activity and versioned deliveries.

> [!NOTE]
> **Development preview, not a stable release.** The capability descriptions below follow current source. Downloaded packages are versioned snapshots and may not include newer features. Successful execution or a matching number does not establish a scientific conclusion.

## Try Pero

### Download a development build

This walkthrough uses the published [2026-11-04 prerelease](https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261104), which provides the assets below. Check [Releases](https://github.com/phodal/pero/releases) for newer published packages; a Git tag alone does not establish package availability.

| Product | Platform | Asset |
| --- | --- | --- |
| Pero, Electron workbench | macOS Apple Silicon | `Pero-macos-arm64.dmg` |
| Pero, Electron workbench | Windows x64 | `Pero-windows-x64.zip` |
| Pero, Electron workbench | Linux x64 | `Pero-linux-x64.tar.gz` |
| Pero Native, GPUI workbench | macOS Apple Silicon | `Pero-Native-macos-arm64.dmg` |

Choose the asset for your system and read that release's notes. Archives have accompanying build metadata and SHA256SUMS. macOS packages are ad-hoc signed and not notarized; Windows/Linux packages are unsigned development builds. Electron and Native use separate profiles. This release does not include a standalone Virtual Cell package. See [release verification](docs/fitness/release-products.md) for dated package checks and their limits.

### First experience: inspect and save a dataset (Electron)

Use the **Electron workbench** for this no-model walkthrough, with **Data** in its sidebar. Native has a [fresh-profile environment limitation](DEVELOPMENT.md#native-fresh-profile-limitation). No API key or control-plane service is needed for local inspection. A fresh November 4 Electron workbench profile uses a managed Python environment; installing system Python alone does not make that environment ready.

1. Save [first-dataset.json](docs/examples/first-dataset.json) to your machine. It contains **six synthetic demonstration records**, not experimental measurements.
2. Open **Data**. If **Prepare environment** appears, select it and wait for **Environment ready**. First-time preparation may download uv and CPython 3.12; it creates an isolated environment under `~/.pero/environment/pero-python312`.
3. Select **Add data**, choose the file, review the import metadata and select **Import**.
4. Select the dataset. Inspect **Fields** and **Checks**: expect 6 records and no missing fields, nulls, empty strings or duplicate rows.
5. Open **Chart**, leave **Data** on **Current aggregation**, set **Group by** to `condition`, **Measure** to `signal`, and **Aggregate** to **Count**. The two groups should each contain 3 records.
6. Return to **Table**, enter a view name and select **Save view**. Open it again from **History → Saved views**; **Export reference** saves the dataset/version reference and check report, not the original file or a runnable experiment.

For offline preparation, an existing Python environment or advanced overrides, read [Python environment setup](DEVELOPMENT.md#python-environments-and-advanced-overrides). `PERO_APP_PYTHON` is not a general override of saved App environment bindings.

These steps use controls present in the November 4 source tag. The expected counts come from the sample, not a claim that every downloaded package was click-tested for this README. [Data usage and limits](apps/data/README.md) and [verification records](docs/fitness/data-workspace.md) distinguish source checks from Desktop acceptance. CSV numeric interpretation in current source is newer than that package; this example deliberately uses JSON.

### Try the latest source

Complete the [development setup](DEVELOPMENT.md#desktop-from-source), including the pinned GPUI Kit, before running either command from the repository root:

```sh
npm run dev:apps    # Virtual Cell in a separate development profile
# Or:
npm run dev:paper   # Paper in a separate development profile
```

For a paper question, open **Add papers** in Paper, import a public PDF, then use **Ask**. Configure and authenticate an Agent before submitting. Full-text questions support 1–5 selected papers and require an Agent with HTTP MCP support; see [Paper setup and usage](apps/paper-agent/README.md). Opening Paper does not start research. Newer Paper workflows described below require current source, not the November 4 package.

## A research example

For an interactive domain example, [Virtual Cell](apps/virtual-cell/README.md) includes a PBMC3k reference atlas and local first-order reaction simulation. Its reaction and volume examples are illustrative, not fitted biological models or accepted scientific results.

**Can one published number be independently recomputed from its original inputs?** The current Fisher (1936) case follows Table III's within-species sum of squares:

1. Bind the original PDF region and 100 reviewed Table I measurements from two species.
2. Freeze the formula, units, inputs and comparison rule before the arithmetic run.
3. Compute the result, then check it in a separate process using exact rational arithmetic.
4. Save a result annotation and export an evidence ZIP that can be checked with `python -I -S verify.py` after extraction.

The [recorded run](docs/fitness/paper-fisher-reproduction.md) obtained **19.1434 cm²**, matching the selected published value. The independent numerical check uses only Python's standard library, without model calls or network access. This is a curated, single-result reanalysis; the whole-paper verdict remains `NOT_ASSESSED`.

The current App route has backend/API, export and restart checks. Browser interaction, Native/Electron integration and installed-package acceptance for this increment remain unverified. Follow the [fixed-case instructions](apps/paper-agent/skills/paper-reproduction/references/reproduction-protocol.md#fixed-real-source-reanalysis-fisher-table-iii) to inspect or rerun it. It is not a general “reproduce any paper” workflow.

## Status

Implementation, runtime acceptance and scientific review are recorded separately in [quality gates](docs/fitness/README.md).

| Area | Available foundations | Remaining boundary |
| --- | --- | --- |
| Papers and research | Saved sources, cited reports, explicit continuation; bounded autonomous-research plans and exports | Autonomous research has controlled-stack checks; real-model and independent human quality acceptance remain pending. [Evidence](docs/fitness/paper-autonomous-research.md) |
| Apps and projects | Local Apps, scoped Agent tools, research goals and links to App records | General App integration with shared Task/Run, shared project memory and team sync remain planned. [Projects](docs/fitness/research-projects.md) · [App Use](docs/fitness/app-use.md) |
| Agents and delivery | ACP sessions, approval UI, history, local plugins, session-scoped MCP and versioned artifacts | Provider/platform coverage varies; an artifact version is not independent scientific verification. [Artifacts](docs/fitness/session-artifacts.md) · [Connectors](docs/fitness/connectors.md) |
| Tasks and compute | Task dispatch, Worker leases/cancellation/recovery; scoped local, Docker, Compose and Slurm owner evidence | Production scientific App admission and broader platform acceptance remain open. [Environments](docs/fitness/ai4s-environments.md) |
| Clients and collaboration | Desktop development packages and separate Web previews | Shared Web/mobile research clients and the complete cross-person research workflow remain planned. [Roadmap](ROADMAP.md) |

## Data, permissions and costs

- **Local storage has a boundary.** Apps keep domain data on the execution machine; projects link to those records. Using a remote model, literature service, MCP connector or shared task service can send selected prompts, source content or task data to that service. Local storage does not make every workflow offline.
- **Use trusted Apps and tools.** App backends and local plugins run trusted code; they are not a general-purpose process sandbox. Agent actions follow the selected session's permission policy. Review the workspace, tools and policy before running work on sensitive data.
- **Bring your own model access.** The built-in Agent needs a configured API provider; external Agents use their own authentication. Provider subscriptions/API calls and any remote compute are billed separately by those providers. Only reported usage is shown; missing usage is not zero cost. Research call/time limits are not a billing cap. See [Agent setup](desktop/README.md#agents-and-conversations).
- **Review conclusions yourself.** Source traceability, execution success, numerical checks and scientific acceptance are different claims. Keep unresolved evidence gaps visible.

## Direction and architecture

The proposed progression is to verify a published result, compare experiments, then sustain research across people and environments. Each stage needs its own acceptance evidence. The [Roadmap](ROADMAP.md) separates implemented foundations from open work.

![Proposed research roadmap: verify published results, compare experiments, then sustain research across people and environments](docs/assets/openpero-research-roadmap.svg)

Apps own domain methods and data. Host owns local processes, credentials and Agent sessions. The optional Go control plane coordinates shared tasks and Workers. Local App calculations do not require running that control-plane service.

<details>
<summary>Architecture and composition diagrams</summary>

These are architecture illustrations, not product screenshots. Solid boxes mark implemented foundations; dashed boxes and links mark planned capabilities or integration. They do not certify an end-to-end workflow.

![Research Apps, agent capabilities and delivery options](docs/assets/openpero-building-blocks.svg)

![Pero architecture: clients, coordination, Host execution, environments and delivery](docs/assets/openpero-architecture.svg)

Read the [architecture](docs/ARCHITECTURE.md), [decisions](docs/adr/README.md) and [development guide](DEVELOPMENT.md) for ownership and implementation details.

</details>

## Contribute

Bring a concrete research question, a small public dataset with provenance, a method/App, or an independent result review. For substantial changes, open an [Issue](https://github.com/phodal/pero/issues) first and agree on scope and acceptance criteria. Include reproducible checks and report what remains unverified. AI-assisted contributions follow the same review process. See [CONTRIBUTING](CONTRIBUTING.md) and join the [community](https://github.com/openpero/community).

**License status:** this repository does not currently contain a top-level project license. Do not assume a blanket open-source reuse grant. Bundled third-party components retain their own notices and licenses; ask the maintainers to clarify project-level reuse and distribution terms.

<p align="center">
  <a href="https://github.com/openpero/community">
    <img src="docs/assets/wechat-group.jpg" width="240" alt="WeChat group: Pero - 瞎摸 AI4S">
  </a>
</p>
