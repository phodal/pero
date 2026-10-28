<p align="center">
  <img src="docs/assets/openpero-mark.svg" width="72" alt="Pero logo">
</p>

<h1 align="center">Pero</h1>

<p align="center">
  <b>Composable research apps and distributed agent collaboration.</b>
</p>

<p align="center">
  <a href="https://github.com/phodal/pero/releases">Download dev build</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="DEVELOPMENT.md">Development</a> ·
  <a href="#status">Status</a> ·
  <a href="#contribute">Contribute</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="docs/assets/openpero-overview.svg" alt="Research workflow: question, task, execution, review and project memory" width="900">
</p>

> [!NOTE]
> **Development preview.** macOS arm64 builds are available. There is no stable release yet.

## Why

A research workflow often starts as a script, notebook or model demo. Pero turns it into an App that can run on its own or alongside other tools in a shared workbench. Virtual Cell is the first example, with cell-atlas exploration and reaction simulation.

The longer-term goal is to connect these Apps with agents, collaborators and compute while keeping inputs, methods and results traceable.

![Research Apps, agent capabilities and delivery options; dashed elements are planned](docs/assets/openpero-building-blocks.svg)

## Status

| Capability | State | Docs |
| --- | --- | --- |
| Agent conversations, workspaces, attachments, English/Chinese and themes | Available in development builds | [Desktop guide](desktop/README.md) |
| Virtual Cell in the workbench or as a standalone App | macOS arm64 development package verified | [App guide](apps/README.md), [verification](docs/fitness/products.md) |
| Shared tasks and remote execution | Verified locally; remote-environment acceptance pending | [Verification](docs/fitness/remote-dispatch-verification.md) |
| GitHub and Roadmap task intake, claims and public contributions | Implemented; real GitHub PR publication pending acceptance | [Contribution guide](desktop/README.md#contribute-on-this-computer) |
| App-to-Agent tools, multi-agent orchestration and complete AI4S workflows | Planned | [Roadmap](ROADMAP.md) |
| Independent result verification and environment management | Planned | [Roadmap](ROADMAP.md) |

## How it works

The intended workflow is to define a task with fixed inputs and checks, assign it to a collaborator or approved worker, then review the recorded result. Compute can stay on a personal machine, a lab server or the cloud; coordination can be self-hosted.

Agents propose work; people approve consequential actions and accepted conclusions. Task intake alone grants no execution permission, and runs retain the evidence needed for review.

![Pero architecture: clients, Cloud coordination, Host execution, capabilities, environments, and trusted delivery](docs/assets/openpero-architecture.svg)

Solid outlines mark existing foundations; dashed elements are planned. See the [architecture](docs/ARCHITECTURE.md) for implementation details and [development guide](DEVELOPMENT.md) for setup, builds and tests.

## Contribute

Bring a research use case, contribute a method or App, or review results. Pick a bounded item from the [Roadmap](ROADMAP.md); for substantial changes, open an Issue to agree on scope and acceptance criteria. Include a reproducible check with code changes. AI-assisted contributions follow the same review process.
