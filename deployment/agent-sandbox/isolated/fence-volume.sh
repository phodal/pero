#!/usr/bin/env bash
# Read-only host instrumentation for the owned single-node local-path fixture.
# NOT a production CSI fence, node-partition proof, or force-detach mechanism.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${PERO_ISOLATED_ACCEPTANCE:-} == 1 && $# == 7 ]] || exit 2
pod=$1 pod_uid=$2 sandbox=$3 sandbox_uid=$4 pvc=$5 pvc_uid=$6 pv=$7
for name in "$pod" "$sandbox" "$pvc" "$pv"; do [[ $name =~ ^[a-z0-9][a-z0-9.-]{0,252}$ ]] || exit 2; done
for uid in "$pod_uid" "$sandbox_uid" "$pvc_uid"; do [[ $uid =~ ^[a-f0-9-]{36}$ ]] || exit 2; done
: "${PERO_FIXTURE_KUBECTL:?}" "${PERO_FIXTURE_CONFIG:?}" "${PERO_FIXTURE_NODE:?}" "${PERO_FIXTURE_EVIDENCE:?}"
work=$(mktemp -d "${TMPDIR:-/tmp}/pero-fence-proof.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
ns=pero-isolated-runtime
kube() { "$PERO_FIXTURE_KUBECTL" --kubeconfig "$PERO_FIXTURE_CONFIG" "$@"; }
proof="$PERO_FIXTURE_EVIDENCE/product-proof-$pod_uid.json"
jq -e --arg uid "$pod_uid" --arg pod "$pod" --arg owner "$sandbox_uid" --arg owner_name "$sandbox" '.pod_uid==$uid and .pod==$pod and .owner_sandbox_uid==$owner and .owner_sandbox_name==$owner_name and .identity_stable==true and .runtime=="io.containerd.runsc.v1"' "$proof" >/dev/null
container_id=$(jq -r .container_id "$proof"); sandbox_id=$(jq -r .sandbox_id "$proof")
[[ $container_id =~ ^[a-f0-9]{64}$ && $sandbox_id =~ ^[a-f0-9]{64}$ ]] || exit 1
volume_identity() {
 kube -n "$ns" get pvc "$pvc" -o json > "$work/pvc.json"
 jq -e --arg uid "$pvc_uid" --arg pv "$pv" '.metadata.uid==$uid and .metadata.deletionTimestamp==null and .spec.volumeName==$pv and .spec.storageClassName=="standard" and .status.phase=="Bound"' "$work/pvc.json" >/dev/null
 kube get pv "$pv" -o json > "$work/pv.json"
 jq -e --arg uid "$pvc_uid" --arg ns "$ns" --arg pvc "$pvc" '.metadata.deletionTimestamp==null and .spec.claimRef.uid==$uid and .spec.claimRef.namespace==$ns and .spec.claimRef.name==$pvc and .spec.storageClassName=="standard" and .spec.hostPath.path!=null' "$work/pv.json" >/dev/null
 volume_path=$(jq -r .spec.hostPath.path "$work/pv.json")
 [[ $volume_path =~ ^/var/local-path-provisioner/[A-Za-z0-9_./-]+$ && $volume_path != *'/../'* && $volume_path != */.. ]] || { echo 'Not the owned local-path fixture; refusing CSI claim' >&2; exit 1; }
}
volume_identity
pv_uid=$(jq -r .metadata.uid "$work/pv.json"); original_path=$volume_path
ready=0; deadline=$((SECONDS+120))
while ((SECONDS < deadline)); do
 kube -n "$ns" get pod "$pod" --ignore-not-found -o json > "$work/original-pod.json"
 kube -n "$ns" get sandbox "$sandbox" --ignore-not-found -o json > "$work/original-sandbox.json"
 kube -n "$ns" get pods -o json > "$work/pods.json"
 docker exec "$PERO_FIXTURE_NODE" crictl pods -o json > "$work/cri-pods.json"
 docker exec "$PERO_FIXTURE_NODE" crictl ps -a -o json > "$work/cri-containers.json"
 docker exec "$PERO_FIXTURE_NODE" ctr -n k8s.io tasks list -q > "$work/tasks.txt"
 docker exec "$PERO_FIXTURE_NODE" findmnt --raw --noheadings --output TARGET > "$work/mounts.txt"
 if [[ ! -s $work/original-pod.json && ! -s $work/original-sandbox.json ]] &&
    jq -e --arg pvc "$pvc" '[.items[]|select(any(.spec.volumes[]?;.persistentVolumeClaim.claimName==$pvc))]|length==0' "$work/pods.json" >/dev/null &&
    jq -e --arg uid "$pod_uid" --arg id "$sandbox_id" '[.items[]|select(.metadata.uid==$uid or .id==$id)]|length==0' "$work/cri-pods.json" >/dev/null &&
    jq -e --arg uid "$pod_uid" --arg id "$container_id" '[.containers[]|select(.labels["io.kubernetes.pod.uid"]==$uid or .id==$id)]|length==0' "$work/cri-containers.json" >/dev/null &&
    ! grep -Fxq -e "$container_id" -e "$sandbox_id" "$work/tasks.txt" &&
    ! grep -Fq "/var/lib/kubelet/pods/$pod_uid/" "$work/mounts.txt"; then
  # No credential contents are read. Observe only fd-link targets and mapped
  # path names for this exact local PV, and fail closed on unreadable live PIDs.
  status=0
  docker exec "$PERO_FIXTURE_NODE" sh -c '
   volume=$1; pod_path=$2
   for proc in /proc/[0-9]*; do
    [ -d "$proc" ] || continue
    ls "$proc/fd" >/dev/null 2>&1 || { [ ! -d "$proc" ] || exit 2; continue; }
    for fd in "$proc"/fd/*; do
    [ -L "$fd" ] || continue
    target=$(readlink "$fd") || { [ ! -L "$fd" ] || exit 2; continue; }
    case "$target" in "$volume"|"$volume/"*|"$pod_path"|"$pod_path/"*) exit 1;; esac
    done
   done
   for maps in /proc/[0-9]*/maps; do
    grep -Fq -e "$volume/" -e "$pod_path/" "$maps" && exit 1
    result=$?; [ "$result" = 1 ] || { [ ! -e "$maps" ] || exit 2; }
   done
  ' fixture-volume-observer "$volume_path" "/var/lib/kubelet/pods/$pod_uid" > "$work/writers.txt" 2> "$work/writers.stderr" || status=$?
  if [[ $status == 0 ]]; then ready=1; break; fi
  [[ $status == 1 ]] || { echo 'Owned-node writer observation unavailable' >&2; exit 1; }
 fi
 sleep 1
done
[[ $ready == 1 ]] || { echo 'Original workload/volume not quiescent within fixture bound' >&2; exit 1; }
volume_identity
[[ $(jq -r .metadata.uid "$work/pv.json") == "$pv_uid" && $volume_path == "$original_path" ]] || exit 1
jq -n -S --arg scope 'single-owned-node-no-partition-failover' --arg node "$PERO_FIXTURE_NODE" --arg namespace "$ns" --arg pod "$pod" --arg pod_uid "$pod_uid" --arg sandbox "$sandbox" --arg sandbox_uid "$sandbox_uid" --arg pvc "$pvc" --arg pvc_uid "$pvc_uid" --arg pv "$pv" --arg pv_uid "$pv_uid" --arg observed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{kind:"single-node-storage-quiescence",quiescent:true,scope:$scope,node:$node,namespace:$namespace,pod_name:$pod,pod_uid:$pod_uid,sandbox_name:$sandbox,sandbox_uid:$sandbox_uid,pvc_name:$pvc,pvc_uid:$pvc_uid,volume_name:$pv,pv_uid:$pv_uid,observed_at:$observed,api_objects_absent:true,volume_identity_stable:true,no_referencing_pods:true,cri_objects_absent:true,original_tasks_absent:true,original_pod_mount_absent:true,no_observed_volume_fds_or_maps:true}' | tee "$PERO_FIXTURE_EVIDENCE/storage-proof-$pod_uid.json"
sha256sum "$PERO_FIXTURE_EVIDENCE/storage-proof-$pod_uid.json" > "$PERO_FIXTURE_EVIDENCE/storage-proof-$pod_uid.sha256"
