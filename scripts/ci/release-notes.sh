#!/usr/bin/env bash
# Notes for one admitted release SHA. The range starts at the latest published
# ancestor when that tag can be fetched. A nearer development tag does not
# shorten it. With neither base, publication stops instead of inventing one.
set -euo pipefail

: "${GATE_TARGET_SHA:?}"

if [[ "$(git rev-parse --is-shallow-repository)" == true ]]; then
  git fetch --unshallow origin
fi
git fetch --no-tags origin "$GATE_TARGET_SHA"
if git ls-remote --exit-code --tags origin 'refs/tags/v0.1.0-dev.*' >/dev/null; then
  git fetch origin 'refs/tags/v0.1.0-dev.*:refs/tags/v0.1.0-dev.*'
fi

nearest=""
if nearest=$(git describe --tags --match 'v0.1.0-dev.*' --abbrev=0 "${GATE_TARGET_SHA}^" 2>/dev/null); then
  :
else
  nearest=""
fi

published=$(gh release list --limit 50 --json tagName,isDraft --jq '[.[] | select(.isDraft == false) | .tagName] | .[0]')
if [[ "$published" == "null" ]]; then
  published=""
fi
if [[ -n "$published" ]]; then
  git fetch --no-tags origin "refs/tags/${published}:refs/tags/${published}"
fi

if [[ -n "$published" ]] && git merge-base --is-ancestor "$published" "$GATE_TARGET_SHA"; then
  base="$published"
elif [[ -n "$nearest" ]]; then
  base="$nearest"
else
  echo "No previous published release or reachable v0.1.0-dev tag for ${GATE_TARGET_SHA}" >&2
  exit 1
fi

cat > release-notes.md <<'EOF_NOTES'
Pero Desktop development packages, built and launch-tested on native GitHub Actions runners.

- Pero: macOS Apple Silicon DMG, Windows x64 portable ZIP, Linux x64 portable tar.gz.
- Pero Native: separate macOS Apple Silicon DMG using GPUI and system WebKit, with bundled Host, Node and Apps; no source checkout needed. Native and Electron use separate data profiles.
- Task Center defaults to https://app.openpero.com.
- No source checkout needed: sign in, claim a public task and choose a save folder. Pero clones the repository and creates the task branch.
- Native local sessions and Apps are available; preparing a cloud contribution workspace is currently supported by Electron only. Python App environments are prepared on first use.
- Install Git and a supported coding CLI and authenticate the CLI before starting. Native coding CLIs are not bundled.
- To publish PRs, install GitHub CLI from https://cli.github.com and run `gh auth login --hostname github.com --git-protocol https` in any directory. Then check changes again in Pero. App sign-in and gh authorization are separate.
- macOS packages are ad-hoc signed and not notarized; Windows/Linux packages are unsigned development builds.
- Per-product build metadata and SHA256SUMS accompany every archive.
EOF_NOTES
{
  echo
  echo "Changes since ${base}:"
  echo
  git log --format='- %h %s' "${base}..${GATE_TARGET_SHA}"
} >> release-notes.md
