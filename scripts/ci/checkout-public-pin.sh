#!/usr/bin/env bash
# Fetch one public commit into an empty directory.
# actions/checkout stores the job token as http.https://github.com/.extraheader.
# Clearing only http.extraheader leaves that URL-scoped key, so GitHub hides
# the other public repository and git prompts on a runner with no TTY.
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo "usage: checkout-public-pin.sh <directory> <url> <rev>" >&2
  exit 2
fi
directory="$1"
url="$2"
rev="$3"
config="$(mktemp)"
trap 'rm -f "$config"' EXIT
git init --quiet "$directory"
git -C "$directory" config core.autocrlf false
git -C "$directory" remote add origin "$url"
# A private config file inherits neither system, global, nor the checkout
# credential includeIf. -c still clears a URL-scoped extraheader if one is
# injected through the environment.
git_public() {
  env -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL="$config" \
    GIT_CONFIG_SYSTEM=/dev/null \
    GIT_TERMINAL_PROMPT=0 \
    git -C "$directory" \
      -c credential.helper= \
      -c http.extraheader= \
      -c http.https://github.com/.extraheader= \
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
