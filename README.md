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

### First experience: read a paper and check an answer (Electron)

*The four illustrations below simplify captured Paper screens and source-checked report controls; they are not screenshots. Some illustrated navigation is newer than the November 4 package; the numbered steps below use that release’s controls.*

Start with **Papers** in the **Electron workbench** sidebar. Bring a public, text-based PDF you want to understand. Importing, reading and highlighting a local PDF do not need a model account or API key. Asking AI is a separate, explicit step.

1. Open **Papers**. If **Prepare environment** appears, select it and wait for **Environment ready**. A fresh profile may download uv, CPython 3.12 and the pinned PDF packages into the managed Python environment. Native has a separate [fresh-profile limitation](DEVELOPMENT.md#native-fresh-profile-limitation).
2. Select **Add papers → PDF → Import PDF** and choose the file, or drop it into the App. The saved original opens for reading. Use a PDF with selectable text for this first pass; do not assume scanned pages have searchable text.

![Add a paper: library entry and PDF import](docs/assets/openpero-paper-research-01-add.svg)

3. Read the paper, select a passage and choose **Highlight** to keep a source annotation. You can stop here without configuring a model.

![Read the original with the Paper reader controls](docs/assets/openpero-paper-research-02-read.svg)

4. To ask about it, choose **Ask AI**, or select a passage and choose **Discuss selection**. This opens the shared conversation with paper context; it does not send a question for you. Before sending, configure an Agent: the built-in Agent needs an API provider and key in **Settings → Built-in Agent**; external Agents use their own login. Full-PDF research needs an Agent with HTTP MCP support. See [Agent setup](desktop/README.md#agents-and-conversations).

![Ask with context in the shared conversation](docs/assets/openpero-paper-research-03-ask.svg)

5. Send a focused question, such as **“What evidence supports this method, and which limitations should I check in the paper? Cite the original passages.”** When a report is saved, choose **Close chat**, open **Research record** (the clock icon in the reader toolbar), then the saved question/report. Open a citation to inspect the original PDF passage. If **Citation evidence** offers several matches, choose the relevant location rather than assuming one.
6. Use **Continue from here** on a saved report, then send your follow-up question. Keep unanswered questions and evidence gaps visible; a citation locates a source, not a verified scientific conclusion.

![Review a saved report and follow its citations](docs/assets/openpero-paper-research-04-review.svg)

Once dependencies are prepared, local reading needs no model call. AI questions may send paper content to your selected provider and incur its charges. You do not need the optional control-plane service. For offline environment preparation and saved Python bindings, see [Python setup](DEVELOPMENT.md#python-environments-and-advanced-overrides).

The numbered steps above use controls present in the November 4 source tag and current source. The [recorded Paper journey](docs/fitness/paper-harness-journey.md) separates development-Desktop checks with a fixture Agent from historical real-Agent checks. This README update does not claim a fresh installed-package or real-model acceptance run. See [Paper usage and boundaries](apps/paper-agent/README.md#pdf-reading) for details; newer research workflows below are not promised in the November 4 package.

### Try the latest source

Complete the [development setup](DEVELOPMENT.md#desktop-from-source), including the pinned GPUI Kit, then run from the repository root:

```sh
npm run dev:paper  # Paper in a separate development profile
```

Opening Paper does not start research. For a separate domain example, `npm run dev:apps` opens Virtual Cell in its own development profile.

### Also try: inspect a dataset without a model

Data is a complementary tool for checking research inputs. Open **Data** in Electron and prepare its Python environment if prompted. No model account or API key is needed.

<details>
<summary>Import six synthetic records, chart the counts and save a view</summary>

1. Save [first-dataset.json](docs/examples/first-dataset.json) to your machine. It contains **six synthetic demonstration records**, not experimental measurements.
2. Select **Add data**, choose the file, review the import metadata and select **Import**.
3. Select the dataset. Inspect **Fields** and **Checks**: expect 6 records and no missing fields, nulls, empty strings or duplicate rows.
4. Open **Chart**, leave **Data** on **Current aggregation**, set **Group by** to `condition`, **Measure** to `signal`, and **Aggregate** to **Count**. The two groups should each contain 3 records.
5. Return to **Table**, enter a view name and select **Save view**. Open it again from **History → Saved views**; **Export reference** saves the dataset/version reference and check report, not the original file or a runnable experiment.

For offline preparation, an existing Python environment or advanced overrides, read [Python environment setup](DEVELOPMENT.md#python-environments-and-advanced-overrides). `PERO_APP_PYTHON` is not a general override of saved App environment bindings.

These steps use controls present in the November 4 source tag. The expected counts come from the sample, not a claim that every downloaded package was click-tested for this README. [Data usage and limits](apps/data/README.md) and [verification records](docs/fitness/data-workspace.md) distinguish source checks from Desktop acceptance. CSV numeric interpretation in current source is newer than that package; this example deliberately uses JSON.

</details>

## A research example

**Can one published number be independently recomputed from its original inputs?** The current Fisher (1936) case follows Table III's within-species sum of squares:

1. Bind the original PDF region and 100 reviewed Table I measurements from two species.
2. Freeze the formula, units, inputs and comparison rule before the arithmetic run.
3. Compute the result, then check it in a separate process using exact rational arithmetic.
4. Save a result annotation and export an evidence ZIP that can be checked with `python -I -S verify.py` after extraction.

The [recorded run](docs/fitness/paper-fisher-reproduction.md) obtained **19.1434 cm²**, matching the selected published value. The independent numerical check uses only Python's standard library, without model calls or network access. This is a curated, single-result reanalysis; the whole-paper verdict remains `NOT_ASSESSED`.

The current App route has backend/API, export and restart checks. Browser interaction, Native/Electron integration and installed-package acceptance for this increment remain unverified. Follow the [fixed-case instructions](apps/paper-agent/skills/paper-reproduction/references/reproduction-protocol.md#fixed-real-source-reanalysis-fisher-table-iii) to inspect or rerun it. It is not a general “reproduce any paper” workflow.

For an interactive domain example, [Virtual Cell](apps/virtual-cell/README.md) includes a PBMC3k reference atlas and local first-order reaction simulation. Its reaction and volume examples are illustrative, not fitted biological models or accepted scientific results.

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

![Target research workflow: question, task, execution, review and project memory](docs/assets/openpero-overview.svg)

*Target workflow, not a claim that the complete cross-person research loop is implemented.*

![Proposed research roadmap: verify published results, compare experiments, then sustain research across people and environments](docs/assets/openpero-research-roadmap.svg)

Apps own domain methods and data. Host owns local processes, credentials and Agent sessions. The optional Go control plane coordinates shared tasks and Workers. Local App calculations do not require running that control-plane service.

### Architecture and composition diagrams

These are architecture illustrations, not product screenshots. Solid boxes mark implemented foundations; dashed boxes and links mark planned capabilities or integration. They do not certify an end-to-end workflow.

![Research Apps, agent capabilities and delivery options](docs/assets/openpero-building-blocks.svg)

![Pero architecture: clients, coordination, Host execution, environments and delivery](docs/assets/openpero-architecture.svg)

Read the [architecture](docs/ARCHITECTURE.md), [decisions](docs/adr/README.md) and [development guide](DEVELOPMENT.md) for ownership and implementation details.

## Contribute

Bring a concrete research question, a small public dataset with provenance, a method/App, or an independent result review. For substantial changes, open an [Issue](https://github.com/phodal/pero/issues) first and agree on scope and acceptance criteria. Include reproducible checks and report what remains unverified. AI-assisted contributions follow the same review process. See [CONTRIBUTING](CONTRIBUTING.md) and join the [community](https://github.com/openpero/community).

**License status:** this repository does not currently contain a top-level project license. Do not assume a blanket open-source reuse grant. Bundled third-party components retain their own notices and licenses; ask the maintainers to clarify project-level reuse and distribution terms.

<p align="center">
  <a href="https://github.com/openpero/community">
    <img src="docs/assets/wechat-group.jpg" width="240" alt="WeChat group: Pero - 瞎摸 AI4S">
  </a>
</p>
