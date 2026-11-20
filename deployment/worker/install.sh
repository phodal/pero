#!/bin/sh
set -eu
umask 077

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

case "$(uname -s):$(uname -m)" in
  Linux:x86_64) ;;
  *) fail 'This Worker release supports Linux x86_64.' ;;
esac

asset=Pero-Worker-linux-x64.tar.gz
release=''
usage='Usage: install.sh <vVERSION> | install.sh --archive <Pero-Worker-linux-x64.tar.gz> <SHA256SUMS>'
case "${1:-}" in
  --archive)
    [ "$#" -eq 3 ] || fail "$usage"
    [ "${2##*/}" = "$asset" ] || fail "Expected an archive named $asset."
    archive=$2
    manifest=$3
    ;;
  v[0-9]*)
    [ "$#" -eq 1 ] || fail "$usage"
    case "$1" in *[!a-zA-Z0-9._-]*) fail "$usage" ;; esac
    release="https://github.com/phodal/pero/releases/download/$1"
    ;;
  *) fail "$usage" ;;
esac

bin_dir="${HOME:?Set HOME}/.local/bin"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pero-worker"
case "$bin_dir" in
  /*) ;;
  *) fail 'HOME must be an absolute path.' ;;
esac
case "$data_dir" in
  /*) ;;
  *) fail 'XDG_DATA_HOME must be an absolute path.' ;;
esac

work=$(mktemp -d "${TMPDIR:-/tmp}/pero-worker-install.XXXXXXXX")
bin_pending=''
unit_pending=''
cleanup() {
  [ -z "$bin_pending" ] || rm -f -- "$bin_pending"
  [ -z "$unit_pending" ] || rm -f -- "$unit_pending"
  rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ -n "$release" ]; then
  archive="$work/$asset"
  manifest="$work/SHA256SUMS"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --output "$archive" "$release/$asset"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --output "$manifest" "$release/SHA256SUMS"
else
  cp -- "$archive" "$work/$asset"
  archive="$work/$asset"
fi

expected=$(awk -v asset="$asset" '
  $2 == asset {
    matches++
    if (length($1) == 64 && $1 !~ /[^[:xdigit:]]/) digest = tolower($1)
  }
  END {
    if (matches != 1 || digest == "") exit 1
    print digest
  }
' < "$manifest") || fail "Expected one SHA-256 checksum for $asset."
actual=$(sha256sum < "$archive")
[ "${actual%% *}" = "$expected" ] || fail "SHA-256 verification failed for $asset."

# Read only the expected files. Archive paths cannot address the installation.
tar -xOzf "$archive" -- pero-worker > "$work/pero-worker"
tar -xOzf "$archive" -- pero-worker.service > "$work/pero-worker.service"
[ -s "$work/pero-worker" ] && [ -s "$work/pero-worker.service" ] || fail 'Worker archive is incomplete.'

mkdir -p -- "$bin_dir" "$data_dir"
bin_pending=$(mktemp "$bin_dir/.pero-worker.XXXXXXXX")
unit_pending=$(mktemp "$data_dir/.pero-worker.XXXXXXXX")
install -m 0755 -- "$work/pero-worker" "$bin_pending"
install -m 0644 -- "$work/pero-worker.service" "$unit_pending"
mv -fT -- "$unit_pending" "$data_dir/pero-worker.service"
mv -fT -- "$bin_pending" "$bin_dir/pero-worker"

printf 'Installed %s\nSaved service template to %s\n' \
  "$bin_dir/pero-worker" "$data_dir/pero-worker.service"
