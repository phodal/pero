# Connectors source attribution

The portable MCP driver and connector management modules were adapted from
Point, revision `b45190a3db725953128b4a8a40e95a287aa9bfd7`, by Phodal.
Upstream: https://github.com/phodal/point

The driver is compiled from `use/connectors/worker`, separately from the Pero
workspace. Its frozen dependency graph is in Cargo.lock and Cargo.toml. No Point XPC binary, Keychain identity or runtime is required.
The management/catalog and helper sources live in `packages/connectors`.
Internal `point.*` protocol IDs and `POINT_FEISHU_*`/`POINT_SCIENCE_*` bindings
are preserved for configuration compatibility; they do not call a Point Host.

Catalog entries describe third-party products. Their names are their owners'
trademarks, and inclusion does not imply provider approval or live validation.
