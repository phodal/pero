# Recorded notebook reuse in MyST projects

Related: [capability matrix](myst-capabilities.md),
[IPYNB interchange](ipynb-interchange.md), GitHub #195 / #201.

## Supported local contract

The SDK compiles only the files already supplied in a MyST project snapshot.
An admitted nbformat 4 code cell can expose a target using a nonempty string
`metadata.label` or `metadata.name` (at most 256 characters). Conflicting values
are diagnosed and do not create a target. Notebook cell IDs remain original
source identity, not implicit publication labels.

A Markdown page or visible notebook Markdown cell can reference the target as
`{ref}` / `{numref}` with `run.ipynb#result`, or reuse it with:

````md
```{embed} run.ipynb#result
:remove-input:
```
````

Image-form embeds use the same existing local target resolver. Bare labels must
be unique across supplied pages and visible notebook cells; a path disambiguates
between files, but duplicate labels within that file remain ambiguous. Existing
resource resolution rejects remote URLs and path traversal. Includes do not
flatten notebook JSON, and Markdown `code-cell` directives are not executed.

## Projection and visibility

- `parseIpynb` remains the original-source/admission owner. Its frozen cell data
  feeds one reusable recorded-code publication projection. There is no kernel,
  plugin execution, resource discovery or network lookup.
- Input is inert literal text. Recorded outputs select an admitted PNG/JPEG,
  bounded LaTeX, or plain text; streams and recorded errors remain literal text.
  Unsupported MIME bundles, including HTML, JavaScript, SVG and widgets, remain
  in the original notebook and produce diagnostics rather than active content.
- The preview uses at most 128 outputs per cell and 65,536 characters per literal.
  LaTeX uses at most 16,384 characters before falling back to bounded literal
  text. Existing notebook source, embed expansion, and publication image budgets
  still apply. All omitted values remain in original source.
- Static `hide`/`remove` cell/input/output tags and `remove-stdout` / `remove-stderr`
  use the existing IPYNB visibility owner. Embed `remove-input` and
  `remove-output` can further reduce visibility, but cannot restore hidden
  source content. Fully hidden cells do not supply reference/embed targets.
- Stale outputs remain explicitly marked as stale. Other outputs state that
  execution and freshness are unverified. Reuse never upgrades recorded evidence
  into verified computation.
- Code targets share the notebook numbering state. Copies preserve source
  numbers, source path, cell index, recorded execution count and stale status;
  copied target IDs are stripped. This creates no duplicate reference anchors.

Project HTML renders code-cell targets with their actual cell namespace.
Scientific publication uses the same recorded AST. Admitted embedded raster
images pass through the existing publication image budget, and DOCX and
LaTeX/Typst/JATS archives package them without loading external resources.
Number labels survive removal of copied target identities.

## Recovery and verification

Project snapshot export remains byte-for-byte unchanged by compilation. A
notebook entry's scientific archive recovers the exact original `notebook.ipynb`;
a Markdown entry recovers its exact source document. Recovering all project
resources, including embedded notebooks, requires the original project snapshot,
not the entry-only scientific archive.

`packages/notebook/test/myst-recorded-embeds.test.ts` covers source numbering and
provenance, scoped destinations, hidden parts and streams, ambiguity, remote
rejection, malicious MIME, excessive outputs and repeated embeds. It opens actual
DOCX and LaTeX/Typst/JATS ZIP artifacts to check raster placements, source numbers,
hidden input and source recovery. The combined MyST/IPYNB suite passed 124 tests
on this implementation. Targeted strict TypeScript checking passed with the
repository's ESNext/Bundler module mode and existing citation declarations.
Browser/Native visual acceptance and full upstream MyST execution parity are not
claimed by these SDK tests.
