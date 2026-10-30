#!/bin/sh
# Adapted from Point's headless daemon-host entrypoint; see PROVENANCE.md.
# This process has no Kubernetes credentials or listener. Worker owns ACP stdio.
set -eu
umask 077
: "${PERO_RUNTIME_POD_UID:?Downward API Pod UID is required}"
: "${PERO_WORKSPACE_REVISION:?Reviewed workspace revision is required}"
: "${PERO_WORKER_CONFIG:?Read-only Worker configuration is required}"
: "${PERO_WORKER_STATE:?Per-Pod Worker journal is required}"
# Overrides are operator startup configuration, never Task payload fields.
seed=${PERO_WORKSPACE_SEED:-/opt/pero/workspace}
workspace=${PERO_WORKSPACE_DIRECTORY:-/workspace/repo}
worker=${PERO_WORKER_BINARY:-/usr/local/bin/pero-worker}
[ "$(cat "$seed/.pero-workspace-revision")" = "$PERO_WORKSPACE_REVISION" ] || {
  echo 'Prepared workspace revision does not match template' >&2; exit 1;
}
# Never overwrite a surviving checkout: the journal reconciles interrupted work.
if [ ! -d "$workspace" ]; then
  pending="${workspace}.preparing"
  [ ! -e "$pending" ] || {
    echo 'Interrupted workspace preparation requires operator review' >&2; exit 1;
  }
  mkdir -p "$pending"
  cp -R "$seed/." "$pending/"
  mv "$pending" "$workspace"
fi
[ "$(cat "$workspace/.pero-workspace-revision")" = "$PERO_WORKSPACE_REVISION" ] || {
  echo 'Existing workspace revision does not match template' >&2; exit 1;
}
mkdir -p "$HOME" "$(dirname "$PERO_WORKER_STATE")"
exec "$worker"
