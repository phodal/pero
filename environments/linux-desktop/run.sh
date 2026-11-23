#!/bin/bash
set -eu

root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
docker=("${PERO_REMOTE_DESKTOP_DOCKER:-docker}" --context "${PERO_REMOTE_DESKTOP_CONTEXT:-colima-pero-remote-desktop}")
image=${PERO_REMOTE_DESKTOP_IMAGE:-pero/linux-desktop:dev}
name=${PERO_REMOTE_DESKTOP_CONTAINER:-pero-linux-desktop-standalone}

case "${1:-}" in
    build) exec "${docker[@]}" build -t "$image" -f "$root/environments/linux-desktop/Dockerfile" "$root" ;;
    build-blender) exec "${docker[@]}" build --target blender -t "${PERO_REMOTE_DESKTOP_IMAGE:-pero/linux-desktop:blender}" \
        -f "$root/environments/linux-desktop/Dockerfile" "$root" ;;
    start) exec "${docker[@]}" run --detach --rm --init --pull never --name "$name" \
        --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 "$image" ;;
    stop) exec "${docker[@]}" stop "$name" ;;
    probe|input-idle) exec "${docker[@]}" exec "$name" pero-desktop "$1" ;;
    observe|control|computer) exec "${docker[@]}" exec -i "$name" pero-desktop "$1" ;;
    *) printf 'Usage: %s {build|build-blender|start|probe|computer|observe|control|stop}\n' "$0" >&2; exit 2 ;;
esac
