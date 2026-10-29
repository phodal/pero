#!/usr/bin/env bash
# Host-only disposable acceptance instrumentation. Not a runtime transport.
# The generated wrapper fixes all infrastructure inputs; callers choose only
# an already-created Pod identity and the already-approved listener port.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${PERO_ISOLATED_ACCEPTANCE:-} == 1 ]] || exit 2
[[ $# == 3 && $1 =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ && $2 =~ ^[a-f0-9-]{36}$ && $3 =~ ^[0-9]{1,5}$ ]] || exit 2
pod=$1 uid=$2 port=$((10#$3))
((port >= 1 && port <= 65535)) || exit 2
: "${PERO_FIXTURE_KUBECTL:?}" "${PERO_FIXTURE_CONFIG:?}" "${PERO_FIXTURE_NODE:?}" "${PERO_FIXTURE_GATEWAY:?}"
: "${PERO_FIXTURE_IMAGE:?}" "${PERO_FIXTURE_AGENT_IMAGE:?}" "${PERO_FIXTURE_TARGETS:?}" "${PERO_FIXTURE_EVIDENCE:?}" "${PERO_FIXTURE_PROBE_SHA256:?}"
work=$(mktemp -d "${TMPDIR:-/tmp}/pero-pod-proof.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
ns=pero-isolated-runtime
kube() { "$PERO_FIXTURE_KUBECTL" --kubeconfig "$PERO_FIXTURE_CONFIG" -n "$ns" "$@"; }
# Do not turn this into a general port scanner or a policy-mutation interface.
kube get networkpolicy exact-control-endpoint -o json > "$work/policy.json"
jq -e --arg cidr "$PERO_FIXTURE_GATEWAY/32" --argjson port "$port" '.spec.egress==[{"to":[{"ipBlock":{"cidr":$cidr}}],"ports":[{"protocol":"TCP","port":$port}]}]' "$work/policy.json" >/dev/null
observe() {
 kube get pod "$pod" -o json > "$work/pod.json"
 jq -e --arg uid "$uid" --arg node "$PERO_FIXTURE_NODE" --arg image "$PERO_FIXTURE_IMAGE" '
  .metadata.uid==$uid and .metadata.deletionTimestamp==null and .spec.nodeName==$node and
  (.spec.containers|length)==1 and .spec.containers[0].image==$image and
  (.status.containerStatuses|length)==1 and .status.containerStatuses[0].state.running!=null and
  .status.containerStatuses[0].restartCount==0' "$work/pod.json" >/dev/null
 current=$(jq -r '.status.containerStatuses[0].containerID' "$work/pod.json")
 [[ $current =~ ^containerd://[a-f0-9]{64}$ ]] || exit 1
 current=${current#containerd://}
 sandbox=$(docker exec "$PERO_FIXTURE_NODE" crictl pods --name "^$pod$" --namespace "$ns" -q)
 [[ $sandbox =~ ^[a-f0-9]{64}$ ]] || exit 1
 docker exec "$PERO_FIXTURE_NODE" crictl inspectp "$sandbox" > "$work/sandbox.json"
 jq -e --arg uid "$uid" --arg ns "$ns" '.status.metadata.uid==$uid and .status.metadata.namespace==$ns' "$work/sandbox.json" >/dev/null
 docker exec "$PERO_FIXTURE_NODE" ctr -n k8s.io containers info "$current" > "$work/container.json"
 jq -e '.Runtime.Name=="io.containerd.runsc.v1"' "$work/container.json" >/dev/null
}
observe
before=$current before_sandbox=$sandbox
owner_uid=$(jq -r '.metadata.ownerReferences[]|select(.kind=="Sandbox" and .controller==true)|.uid' "$work/pod.json")
owner_name=$(jq -r '.metadata.ownerReferences[]|select(.kind=="Sandbox" and .controller==true)|.name' "$work/pod.json")
[[ $owner_uid =~ ^[a-f0-9-]{36}$ && $owner_name =~ ^[a-z0-9][a-z0-9-]*$ ]] || exit 1
config=$(jq -c --arg host "$PERO_FIXTURE_GATEWAY" --argjson port "$port" '{targets:[.targets[]|{name:.name,protocol:(.protocol//"tcp"),address:((if .name=="relay" then $host else .ip end)+":"+(if .name=="relay" then $port else .port end|tostring)),allow:(.name=="relay")} ]}' "$PERO_FIXTURE_TARGETS")
# The command and executable bytes are fixed. No token/env/proc credential reads,
# arbitrary command strings, sidecar, host mount, or CP pods/exec permission.
status=0
docker exec "$PERO_FIXTURE_NODE" crictl exec --sync --timeout 30 "$before" /usr/local/bin/pero-isolated-probe --mode=probe --config-json "$config" > "$work/probe.json" 2> "$work/probe.stderr" || status=$?
artifact_status=0
docker exec "$PERO_FIXTURE_NODE" crictl exec --sync --timeout 5 "$before" /usr/local/bin/pero-isolated-probe --mode=artifact > "$work/artifact.json" 2> "$work/artifact.stderr" || artifact_status=$?
observe
[[ $current == "$before" && $sandbox == "$before_sandbox" ]] || { echo 'Product identity changed during probe' >&2; exit 1; }
cp "$work/probe.json" "$PERO_FIXTURE_EVIDENCE/product-network-$uid.jsonl"
cp "$work/probe.stderr" "$PERO_FIXTURE_EVIDENCE/product-network-$uid.stderr"
[[ $status == 0 && $artifact_status == 0 ]] || exit 1
jq -e '.all_passed==true and .ipv4_only==true and .uid==10001 and .gid==10001 and (.results|length==9)' "$work/probe.json" >/dev/null
jq -n --arg uid "$uid" --arg pod "$pod" --arg owner_uid "$owner_uid" --arg owner_name "$owner_name" --arg container "$current" --arg sandbox "$sandbox" --arg image "$PERO_FIXTURE_IMAGE" --arg production "$PERO_FIXTURE_AGENT_IMAGE" --arg probe_sha256 "$PERO_FIXTURE_PROBE_SHA256" --slurpfile network "$work/probe.json" --slurpfile artifact "$work/artifact.json" '{kind:"product-controlled-probe",pod:$pod,pod_uid:$uid,owner_sandbox_uid:$owner_uid,owner_sandbox_name:$owner_name,container_id:$container,sandbox_id:$sandbox,runtime:"io.containerd.runsc.v1",identity_stable:true,production_image:$production,test_image:$image,probe_sha256:$probe_sha256,network:$network[0],generated_artifact:$artifact[0]}' | tee "$PERO_FIXTURE_EVIDENCE/product-proof-$uid.json"
