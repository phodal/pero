---
kind: incident
status: resolved
date: 2026-10-31
---

# Product App Use opens floating chat twice after master integration

[CI 41148634551](https://github.com/phodal/pero/actions/runs/41148634551)
tested merge `4a61dfea815cd5a932e26e38c0bed71939175c39`, combining PR head
`4502ab0dd52c4ab8cf7a80ad0a73fe2c21f5cc8c` with master
`4ab51e247fa3e63c313fe137218fe71774a6a565`. The Control Lab Desktop
fixture and isolated fake-provider budget-exhaustion acceptance passed, but
Product App Use timed out before its first tool call at a hidden chat toggle.

Both sides had independently adapted the Product test to the floating chat.
The PR test already clicked the visible toggle and expanded the panel. The
master addition clicked that toggle again while the panel was open, when the
Product shell deliberately hides it. The merge was textually conflict-free but
combined two incompatible setup sequences.

The integrated test retains the first real click, expanded panel, pre-Host
draft identity and all downstream effects. It asserts that chat remains open
instead of clicking the hidden control again. No production behavior, test
timeout or tool-effect assertion changes.

[CI 41151222995](https://github.com/phodal/pero/actions/runs/41151222995)
passed all 18 jobs for head `2a43437d36329b83fd53c782a857fffe91b5d35f`,
including the headed Linux Desktop App Use suite. The tested merge tree matched
the published head tree. This is fixture acceptance, not real-model acceptance.
