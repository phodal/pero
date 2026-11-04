---
kind: incident
status: resolved
---

# Native search cannot continue beyond its traversal bounds

Glob/Grep traverse at most 512 entries and Workspace.List exposes only the first
256 entries of each directory. Result offsets page the already visited matches,
so callers cannot reach later files. Ignored dependencies also consume traversal
and byte budgets because the native walker does not load .gitignore rules.

Reuse descriptor-rooted directory and text authority. Add bounded live directory
pages and a query-bound continuation cursor that retains traversal position and
within-file result position. Apply root and nested ignore rules before descending
into directories. Explicit file reads remain available; a changed query or
mutated directory should restart the live scan.

Verification passes for 600 files in one directory, traversal-only pages with
zero matches, a single file with more than one page of matches, nested negations,
ignored dependencies, cancellation, bad cursors and existing path restrictions. Search uses live directory pages,
not a snapshot; callers restart after directory mutations. Nested ignore rules
are tested, without claiming complete Git ignore compatibility.
