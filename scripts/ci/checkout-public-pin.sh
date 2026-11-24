#!/usr/bin/env bash
# Fetch one public commit into an empty directory.
# The job token from actions/checkout is scoped to this repository. Sending it
# to another public repository makes GitHub hide that repository, and git then
# prompts for a username. Runners have no TTY, so the prompt fails immediately
# with "could not read Username" and "expected flush after ref listing".
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo "usage: checkout-public-pin.sh <directory> <url> <rev>" >&2
  exit 2
fi
directory="$1"
url="$2"
rev="$3"
git init --quiet "$directory"
git -C "$directory" config core.autocrlf false
git -C "$directory" remote add origin "$url"
git_public() {
  GIT_TERMINAL_PROMPT=0 git -C "$directory" \
    -c credential.helper= \
    -c http.extraheader= \
    "$@"
}
attempt=1
until git_public fetch --depth 1 origin "$rev"; do
  if [ "$attempt" -ge 3 ]; then
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep $((attempt * 2))
done
git_public checkout --detach FETCH_HEAD
