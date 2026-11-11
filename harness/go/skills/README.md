# Explicit read-only skills

Opt in to one or more roots in the headless CLI:

```text
pero-agent-acp ... --skills-root /approved/skills --skills-root /another/skills
```

No flag means no discovery and no `skill` tool. Neither `DSH_HOME`, home,
project cwd, ACP session cwd nor tool arguments select additional roots.
The exact supported layout is `<root>/<kebab-case-name>/SKILL.md`, one
level only. Root symlinks are rejected; child symlink directories are skipped,
and symlink skill files/parents are rejected. Other files, nested collections,
resources and scripts are never read or executed by this module.

```markdown
---
name: example
description: When to use these instructions
---
Task-specific instructions here.
```

The `skill` tool accepts `{}` to list launch-time names, descriptions and
SHA-256 digests, then `{"name":"example","digest":"sha256:..."}` to read
that selected body. Name-only and guessed-digest calls are rejected with guidance
to list through this same tool, not MCP resources. A changed file still requires
restarting with a newly authorized catalog; listing does not refresh its digest.
Its tool description advertises only names/descriptions from
that same explicit catalog, so an Agent can recognize relevant workflows before
listing. It does not advertise bodies, digests, paths or model-disabled entries;
the existing catalog limits and fixed-snapshot rules still apply.
It has no path/root/write/execute arguments. Instructions
are untrusted task guidance, **not permission grants**; any separately installed
tool retains its own authority/approval policy. No tool is invoked automatically.
`disable-model-invocation: true` keeps a skill unavailable to both this tool and
explicit user invocation (unlike DSH's user-only skills). Other
frontmatter fields are inert; no templates, objects, imports or YAML tags are
executed.

Direct user input can contain `/example` as a whole whitespace-bounded token
anywhere in a text block. The current claimed step batch loads each known enabled
skill once through the same digest-checked read, before its first model request;
no model tool roundtrip is needed. Loaded instructions carry a distinct
`skill-invocation` source, name and launch-time digest. Unknown names, paths such
as `/example/file`, fractions, and plugin/tool/external-sourced messages remain
ordinary text. Masking or shadowing the mounted skill tool also disables this
injection. Existing history is never scanned for gestures on later steps or
JSONL restoration. Repeating a gesture in a new user request is a new explicit
load; loaded bodies are not automatically restored after compaction.

Limits per catalog: 8 explicit roots, 512 direct directory entries total,
64 skills (including model-disabled ones), 64 KiB per SKILL.md, 64-byte names,
1024-byte descriptions. Oversized, binary/NUL or invalid UTF-8 content and
malformed frontmatter fail startup rather than being truncated or replaced.
Duplicate roots or names fail, with no precedence or silent overwrite.

The catalog is deliberately fixed at startup, not a live filesystem index.
Listing returns that snapshot; newly added skills are not discovered. A read
requires its exact catalog digest, rechecks the pinned root/parent and file
content, and fails if unavailable or changed. Restart with explicit roots to
accept a changed selection. Removing/replacing a file with identical bytes
retains the same content identity; no inode identity is claimed for the file.
Root/parent directory replacement fails even if bytes match. Discovery/content
reads are bounded but do not claim to be an atomic filesystem-wide snapshot.

Library composition: `skills.Mount(ctx, h, roots)` uses the existing Harness
registration and generation pipeline. Dispose/drain the Harness before closing
the returned catalog. An empty roots slice is a no-op. The implementation
reuses the existing descriptor-rooted `fstools` reader, currently supported on
Linux and macOS; it does not add another sandbox, agent, registry or scheduler.
See `SOURCE.json` for the precise adapted-versus-new boundary.

## Bounded catalog presentation

Native composition can opt into `MountOptions{SummaryBudget: SummaryBudget{
AdvertisementBytes: 8192, PageBytes: 8192}}`. Setting either budget applies byte
ceilings to the existing presentation for both native `skill` and plugin
`Skill`; an omitted field uses 8192 bytes. Each budget must be between 1024 and
65536 bytes. The all-zero value retains the existing defaults: listings are
bounded to 16 KiB, and advertisements participate in the shared catalog budget.
An advertisement ceiling also participates in that shared budget; it never
allocates additional space outside the total.

Small `{}` listings retain their array response. Larger or explicitly paged
listings return `{"items":[...],"offset":0,"total":512,"next_offset":5}`.
Continue with `{"offset":5,"limit":5}`; `next_offset` is omitted at the end.
The same offset/limit protocol is used with or without the engineering profile.
The catalog remains the sole authorization and digest-check owner.

Display descriptions, hints and path patterns may be shortened or omitted to
fit the byte budget, with valid UTF-8 retained. Names and read digests are never
shortened. A row with `metadata_truncated: true` can be recovered completely with
`{"summary":"exact_name","offset":0}`. Concatenate the returned `text` fields
using their `next_offset` byte positions to recover the complete summary JSON;
summary reads never activate a workflow. Every model-visible name remains
discoverable, including the selected-plugin path's maximum 512 selections
(the legacy roots path retains its separate 64-skill limit). Loaded instruction
bodies and selected resources retain their existing read limits.

Native callers still copy an exact name and digest from discovery before
reading. Claude-profile callers that already know the exact authorized
qualified name may invoke it directly; another list call is unnecessary.
User-only workflows remain absent from model discovery and invocation.

## Behavioral comparison

Approved model-invocable summaries also enter durable user-role `skill-catalog`
messages. Exact visible registration controls publication; masked, shadowed or
undiscovered deferred tools advertise no call guidance. A previously published
catalog is withdrawn with an empty replacement when unavailable. Pending Skill
restrictions use the same existing denial rule before the first request.

Unchanged visible catalogs are not repeated. Existing Session surface identity
owns deduplication after cancellation/JSONL resume and restoration after compaction.
PostCompact also covers overflow retries that do not rerun PreStep. This does not
activate a skill, reload a body or renew grants. Existing Claude-profile body
reattachment remains separate; legacy roots still do not restore loaded bodies.

Catalog messages use the explicit advertisement byte ceiling, or 8192 bytes by
default, in addition to the existing tool schema budget. Names and normalized
500-byte descriptions are the only published entry fields. Source metadata records
exactly the displayed rows and the total selected count. Omitted summaries use the
existing pager, including when a small ceiling cannot fit one complete row.
An old session without catalog messages gains one on continuation; no new storage
format or additional discovery roots are required.

See the [pinned behavior audit](../../../docs/fitness/harness-behavior-parity.md)
for same-input official-hook evidence, deliberate authority differences and
unverified complete-runtime/live-provider boundaries.
