---
kind: issue
status: resolved
date: 2026-11-06
---

# Paper and side chat duplicate control styling and toolbar space

Native screenshots show a focused library search with both an outer teal ring
and an inner input ring. Paper representation choices use ordinary buttons with
page-local pressed styles instead of the public exclusive selection component.
The dock close action and artifact toggle occupy two separate rows, and an empty
artifact collection displays a distracting zero. Composer retry uses a text
button where a named icon action fits the shared toolbar.

Migrate Paper search to SearchField and IconButton, and reading representation
choices to ToggleGroup. Preserve search Enter/IME/clear behavior, missing-PDF
acquisition, mounted PDF/TeX state and existing reader persistence. Combine dock
close with artifact navigation in the shared chat header; hide only the empty
count, retaining the artifact entry and all existing collection actions. The
Host continues to own dock visibility and preferences.

## Resolution and acceptance

Paper uses public SearchField / IconButton and single ToggleGroup; obsolete
page-local focus/pressed skins were removed. ToggleGroup shares Tabs' pointer
versus keyboard focus handling and inset outline. Reader browser consumers now
assert radio / aria-checked semantics.

The Native chat header combines artifact navigation with the dock close action;
both the entry and empty artifact pane omit the zero. Retry is a named ghost
icon. Actual macOS GPUI/WKWebView acceptance confirmed search typing and clear,
one focus boundary, exclusive reading selection, mouse selection without an
outline, arrow-key focus and Space switching to an existing PDF. The artifact
pane can be opened and the whole dock closed from the retained header; the
composer stays at the bottom after reopening.

Validation: 16 actual App browser scenarios, 7 Paper workspace tests, 10 shared
Tabs tests, 25 chat-ui and 64 pero-ui tests passed; Paper typecheck/build, root
checks, Native build and Wasm checks passed. Dark/24px acceptance is browser
fixture evidence; Native acceptance was light theme. No Agent request was sent.

PR #139 merge validation found one remaining CI reader fixture expecting PDF as
a button after the exclusive ToggleGroup migration. The fixture now follows
the PDF radio role while retaining the Back button and focus/Escape assertions.
