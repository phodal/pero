#!/usr/bin/env bash
set -euo pipefail

# Build the committed Go source locally; this small host must not compile it.
root=$(cd "$(dirname "$0")/../.." && pwd)
target=${PERO_DEPLOY_SSH_TARGET:?Set PERO_DEPLOY_SSH_TARGET}
key=${PERO_DEPLOY_SSH_KEY:?Set PERO_DEPLOY_SSH_KEY}
revision=$(git -C "$root" rev-parse "${PERO_DEPLOY_REVISION:-HEAD}^{commit}")
release=$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:8}
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
git -C "$root" archive "$revision" server | tar -xf - -C "$stage"
(cd "$stage/server" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags='-s -w' -o "$stage/pero-server" ./cmd/server)
rm -rf "$stage/server"
cp "$root/deployment/task-center/Dockerfile" "$stage/"
printf '%s\n' "$revision" > "$stage/source-revision"
ssh -i "$key" -o BatchMode=yes "$target" "sudo install -d -o ec2-user -g ec2-user /opt/openpero/releases/$release"
scp -q -i "$key" "$stage/pero-server" "$stage/Dockerfile" "$stage/source-revision" \
    "$root/deployment/task-center/activate.sh" "$root/deployment/task-center/maintenance.sh" \
    "$target:/opt/openpero/releases/$release/"
ssh -i "$key" -o BatchMode=yes "$target" "sudo bash /opt/openpero/releases/$release/activate.sh $release"
printf 'Release: %s\n' "$release"
