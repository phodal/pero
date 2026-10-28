<p align="center">
  <img src="docs/assets/openpero-mark.svg" width="72" alt="OpenPero logo">
</p>

<h1 align="center">OpenPero</h1>

<p align="center">
  <b>Distributed agent collaboration.</b><br>
  Connect domain experts, open-source contributors, and computing environments for AI4S and R&amp;D.
</p>

<p align="center">
  <a href="#how-it-works">How it works</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="#contribute">Contribute</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="docs/assets/openpero-overview.svg" alt="OpenPero workflow: a question becomes a task contract, researchers, agents, or compute do the work, the run is recorded, and the reviewed result returns to the project memory" width="900">
</p>

> [!NOTE]
> **Early stage.** Desktop, task claims, and remote execution are implemented foundations. Multi-agent orchestration and complete AI4S and R&D workflows are still being built.

## Run the current implementation

- [Desktop](desktop/README.md): Electron + GPUI, ACP conversations, Chinese/English, themes, local sessions and shared remote tasks.
- [Go control plane](server/README.md): PostgreSQL Task/Run/Worker state, leases, cancellation/recovery, GitHub Issue intake, project-scoped claims and opt-in automatic dispatch.
- [Community board](server/README.md#community-tasks-and-contributions-2): public tasks, GitHub OAuth, Worker ownership, reviewed contribution points and reversals.
- [Build and verification](docs/fitness/README.md): npm/Cargo development and the Bazel Go/code-generation pilot. Fonts use local files or build caches before pinned downloads; generated binaries are ignored.

Local UI and protocol checks use provider fixtures. Deployment, real OAuth credentials and independent acceptance require their own setup and evidence. [Worktree integration record](docs/fitness/worktree-integration.md).

## Continuous integration

Pushes to `master` and pull requests run the commands in [Build and verification](docs/fitness/README.md) on Linux, Windows, and macOS: `npm ci`, `npm run build`, `npm run check`, `npm test`, `npm run test:contracts`, and `go test -race ./...` in `server/`. Bazel `//:checks` runs on Linux and macOS, and `//server/cmd/server` is built on all three. A macOS checkout is not the only environment that is checked.

PostgreSQL, Electron, live GitHub, and real-model suites stay opt-in. They need a database, a display, or a local login, so this workflow does not run them and does not read secrets.

`docs/` is the static site for openpero.com. Cargo crates set `publish = false`, and a signed Desktop package is not a current deliverable. The Task Center install is a separate host script, [deployment/task-center](deployment/task-center/README.md). It needs SSH access and credentials that stay on that machine. This workflow does not run it, deploy the site, or publish installers.

## The problem

AI4S connects literature, data, methods, and experimental results. R&D connects requirements, implementation, testing, and review. Expertise, code, and compute are often spread across people and machines.

OpenPero organizes this work around **projects and tasks**: experts define problems and acceptance criteria, contributors and agents divide the work, and reviewed artifacts return to the project.

| | A single Agent execution | OpenPero's direction |
| --- | --- | --- |
| **Context** | The current task | Project requirements, papers, data, methods, and decisions |
| **Collaboration** | People connect separate executions | Task claims, division of work, and handoffs |
| **Execution** | One environment | Approved local, lab, or cloud environments |
| **Done means** | "It ran" | Execution, verification, and human acceptance recorded separately |

## How it works

The diagram at the top is the whole loop. Step by step:

1. **Describe the work.** Start from a GitHub Issue, a business or research request, or a suggestion the project raises itself.
2. **Make it a contract.** Pin the inputs and method version, the expected outputs, resource limits, and acceptance criteria.
3. **Assign it.** A collaborator claims it, or an approved agent or worker picks it up.
4. **Run and record.** Produce code, data, methods, or reports with the information needed to inspect or repeat the run.
5. **Review and continue.** Record the decision, update the project, and report back to GitHub when useful.

## What makes it different

**🧠 The project remembers.** Requirements, questions, papers, datasets, methods, runs, and decisions stay together. Come back a month later and see where the work stopped, why a result was accepted, and what is still open.

**🔔 The agent prepares the next step.** A new dataset version, a finished run, a failed check, a relevant paper: the agent explains what changed, what it might affect, and proposes a concrete task. It works within project permissions and budgets, and it never quietly changes methods or accepted conclusions.

**🌐 Compute stays where the data is.** Tasks can run on a laptop, an approved lab server, or the cloud. The coordinator can be self-hosted, and hosting it does not mean moving your data to the cloud.

**🔍 Every result has a history.** Each result links to its inputs, method version, parameters, environment, and execution record. A successful run is not an accepted result. Acceptance is an explicit, reviewed decision.

## Architecture

![OpenPero architecture: clients, Cloud coordination, Host execution, capabilities, environments, and trusted delivery](docs/assets/openpero-architecture.svg)

Solid outlines are existing foundations; dashed ones are planned. Regenerate the diagrams with `npm run gen:architecture` and `npm run gen:overview`.

| Part | Responsibility |
| --- | --- |
| **Project** | Goals, shared context, accepted results, open questions, decisions |
| **Task** | A bounded contribution with fixed inputs, expected outputs, constraints, and acceptance criteria |
| **Coordinator** | Dependencies, authorization, assignment, execution state, cancellation, recovery |
| **Worker** | Runs approved tasks with declared capabilities and scoped access |
| **Result & review** | Keeps artifacts and provenance; separates execution success, validation, and acceptance |
| **Web / Desktop / GitHub** | Different ways into the same work |

Interface (Web, Desktop), execution location (local, lab, cloud), and deployment (self-hosted, managed) are independent choices.

<details>
<summary><b>Safety by design</b></summary>

- Issue text, pull requests, and task payloads are **untrusted input**. Submitting work is not permission to run it.
- Execution uses scoped credentials, resource limits, approved data access, and isolation that fits each task.
- Retries account for side effects; duplicate delivery must not repeat consequential actions.
- Publishing results or changing accepted conclusions follows the project's review policy.
- Never attach an unrestricted personal or lab machine to an untrusted public task stream.

</details>

## Roadmap

| | Stage | Delivery focus |
| --- | --- | --- |
| 🟢 | **M0 · Bootstrap** | Desktop, Host, ACP, and versioned contracts; macOS development builds completed |
| 🟡 | **M1 · Remote dispatch** | Local flow implemented; real remote-environment acceptance pending |
| 🟡 | **M2 · Task sources** | GitHub intake implemented; ROADMAP import pending |
| ⚪ | **M3 · Verification and publication** | Artifact versions, independent verification, human decisions, and authorized writeback |
| ⚪ | **M4 · Environments and operations** | Environment matching, isolation, self-hosted upgrades and recovery |

🟢 development builds completed · 🟡 partially implemented · ⚪ planned. See the [full roadmap](docs/ROADMAP.md) for scope and acceptance criteria.

## Contribute

You don't need to understand the whole platform to help. Pick one bounded piece:

| Area | A good first contribution |
| --- | --- |
| **Domain use cases** | Real problems, constraints, and acceptance criteria |
| **Task & result contracts** | Schemas, example payloads, validators |
| **GitHub connector** | Authenticated event intake, deduplication, task mapping, status updates |
| **Worker SDK** | Capability registration, claims, heartbeats, cancellation, result submission |
| **Coordination & recovery** | Dependencies, leases, safe retries, rejecting stale results |
| **Result validation** | Artifact checks, baseline comparisons, independent review hooks |
| **Research method packs** | Fixed inputs, environments, baselines, and explicit checks |
| **R&D workflows** | Playbooks for requirements verification, testing, and review |

These are proposed areas, not existing Issues. For anything substantial, open an Issue first to agree on scope, interfaces, and acceptance criteria, and include a way to run or test it locally. AI-assisted contributions go through the same review as any other.

**Business and domain experts welcome too.** Bring problems, constraints, and acceptance criteria, contribute scientific methods, or review results independently.

<details>
<summary>Working on the demo pages</summary>

Chinese copy lives in `pages/src`; English strings in `pages/locales/en.js`. Rebuild both pages with `node pages/scripts/build.mjs`. Colors follow [`DESIGN.md`](DESIGN.md).

</details>

---

<p align="center"><b>Start with one problem. Make the next contribution easier.</b></p>

<!-- Maintainer publication checklist: choose and add the repository LICENSE; confirm source ownership and third-party notices; replace prototype status with verified release status as implementation lands. No license, hosted service, or installation command is implied by this draft. -->
