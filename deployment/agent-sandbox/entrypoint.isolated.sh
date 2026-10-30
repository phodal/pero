#!/bin/sh
set -eu
umask 077
: "${PERO_AGENT_CONTROL_URL:?fixed control origin required}"
: "${PERO_AGENT_RUN_ID:?Run identity required}"
: "${PERO_AGENT_SESSION_ID:?session identity required}"
: "${PERO_AGENT_TOKEN_FILE:?projected Pod token required}"
: "${PERO_AGENT_WORKSPACE:?fixed workspace required}"
: "${PERO_AGENT_MODEL:?fixed model required}"
[ "$PERO_AGENT_WORKSPACE" = /workspace/repo ]
[ "$PERO_AGENT_RUN_ID" = "$PERO_AGENT_SESSION_ID" ]
[ -r "$PERO_AGENT_TOKEN_FILE" ]
# A fresh per-Run PVC is initialized once. Never silently overwrite or replay a
# partial/previous workspace after a crash. No repository credentials or Git.
: "${PERO_WORKSPACE_REVISION:?reviewed workspace revision required}"
[ "$(cat /opt/pero/workspace/.pero-workspace-revision)" = "$PERO_WORKSPACE_REVISION" ]
mkdir /workspace/.pero-initialized
printf '%s\n' "$PERO_AGENT_RUN_ID" > /workspace/.pero-run-id
mkdir /workspace/repo /workspace/.pero-sessions
cp -R /opt/pero/workspace/. /workspace/repo/
exec /usr/local/bin/pero-agent-connect
