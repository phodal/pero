#!/usr/bin/env bash
# Run the release-pinned ACP wire comparisons with a loopback provider.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo 'usage: check-dsh-alpha2.sh <DSH package.json> <pero-agent-acp binary>' >&2
  exit 2
fi

runner="$(dirname "${BASH_SOURCE[0]}")/compare-acp-alpha2.mjs"
lanes=(EFFECTS MESSAGES SIGNED DSH_FILES PERO_IMAGES PERO_FILES)
for lane in "${lanes[@]}"; do unset "PERO_ACP_$lane"; done
echo '=== EMPTY ==='
node "$runner" "$@"
for lane in "${lanes[@]}"; do
  echo "=== $lane ==="
  env "PERO_ACP_$lane=1" node "$runner" "$@"
done
