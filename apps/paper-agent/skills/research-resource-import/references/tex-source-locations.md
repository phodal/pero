# Find TeX and figure sources

Use this when a paper question, audit, reproduction or build needs the original
TeX or figure files. Locate the requested work and `vN` before reading a similarly
named file. A title or an unversioned filename does not prove a version.

## Preferred access

When the conversation already provides `bundleId` and the approved source
`resourceId`, use the advertised `research-source-read` tool: `list`, then `read`
for the relevant member and line window. The manifest contains literal TeX
structures, filenames and hashes. No new download is needed for available files.

With authorized local file access, the bundled offline locator can recover those
IDs and the actual files without searching the whole home directory:

```sh
python /path/to/paper-agent/tools/locate-source.py --arxiv 2610.27435v1
```

Resolve `/path/to/paper-agent` from the selected skill's installation; the
[locator](../../../tools/locate-source.py) ships beside the App backend. Prefer a
known active profile over default discovery:

```sh
python /path/to/paper-agent/tools/locate-source.py --arxiv 2610.27435v1 \
  --cache /path/to/profile/app-data/paper-agent
```

The locator requires an explicit version, validates the existing source grant
and bytes, and returns all matching scopes. `members[].main` uses the same main
file rule as the TeX preview. Multiple scopes or main files remain explicit;
choose the conversation's scope instead of selecting the newest file.

It performs no download, extraction, compilation, directory creation or evidence
observation. Exit 0 means an approved available source was found; 4 means none was
available, even when local export copies exist; 2 reports invalid input or a local
read failure. A successful locator call is not a scientific source read.

## Storage locations

| Location | Meaning |
| --- | --- |
| `PERO_PAPER_DIR`, otherwise `PERO_HOME/paper` or `~/.pero/paper` | Library Save's PDF and TeX archive **copies**, generally `<id>.pdf` and `<id>-src.tar.gz`; not an extracted project or evidence ledger. |
| `PERO_APP_DATA/research-v1` | Active Paper backend's managed data. |
| `<PERO_NATIVE_DATA_DIR or PERO_DESKTOP_DATA_DIR>/app-data/paper-agent/research-v1` | Explicit Desktop profile data. |
| `~/.pero/app-data/paper-agent/research-v1` | Standard local profile. |
| `~/.pero/native-preview/app-data/paper-agent/research-v1` | Native development preview; do not confuse it with the standard profile. |

With no explicit cache or profile environment, the locator checks only the last
two known roots. `--cache` accepts either the App data root or its `research-v1`
child and may be repeated for explicitly selected profiles. `--paper-dir`
overrides the export-copy lookup without changing Library settings.

Original archives are `source-files/<archive-sha>.bin`; the member manifest is
`source-archives/<archive-sha>.json`. `members[].localPath` points to verified
`source-members/<member-sha>.bin`, even for UTF-8 TeX; `members[].path` preserves
the original project filename. Read the reported text member normally or through
the source-read tool. Do not compile an isolated hash-named member: class files,
includes and graphics belong to the whole project. Use the managed TeX preview
or an explicitly authorized build of the complete selected project.

An export copy's `matchesApprovedArchive` is true only for matching approved
archive bytes. If only an unmatched local copy remains, inspect it as supplied
local material and leave its requested-version association unconfirmed. Do not
invent a receipt, move the managed store or fetch a replacement automatically.

## Figures and answers

Follow the actual `includegraphics`, `graphicspath`, caption and label to members
in the same archive. Resolve omitted extensions only when the member list makes
the target unambiguous. TeX line numbers and figure labels are not PDF page
coordinates; macro-dependent associations remain unresolved.

`imageAvailable=true` identifies a safe raster preview. An image-capable session
can request `research-source-read` with `operation=image`, the same bundle/source
IDs and the member ID; the App MCP adapter returns image content and provenance.
`source-previews/<member-id>.png` is a derived preview, not the original figure.

PDF/EPS/SVG members may be downloaded while `imageAvailable=false`. The current
source tool lists these files but does not render them. If an authorized local
viewer/renderer is available, inspect the selected original PDF figure there and
retain its source filename/hash. Otherwise report the missing visual read; a
typeset TeX preview does not itself mean the Agent saw those figures.

To include an observed figure in an answer, use the session's actual image or
artifact attachment mechanism with its provided path/URL, caption and source
locator. Seeing an image and publishing one in a response are separate abilities.
Do not emit base64 prose or invent chat-loadable URLs from App-private `/api`
paths. If attachment delivery is unavailable, return the exact figure locator and
state that inline display is unavailable. A plotted curve is not raw experiment
data and does not establish a successful reproduction.
