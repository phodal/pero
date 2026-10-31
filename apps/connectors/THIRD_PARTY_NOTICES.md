# Source and dependency notices

The feature UI and portable connector implementation are adapted from Point,
revision `b45190a3db725953128b4a8a40e95a287aa9bfd7`, by Phodal. Source attribution
for the native driver is in `use/connectors/NOTICE.md`.

The App uses React and ReactDOM (MIT), with frozen versions in package-lock.json.
Host helper bundles use the Model Context Protocol SDK (MIT), fflate (MIT) and
PDF.js (Apache-2.0); their versions are pinned by the root and connector package
locks. No third-party provider implementation is embedded by listing it in the
catalog. The native driver's dependency versions are frozen in its Cargo.lock.
