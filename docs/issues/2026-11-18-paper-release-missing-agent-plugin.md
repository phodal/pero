---
kind: incident
status: open
date: 2026-11-18
---

# Paper cannot prepare in a fresh profile from the November 12 macOS release

The public `v0.1.0-dev.20261112` macOS arm64 Electron package launches and opens
Papers. In an isolated fresh profile, **Prepare environment** returns to
**Environment not ready**. The actual Host response reports
`Required Agent Plugin paper-autoresearch is unavailable` before it creates the
Python environment.

The downloaded `.app` passed strict deep signature verification and the DMG
matched the published SHA-256. The bundled Paper manifest declares
`requiresAgentPlugins: ["paper-autoresearch"]`. The plugin is present in the
[release source](https://github.com/phodal/pero/tree/v0.1.0-dev.20261112/apps/paper-agent/agent-plugins/paper-autoresearch).
The App payload assembly's [`APP_ENTRIES`](https://github.com/phodal/pero/blob/v0.1.0-dev.20261112/scripts/build/builtin-app-payload.mjs)
does not include `agent-plugins`, and the extracted release payload lacks the
directory. The Host checks required plugins before preparing Python, so retrying
the same clean profile reaches the same missing dependency.

For diagnosis, the bundled Host installed the unmodified same-tag plugin into
the isolated profile using its documented `apps / plugininstall` action. After
restarting the signed application, the original **Prepare environment** action
completed and opened Paper. This recovered profile does not establish that the
untouched download works from a fresh profile.

Release acceptance for a fix should prepare and open Papers in a clean profile
using the next downloadable package, with no preinstalled plugin. The package
under test and the versioned tutorial evidence are recorded in
[release verification](../fitness/release-products.md).
