---
kind: verification_report
date: 2026-11-21
---
# macOS strict Shell startup

On macOS 27.2.1 arm64 the existing strict profile aborted the fixed
`/usr/bin/true` probe before agent initialization. The crash stack entered
dyld's CacheFinder and libignition. Apple's installed dyld-support profile
describes opening the root directory as an `openat` base. With the same
deny-default profile and binary, adding only existence checks still aborted.
Adding `file-read-data` for the literal root directory allowed the probe to exit
zero. The permission covers the directory itself (including its entries).
Files beneath it still require an explicit rule.
