# Explicit MyST project resources

The shared notebook SDK compiles only resources admitted in a project snapshot. No filesystem discovery, remote fetch, plugin loading, kernel execution, or implicit resource import occurs. Projection changes do not rewrite saved source. The editor, clipboard, snapshots, revisions, and publication renderer use the same domain boundary.

## Wire compatibility and assets

Version 1 remains the exact text-only envelope: `format`, `version`, `entry`, `files`. Version 2 requires an additional `assets` array containing only `path`, `mediaType`, and canonical `base64`. Explicit empty v2 assets remain v2; old v1 remains v1. Unknown versions and envelopes retain the established opaque recovery behavior. Paths are canonical root-relative, case-sensitive, unique across text and binary resources. Relative references may normalize within the root; URI, absolute, escaping, encoded, template, and glob paths are rejected.

Limits remain 32 combined resources, 256 KiB per text resource or decoded asset, 1 MiB total text, and 1536 KiB for the JSON-escaped snapshot scalar. The global Notebook document limit remains 2 MiB. Python and TypeScript share admission fixtures, including exact persistence/reopen tests.

PNG and JPEG require matching MIME, canonical base64, bounded structural markers, dimensions at most 4096 per axis, and at most 16 million pixels. This is structural admission, not complete PNG CRC or JPEG entropy decoding. Only admitted PNG/JPEG become data-URI images; SVG and other formats remain byte-exact resources with explicit unsupported diagnostics and inert downloads. Authored data URLs and remote image URLs do not bypass admission. HTML uses a restrictive CSP, escaped authored HTML, and no script execution.

## Includes and provenance

`include` and `literalinclude` resolve explicit text relative to the containing resource, including nested includes. Expanded nodes retain physical path, selected original line numbers, and include stack. Limits per compiled page/cell are depth 12, 128 expansions, and 1 MiB repeated expanded text. Cycles, missing resources, filters, unsupported options, and budget failures retain their directive source and diagnostics.

Supported filters are whole-line start/end markers, zero-based `start-line`/`end-line` (negative indices allowed), and one-based `lines` ranges. The pinned upstream implementation uses inclusive `end-line`, despite its option description. Contradictory or mixed marker/line selection is rejected. Literal language/code options are supported; parsed notebook/TeX includes, execution, and included macro/abbreviation inheritance are not implemented and are explicit diagnostics.

## References and one-file publication

Labels, explicit `path#label`, document links, fragment references, and shorthand `@label` resolve deterministically across provided Markdown pages and notebook Markdown cells. Existing bibliography keys take precedence over shorthand labels; explicit citation roles stay citations. Ambiguity never picks an arbitrary target. Anchors use an injective safe namespace per page/cell. Removed or hidden notebook cells do not contribute publication targets.

Project HTML contains navigation and every compiled Markdown/notebook page, rather than links into absent exported files. Invalid notebook sources remain escaped recoverable pages. Figure/equation numbering and every upstream cross-reference presentation mode are not claimed.

## Notebook context

The entry is a discriminated Markdown/notebook/invalid union. Notebook source, cell order, metadata, recorded outputs, and bytes remain authoritative. Only literal cell zero may provide first-cell frontmatter. Official direct notebook metadata is inherited between first-cell metadata and project defaults. Later cell YAML remains content. Notebook, first-cell, and project bibliography resources combine with physical-path deduplication; each Markdown cell carries full CSL records. One notebook header is rendered, and cells share project references and bibliography context. Nonstandard `metadata.myst` is retained with a diagnostic, not silently treated as official configuration.

## CSV tables

Pinned `myst-parser` 1.7.5 exposes the official `csv-table` directive, but its `:file:` option is not implemented upstream. Pero supplies an explicit-project-only file extension, using `csv-parse` 5.6.0 for bounded admission and the official directive for AST conversion. Inline bodies also pass the bounded path. File plus body conflicts are diagnosed. Supported options are header, header-rows, delim, quote, escape, keepspace, label/name, and the local file extension. Unsupported options or unsupported block/raw-HTML cell syntax retain original source.

Quoted delimiters, escaped quotes, multiline fields, header supplementation, header-row counts, and relative nested provenance are tested. Limits: 64 tables, 1000 rows/table, 64 columns, 10000 total cells, 16 KiB/cell, 64 KiB CSV record, and 1 MiB repeated CSV/header text per compiled page/cell. Header and data widths must agree. There is no external file/network fallback.

## Verification

Focused SDK tests cover includes and budgets, reference ambiguity and safe anchors, assets and signature mismatches, notebook context and static visibility, official CSV AST parity, exact snapshot source, and unsupported recovery. The shared fixture is exercised in Python with real revision persistence. Editor tests cover v2 clipboard round trips and future version 99 recovery. The browser journey covers nested includes, linked pages, recorded notebook output, CSV headers, admitted raster rendering, original-byte download, save/reopen/import/export, and screenshots. Browser syntax was checked during reconstruction; Chromium was not launched locally. Combined build/typecheck/browser CI results are tracked by the integrating change, not inferred from these focused tests.

Reference implementation: pinned myst-parser/myst-directives 1.7.5 and MyST transforms source at upstream revision `50e8220`; include behavior is documented in the selector tests, and CSV tests compare the actual installed official directive AST.
