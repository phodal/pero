---
kind: analysis
date: 2026-10-30
---

# Cua adapter after native package isolation

The three initial boundary problems are addressed by the independent Computer
Use workspace: Pero-owned core values, a runtime-consumer driver port, three
native libraries, an executable composition root and a shared testkit. The
public contract and action admission remain in TypeSpec and `pero-contracts`.
Point snapshots are private to macOS/Windows adapters. The runtime's associated
snapshot type allows another implementation to retain its own native basis.

The source-only Linux build deletes Point and both Point-consuming platform
packages. It adjusts only the root composition dependencies, prunes the
temporary lock graph while checking registry versions against the original
pins, then runs locked tests/build and real Xvfb/Tk effects. Neither the Linux
library nor its core/runtime dependencies need source edits for that removal.

## Candidate Cua boundary

Source inspection uses Cua `cbe3991f268c7e155bd028fbc9b449b40146cfe9`. This is
an integration assessment, not a completed Cua backend or compositor trial.

| Concern | Source observation | Consequence for a Pero adapter |
| --- | --- | --- |
| Embedded runtime | SDK `CuaDriver::create_configured` and host-integration constructors create the same-process runtime | A future adapter can live inside the existing native child; it needs no second MCP server or daemon |
| Shared execution | SDK typed session methods and `call_tool` use the same runtime; `runtime.rs::build_registry` chooses platform registration | Use SDK entry points and translate at the adapter boundary; retain Pero's NDJSON and public contract |
| Native basis | SDK owns sessions and snapshot lifecycle | Keep the SDK basis in `DesktopDriver::Snapshot`; map windows and controls to Pero references and reobserve after each attempt |
| Authority | Configured constructors accept an immutable ceiling and optional host authorization/activity callbacks | Preserve Pero Host/selected-session authority; residual SDK callbacks require a real host decision, not automatic acceptance |
| Results | SDK reports action results and separate verification data | Map dispatch/known refusal/uncertainty explicitly; keep Pero's durable intent and receipt owner |
| Linux dependencies | `platform-linux` includes AT-SPI/zbus, X11 and Wayland/portal-related dependencies | Add a separate backend package and explicit system build prerequisites; keep them out of core/runtime |
| Static Linux | SDK's platform dependency and registry registration exclude `target_env = "musl"` | The current pinned SDK cannot provide desktop Linux through Pero's existing static-musl lane; desktop integration needs a GNU build lane |

The relevant source is the SDK
[manifest](https://github.com/trycua/cua/blob/cbe3991f268c7e155bd028fbc9b449b40146cfe9/libs/cua-driver/rust/crates/cua-driver-sdk/Cargo.toml),
[constructors and session API](https://github.com/trycua/cua/blob/cbe3991f268c7e155bd028fbc9b449b40146cfe9/libs/cua-driver/rust/crates/cua-driver-sdk/src/lib.rs),
[platform registration](https://github.com/trycua/cua/blob/cbe3991f268c7e155bd028fbc9b449b40146cfe9/libs/cua-driver/rust/crates/cua-driver-sdk/src/runtime.rs),
and [Linux dependencies](https://github.com/trycua/cua/blob/cbe3991f268c7e155bd028fbc9b449b40146cfe9/libs/cua-driver/rust/crates/platform-linux/Cargo.toml).

## Coverage to validate next

The current admission catalogue contains 18 action/delivery/addressing cases,
driven against each actual platform profile. Native Linux acceptance separately
checks callbacks, actual dragged-object position, focused text input, final pointer position, background refusal,
stale observations and unmapped text. A no-DISPLAY probe uses declared Wayland
metadata to verify refusal; it does not start or certify a Wayland compositor.

A Cua prototype should begin with GNU Linux AT-SPI observation and an owned
accessible application, followed by a specific Wayland compositor/portal
session. Each lane must prove observed identity, screenshot geometry, actual
application effects, focus/pointer behavior, expected refusals and stop/restart
invalidation. A Windows interactive-desktop lane is also required before
claiming live UIA/input coverage. CI compilation and pure admission tests do
not provide those GUI results.

Native Wayland, AT-SPI and Cua SDK integration remain unimplemented here. Lume,
Spaces and sandbox lifecycle belong to Pero's environment/execution boundary,
not this driver port. No dependency on those services was added.
