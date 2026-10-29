#!/usr/bin/env bash
# Explicitly authorized disposable CI only. Never reads an ambient kubeconfig.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${PERO_ISOLATED_ACCEPTANCE:-} == 1 ]] || { echo 'Requires the separately authorized isolated CI gate' >&2; exit 2; }
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Fixture is pinned to Linux amd64' >&2; exit 2; }
: "${PERO_TEST_DATABASE_URL:?Dedicated synthetic PostgreSQL is required}"
: "${GITHUB_RUN_ID:?Owned CI identity required}"
: "${PERO_TEST_WORKER_BIN:?External Worker binary required}"
: "${PERO_TEST_AGENT_BIN:?ACP Agent binary required}"
: "${PERO_ISOLATED_TEST_CONNECT_BINARY:?Outbound Agent transport binary required}"
: "${PERO_ISOLATED_TEST_BRIDGE_BINARY:?External Worker ACP bridge required}"
: "${PERO_ISOLATED_TEST_COLLECTOR_BINARY:?Trusted collector binary required}"
for binary in "$PERO_TEST_WORKER_BIN" "$PERO_TEST_AGENT_BIN" "$PERO_ISOLATED_TEST_CONNECT_BINARY" "$PERO_ISOLATED_TEST_BRIDGE_BINARY" "$PERO_ISOLATED_TEST_COLLECTOR_BINARY"; do
 [[ -x $binary ]] || { echo 'Required reviewed executable is absent' >&2; exit 2; }
done
root=$(git rev-parse --show-toplevel)
cd "$root"
fixture=deployment/agent-sandbox/isolated
pins="$fixture/pins.json"
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/pero-isolated.XXXXXXXX")
cluster="pero-isolated-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
registry="${cluster}-registry"
minio="${cluster}-minio"
evidence=${PERO_ISOLATED_TEST_EVIDENCE:-${RUNNER_TEMP:-/tmp}/pero-isolated-evidence}
mkdir -p "$evidence" "$work/bin" "$work/private" "$work/probe-image"
chmod 700 "$work/private"
export KUBECONFIG="$work/private/kubeconfig"
unset KUBERNETES_SERVICE_HOST KUBERNETES_SERVICE_PORT
cluster_owned=0 registry_owned=0 minio_owned=0
cleanup() {
 status=$?; trap - EXIT
 if [[ $cluster_owned == 1 ]]; then
  kubectl --kubeconfig "$KUBECONFIG" get pods -A -o wide > "$evidence/pods.txt" 2>&1 || true
  kubectl --kubeconfig "$KUBECONFIG" get networkpolicies -A -o json > "$evidence/network-policies.json" 2>&1 || true
  kubectl --kubeconfig "$KUBECONFIG" -n kube-system logs daemonset/cilium --tail=150 > "$evidence/cilium.log" 2>&1 || true
  kubectl --kubeconfig "$KUBECONFIG" -n agent-sandbox-system logs deployment/agent-sandbox-controller --tail=150 > "$evidence/controller.log" 2>&1 || true
  "$work/bin/kind" delete cluster --name "$cluster" > "$evidence/cluster-delete.txt" 2>&1 || status=1
  if "$work/bin/kind" get clusters 2>/dev/null | grep -Fxq "$cluster"; then status=1; fi
 fi
 for name in "$registry" "$minio"; do
  owned=0; [[ $name == "$registry" ]] && owned=$registry_owned || owned=$minio_owned
  if [[ $owned == 1 ]]; then
   docker rm -fv "$name" > "$evidence/${name}-removed.txt" 2>&1 || status=1
   if docker inspect "$name" >/dev/null 2>&1; then status=1; fi
  fi
 done
 # Neither tokens, TLS private keys, object-store credentials nor rendered
 # secret-bearing workload configs are included in evidence uploads.
 rm -rf "$work"
 jq -n --arg cluster "$cluster" --arg registry "$registry" --arg minio "$minio" --argjson exit "$status" '{cluster:$cluster,registry:$registry,minio:$minio,exit:$exit}' > "$evidence/cleanup.json"
 exit "$status"
}
trap cleanup EXIT
fetch() { curl --fail --silent --show-error --location --retry 2 --max-time 180 "$1" -o "$2"; }
verified() { local name=$1 path=$2; fetch "$(jq -r ".$name.url" "$pins")" "$path"; printf '%s  %s\n' "$(jq -r ".$name.sha256" "$pins")" "$path" | sha256sum -c -; }
verified kind "$work/bin/kind"
verified helm "$work/helm.tgz"
tar -xzf "$work/helm.tgz" -C "$work" linux-amd64/helm
mv "$work/linux-amd64/helm" "$work/bin/helm"
version=$(jq -r .kubectlVersion "$pins")
fetch "https://dl.k8s.io/release/$version/bin/linux/amd64/kubectl" "$work/bin/kubectl"
fetch "https://dl.k8s.io/release/$version/bin/linux/amd64/kubectl.sha256" "$work/kubectl.sha256"
printf '%s  %s\n' "$(cat "$work/kubectl.sha256")" "$work/bin/kubectl" | sha256sum -c -
chmod 0755 "$work/bin/"*
export PATH="$work/bin:$PATH"
if kind get clusters 2>/dev/null | grep -Fxq "$cluster"; then echo 'Refusing existing cluster' >&2; exit 2; fi
for name in "$registry" "$minio"; do if docker inspect "$name" >/dev/null 2>&1; then echo 'Refusing existing container' >&2; exit 2; fi; done
verified gvisor "$work/gvisor.tar.bz2"
verified cilium "$work/cilium.tgz"
verified agentSandbox "$work/controller.yaml"
cat > "$work/kind.yaml" <<'YAML'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  disableDefaultCNI: true
  ipFamily: ipv4
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: KubeletConfiguration
        podPidsLimit: 256
YAML
cluster_owned=1
kind create cluster --name "$cluster" --kubeconfig "$KUBECONFIG" --config "$work/kind.yaml" --image "$(jq -r .nodeImage "$pins")"
node=$(kind get nodes --name "$cluster")
[[ -n $node && $node != *$'\n'* ]] || { echo 'Expected one owned node' >&2; exit 1; }
# Full upstream bundle is required: recent runsc releases execute gvisor-bin
# sidecars next to runsc. Nothing is installed on the CI runner's host runtime.
# The minimal kind node has tar but no bzip2. Decompress the verified bundle on
# the host; the node needs only plain tar and receives the complete same bytes.
python3 - "$work/gvisor.tar.bz2" <<'PY_BZ2' | docker exec -i "$node" tar -xf - -C /usr/local/bin
import bz2, shutil, sys
with bz2.open(sys.argv[1], 'rb') as source:
    shutil.copyfileobj(source, sys.stdout.buffer)
PY_BZ2
docker exec "$node" /usr/local/bin/runsc --version > "$evidence/runsc-version.txt"
docker exec "$node" cat /etc/containerd/config.toml > "$work/containerd.original.toml"
if grep -Eq '^version *= *3' "$work/containerd.original.toml"; then cri='io.containerd.cri.v1.runtime';
elif grep -Eq '^version *= *2' "$work/containerd.original.toml"; then cri='io.containerd.grpc.v1.cri';
else echo 'Unknown containerd configuration schema; refusing fallback' >&2; exit 1; fi
cat <<TOML | docker exec -i "$node" sh -c 'cat >> /etc/containerd/config.toml'
[plugins."$cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
[plugins."$cri".containerd.runtimes.runsc.options]
  TypeUrl = "io.containerd.runsc.v1.options"
  ConfigPath = "/etc/containerd/runsc.toml"
TOML
printf '[runsc_config]\nplatform = "systrap"\n' | docker exec -i "$node" sh -c 'cat > /etc/containerd/runsc.toml'
docker exec "$node" systemctl restart containerd
helm install cilium "$work/cilium.tgz" --namespace kube-system --set ipam.mode=kubernetes --set operator.replicas=1 --set kubeProxyReplacement=false --set envoy.enabled=false --set ipv6.enabled=false --set extraConfig.allow-localhost=policy --wait --timeout 240s > "$evidence/cilium-install.txt"
kubectl wait --for=condition=Ready node --all --timeout=180s
kubectl -n kube-system rollout status daemonset/cilium --timeout=180s
kubectl -n kube-system exec daemonset/cilium -- cilium-dbg status --verbose > "$evidence/cilium-status.txt"
# Fail if the pinned chart ever renders unpinned component images.
helm get manifest cilium -n kube-system > "$evidence/cilium-manifest.yaml"
node - "$evidence/cilium-manifest.yaml" <<'JS'
const fs=require('node:fs'); const lines=fs.readFileSync(process.argv[2],'utf8').split('\n').filter(l=>/^\s+image:/.test(l));
if(!lines.length||lines.some(l=>!/@sha256:[a-f0-9]{64}/.test(l)))throw Error('Cilium image digest is absent');
JS
printf '{"apiVersion":"node.k8s.io/v1","kind":"RuntimeClass","metadata":{"name":"runsc"},"handler":"runsc"}\n' | kubectl apply -f -
# Pin upstream controller image independently of the versioned manifest.
sed "s#registry.k8s.io/agent-sandbox/agent-sandbox-controller:[^[:space:]]*#$(jq -r .agentSandbox.image "$pins")#" "$work/controller.yaml" > "$work/controller-pinned.yaml"
grep -Fq "$(jq -r .agentSandbox.image "$pins")" "$work/controller-pinned.yaml"
kubectl apply --server-side --field-manager=pero-isolated-fixture -f "$work/controller-pinned.yaml"
kubectl wait --for=condition=Established --timeout=120s crd/sandboxes.agents.x-k8s.io crd/sandboxclaims.extensions.agents.x-k8s.io crd/sandboxtemplates.extensions.agents.x-k8s.io crd/sandboxwarmpools.extensions.agents.x-k8s.io
kubectl -n agent-sandbox-system rollout status deployment/agent-sandbox-controller --timeout=180s
registry_owned=1
docker run -d --network kind -p 127.0.0.1::5000 --name "$registry" "$(jq -r .registryImage "$pins")" >/dev/null
port=$(docker port "$registry" 5000/tcp | sed 's/.*://')
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 2 "http://127.0.0.1:$port/v2/" >/dev/null
for n in $(kind get nodes --name "$cluster"); do
 docker exec "$n" mkdir -p "/etc/containerd/certs.d/127.0.0.1:$port"
 printf '[host."http://%s:5000"]\n' "$registry" | docker exec -i "$n" cp /dev/stdin "/etc/containerd/certs.d/127.0.0.1:$port/hosts.toml"
done
CGO_ENABLED=0 go build -trimpath -o "$work/probe-image/probe" "$fixture/probe.go"
printf 'FROM scratch\nCOPY probe /probe\nUSER 10001:10001\nENTRYPOINT ["/probe"]\n' > "$work/probe-image/Dockerfile"
probe_tag="127.0.0.1:$port/pero-isolation-probe:fixture"
docker build -t "$probe_tag" "$work/probe-image" > "$evidence/probe-image-build.txt"
docker push "$probe_tag" > "$evidence/probe-image-push.txt"
probe_image=$(docker image inspect "$probe_tag" --format '{{index .RepoDigests 0}}')
[[ $probe_image == *@sha256:* ]] || { echo 'Probe manifest digest missing' >&2; exit 1; }
node "$fixture/fixtures.mjs" baseline "$probe_image" > "$work/baseline.json"
kubectl apply -f "$work/baseline.json"
for pair in 'pero-isolation-control relay' 'pero-isolation-a neighbor-a' 'pero-isolation-b neighbor-b' 'pero-isolated-runtime product-neighbor'; do read -r ns name <<< "$pair"; kubectl -n "$ns" rollout status deployment/"$name" --timeout=180s; done
kubectl -n pero-isolation-control rollout status daemonset/node-target --timeout=180s
# Synthetic reachable metadata/public destinations exist only on the owned
# node's network namespace. Positive control proves absence isn't a false pass.
for ip in 169.254.169.254 198.51.100.23; do
 if docker exec "$node" ip -4 address show | grep -Fq "$ip/"; then echo 'Unexpected existing synthetic address' >&2; exit 1; fi
 docker exec "$node" ip address add "$ip/32" dev lo
done
relay_ip=$(kubectl -n pero-isolation-control get svc relay -o jsonpath='{.spec.clusterIP}')
a_ip=$(kubectl -n pero-isolation-a get svc neighbor-a -o jsonpath='{.spec.clusterIP}')
b_ip=$(kubectl -n pero-isolation-b get svc neighbor-b -o jsonpath='{.spec.clusterIP}')
product_ip=$(kubectl -n pero-isolated-runtime get svc product-neighbor -o jsonpath='{.spec.clusterIP}')
api_ip=$(kubectl get svc kubernetes -o jsonpath='{.spec.clusterIP}')
node_ip=$(kubectl get node "$node" -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}')
jq -n --arg image "$probe_image" --arg relay "$relay_ip" --arg a "$a_ip" --arg b "$b_ip" --arg product "$product_ip" --arg api "$api_ip" --arg node "$node_ip" '{image:$image,targets:[{name:"relay",ip:$relay,port:8080},{name:"synthetic-dns",ip:$relay,port:53,protocol:"dns"},{name:"neighbor-a",ip:$a,port:8080},{name:"neighbor-b",ip:$b,port:8080},{name:"product-neighbor",ip:$product,port:8080},{name:"kubernetes-api",ip:$api,port:443},{name:"node",ip:$node,port:18080},{name:"synthetic-metadata",ip:"169.254.169.254",port:18080},{name:"synthetic-public",ip:"198.51.100.23",port:18080}]}' > "$work/targets.json"
for mode in positive-control isolated; do
 ns=pero-isolation-control; [[ $mode == isolated ]] && ns=pero-isolation-a
 jq --arg mode "$mode" '.+{mode:$mode}' "$work/targets.json" > "$work/probe.json"
 node "$fixture/fixtures.mjs" probe "$work/probe.json" > "$work/probe-manifest.json"
 kubectl apply -f "$work/probe-manifest.json"
 wait_status=0; kubectl -n "$ns" wait --for=condition=complete "job/probe-$mode" --timeout=90s || wait_status=$?
 kubectl -n "$ns" logs "job/probe-$mode" > "$evidence/network-$mode.jsonl" 2> "$evidence/network-$mode.stderr" || true
 [[ $wait_status == 0 ]] || { echo "$mode canary failed (never treated as skipped)" >&2; exit 1; }
 jq -e '.kind=="infrastructure-network-probe" and .all_passed==true and .ipv4_only==true and (.results|length==9)' "$evidence/network-$mode.jsonl" >/dev/null
done
# Independent host CRI observation, not the Pod's self-reported kernel string.
probe_pod=$(kubectl -n pero-isolation-a get pod -l job-name=probe-isolated -o jsonpath='{.items[0].metadata.name}')
probe_uid=$(kubectl -n pero-isolation-a get pod "$probe_pod" -o jsonpath='{.metadata.uid}')
sandbox_id=$(docker exec "$node" crictl pods --name "$probe_pod" -q)
[[ -n $sandbox_id && $sandbox_id != *$'\n'* ]] || { echo 'Ambiguous runtime evidence' >&2; exit 1; }
docker exec "$node" crictl inspectp "$sandbox_id" > "$work/inspectp.json"
jq -e --arg uid "$probe_uid" '.status.metadata.uid==$uid' "$work/inspectp.json" >/dev/null
container_id=$(kubectl -n pero-isolation-a get pod "$probe_pod" -o jsonpath='{.status.containerStatuses[0].containerID}')
container_id=${container_id#containerd://}
docker exec "$node" ctr -n k8s.io containers info "$container_id" > "$work/container-info.json"
jq -e '.Runtime.Name=="io.containerd.runsc.v1"' "$work/container-info.json" >/dev/null
jq -n --arg uid "$probe_uid" --arg sandbox "$sandbox_id" --arg container "$container_id" --arg shim "$(jq -r .Runtime.Name "$work/container-info.json")" '{pod_uid:$uid,sandbox_id:$sandbox,container_id:$container,runtime:$shim}' > "$evidence/runtime.json"
export PERO_ISOLATED_TEST_API_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
export PERO_ISOLATED_TEST_CA_FILE="$work/private/cluster-ca.crt"
kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 --decode > "$PERO_ISOLATED_TEST_CA_FILE"
export PERO_ISOLATED_TEST_HOST_GATEWAY=$(docker inspect "$node" --format '{{(index .NetworkSettings.Networks "kind").Gateway}}')
export PERO_ISOLATED_TEST_NAMESPACE=pero-isolated-runtime
export PERO_ISOLATED_TEST_WORKSPACE_REVISION=$(git rev-parse HEAD)
export PERO_ISOLATED_TEST_RUNTIME_CLASS=runsc
export PERO_ISOLATED_TEST_STORAGE_CLASS=standard
export PERO_ISOLATED_TEST_EVIDENCE="$evidence"
# Test TLS authority is independent of the Kubernetes CA. Only the public cert
# is copied into the disposable workload image; its private key stays on host.
export PERO_ISOLATED_TEST_CONTROL_TLS_CERT_FILE="$work/private/control.pem"
export PERO_ISOLATED_TEST_CONTROL_TLS_KEY_FILE="$work/private/control.key"
export PERO_ISOLATED_TEST_CONTROL_CA_FILE="$work/private/control-ca.pem"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=pero-isolated-fixture \
 -addext "subjectAltName=IP:$PERO_ISOLATED_TEST_HOST_GATEWAY,IP:127.0.0.1" \
 -addext 'basicConstraints=critical,CA:TRUE' \
 -keyout "$PERO_ISOLATED_TEST_CONTROL_TLS_KEY_FILE" -out "$PERO_ISOLATED_TEST_CONTROL_TLS_CERT_FILE" 2>/dev/null
cp "$PERO_ISOLATED_TEST_CONTROL_TLS_CERT_FILE" "$PERO_ISOLATED_TEST_CONTROL_CA_FILE"
chmod 600 "$work/private/"*
mkdir -p "$work/agent-image" "$work/collector-image"
cp "$PERO_TEST_AGENT_BIN" "$work/agent-image/pero-agent-acp"
cp "$PERO_ISOLATED_TEST_CONNECT_BINARY" "$work/agent-image/pero-agent-connect"
cp deployment/agent-sandbox/{Dockerfile.isolated,entrypoint.isolated.sh} "$work/agent-image/"
cp "$PERO_ISOLATED_TEST_CONTROL_CA_FILE" "$work/agent-image/control-ca.pem"
# Exact approved fixture seed, not output attributed to Agent tool execution.
mkdir -p "$work/agent-image/workspace/artifacts"
printf 'synthetic isolated artifact\n' > "$work/agent-image/workspace/artifacts/result.txt"
printf '%s\n' "$PERO_ISOLATED_TEST_WORKSPACE_REVISION" > "$work/agent-image/workspace/.pero-workspace-revision"
sha256sum "$work/agent-image/workspace/artifacts/result.txt" > "$evidence/synthetic-seed.sha256"
# Only disposable CI prepares the runtime base; product Dockerfiles install no
# packages. Record the resolved package inventory and consume the built digest.
cat > "$work/agent-image/RuntimeBase.Dockerfile" <<'BASE'
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini=0.19.0-1 \
 && mkdir -p /opt/pero && dpkg-query -W > /opt/pero/runtime-packages.txt \
 && rm -rf /var/lib/apt/lists/*
BASE
runtime_tag="127.0.0.1:$port/pero-isolated-runtime:fixture"
docker build -f "$work/agent-image/RuntimeBase.Dockerfile" -t "$runtime_tag" "$work/agent-image" > "$evidence/runtime-image-build.txt"
docker push "$runtime_tag" > "$evidence/runtime-image-push.txt"
runtime_image=$(docker image inspect "$runtime_tag" --format '{{index .RepoDigests 0}}')
[[ $runtime_image =~ @sha256:[a-f0-9]{64}$ ]]
docker run --rm --entrypoint /bin/cat "$runtime_image" /opt/pero/runtime-packages.txt > "$evidence/runtime-packages.txt"
agent_tag="127.0.0.1:$port/pero-isolated-agent-base:fixture"
docker build -f "$work/agent-image/Dockerfile.isolated" --build-arg RUNTIME_BASE_IMAGE="$runtime_image" --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" -t "$agent_tag" "$work/agent-image" > "$evidence/agent-image-build.txt"
docker push "$agent_tag" > "$evidence/agent-image-push.txt"
agent_image=$(docker image inspect "$agent_tag" --format '{{index .RepoDigests 0}}')
[[ $agent_image =~ @sha256:[a-f0-9]{64}$ ]]
# The fixture derivative adds a credential-free probe and runtime file writer,
# not a Worker, tool-approval bypass, sidecar or changed production Pod spec.
cp "$work/probe-image/probe" "$work/agent-image/probe"
CGO_ENABLED=0 go build -trimpath -o "$work/agent-image/artifact-writer" "$fixture/artifact-writer.go"
sha256sum "$work/agent-image/artifact-writer" > "$evidence/artifact-writer.sha256"
printf 'ARG BASE\nFROM ${BASE}\nUSER 0\nRUN mv /usr/local/bin/pero-agent-acp /usr/local/bin/pero-agent-acp-real\nCOPY --chmod=0555 probe /usr/local/bin/pero-isolated-probe\nCOPY --chmod=0555 artifact-writer /usr/local/bin/pero-agent-acp\nUSER 10001:10001\n' > "$work/agent-image/Test.Dockerfile"
test_tag="127.0.0.1:$port/pero-isolated-agent:fixture"
docker build -f "$work/agent-image/Test.Dockerfile" --build-arg BASE="$agent_image" -t "$test_tag" "$work/agent-image" > "$evidence/test-image-build.txt"
docker push "$test_tag" > "$evidence/test-image-push.txt"
export PERO_ISOLATED_TEST_IMAGE=$(docker image inspect "$test_tag" --format '{{index .RepoDigests 0}}')
[[ $PERO_ISOLATED_TEST_IMAGE =~ @sha256:[a-f0-9]{64}$ ]]
cp "$PERO_ISOLATED_TEST_COLLECTOR_BINARY" "$work/collector-image/pero-artifact-collector"
cp "$PERO_ISOLATED_TEST_CONTROL_CA_FILE" "$work/collector-image/control-ca.pem"
printf 'FROM scratch\nCOPY --chmod=0555 pero-artifact-collector /usr/local/bin/pero-artifact-collector\nCOPY --chmod=0444 control-ca.pem /etc/pero/control-ca.pem\nUSER 10001:10001\nENTRYPOINT ["/usr/local/bin/pero-artifact-collector"]\n' > "$work/collector-image/Dockerfile"
collector_tag="127.0.0.1:$port/pero-artifact-collector:fixture"
docker build -t "$collector_tag" "$work/collector-image" > "$evidence/collector-image-build.txt"
docker push "$collector_tag" > "$evidence/collector-image-push.txt"
export PERO_ISOLATED_TEST_COLLECTOR_IMAGE=$(docker image inspect "$collector_tag" --format '{{index .RepoDigests 0}}')
[[ $PERO_ISOLATED_TEST_COLLECTOR_IMAGE =~ @sha256:[a-f0-9]{64}$ ]]
cat > "$work/rbac.yaml" <<'YAML'
apiVersion: v1
kind: Namespace
metadata:
  name: pero-isolated-runtime
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.36
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: pero-isolated-runtime
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: pero-agent
  namespace: pero-isolated-runtime
automountServiceAccountToken: false
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: pero-control
  namespace: pero-isolation-control
automountServiceAccountToken: false
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: pero-artifact-collector
  namespace: pero-isolated-runtime
automountServiceAccountToken: false
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pero-provider
  namespace: pero-isolated-runtime
rules:
- apiGroups: [agents.x-k8s.io]
  resources: [sandboxes]
  verbs: [create, get, delete]
- apiGroups: ['']
  resources: [persistentvolumeclaims]
  verbs: [create, get, delete]
- apiGroups: ['']
  resources: [pods]
  verbs: [get, list]
- apiGroups: ['']
  resources: [serviceaccounts]
  resourceNames: [pero-agent, pero-artifact-collector]
  verbs: [get]
- apiGroups: [batch]
  resources: [jobs]
  verbs: [create, get, delete]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pero-provider
  namespace: pero-isolated-runtime
subjects:
- kind: ServiceAccount
  name: pero-control
  namespace: pero-isolation-control
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pero-provider
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: pero-fixture-tokenreview
rules:
- apiGroups: [authentication.k8s.io]
  resources: [tokenreviews]
  verbs: [create]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: pero-fixture-tokenreview
subjects:
- kind: ServiceAccount
  name: pero-control
  namespace: pero-isolation-control
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: pero-fixture-tokenreview
YAML
kubectl apply -f "$work/rbac.yaml"
# Host-only fixture privilege: production CP cannot mutate network policy. The
# helper accepts only a TCP port; namespace and gateway are fixed by this script.
export PERO_ISOLATED_TEST_APPLY_POLICY_HELPER="$work/apply-policy"
{
 printf '#!/usr/bin/env bash\nset -euo pipefail\nreadonly kubectl=%q config=%q gateway=%q evidence=%q\n' "$work/bin/kubectl" "$KUBECONFIG" "$PERO_ISOLATED_TEST_HOST_GATEWAY" "$evidence"
 cat <<'HELPER'
[[ $# == 1 && $1 =~ ^[0-9]{1,5}$ ]] || exit 2
port=$((10#$1)); ((port >= 1 && port <= 65535)) || exit 2
"$kubectl" --kubeconfig "$config" apply -f - <<YAML
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: exact-control-endpoint
  namespace: pero-isolated-runtime
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
  - to:
    - ipBlock:
        cidr: $gateway/32
    ports:
    - protocol: TCP
      port: $port
YAML
"$kubectl" --kubeconfig "$config" -n pero-isolated-runtime get networkpolicy exact-control-endpoint -o json > "$evidence/product-network-policy.json"
HELPER
} > "$PERO_ISOLATED_TEST_APPLY_POLICY_HELPER"
chmod 700 "$PERO_ISOLATED_TEST_APPLY_POLICY_HELPER"
export PERO_ISOLATED_TEST_PROBE_POD_HELPER="$work/probe-pod"
{
 printf '#!/usr/bin/env bash\nset -euo pipefail\n'
 printf 'export PERO_FIXTURE_KUBECTL=%q PERO_FIXTURE_CONFIG=%q PERO_FIXTURE_NODE=%q PERO_FIXTURE_GATEWAY=%q\n' "$work/bin/kubectl" "$KUBECONFIG" "$node" "$PERO_ISOLATED_TEST_HOST_GATEWAY"
 printf 'export PERO_FIXTURE_IMAGE=%q PERO_FIXTURE_AGENT_IMAGE=%q PERO_FIXTURE_TARGETS=%q PERO_FIXTURE_EVIDENCE=%q PERO_FIXTURE_PROBE_SHA256=%q\n' "$PERO_ISOLATED_TEST_IMAGE" "$agent_image" "$work/targets.json" "$evidence" "$(sha256sum "$work/probe-image/probe" | cut -d' ' -f1)"
 printf 'exec %q "$@"\n' "$root/$fixture/probe-pod.sh"
} > "$PERO_ISOLATED_TEST_PROBE_POD_HELPER"
chmod 700 "$PERO_ISOLATED_TEST_PROBE_POD_HELPER"
export PERO_ISOLATED_TEST_STORAGE_FENCE_HELPER="$work/fence-volume"
{
 printf '#!/usr/bin/env bash\nset -euo pipefail\n'
 printf 'export PERO_FIXTURE_KUBECTL=%q PERO_FIXTURE_CONFIG=%q PERO_FIXTURE_NODE=%q PERO_FIXTURE_EVIDENCE=%q\n' "$work/bin/kubectl" "$KUBECONFIG" "$node" "$evidence"
 printf 'exec %q "$@"\n' "$root/$fixture/fence-volume.sh"
} > "$PERO_ISOLATED_TEST_STORAGE_FENCE_HELPER"
chmod 700 "$PERO_ISOLATED_TEST_STORAGE_FENCE_HELPER"
# Install the reviewed operator admission envelope before any product workload.
# The pre-created product-neighbor is a credential-free fixture target only;
# production Agent labels never match its target-only ingress policy.
jq -n --arg namespace "$PERO_ISOLATED_TEST_NAMESPACE" --arg runtimeClass "$PERO_ISOLATED_TEST_RUNTIME_CLASS" --arg agentImage "$PERO_ISOLATED_TEST_IMAGE" --arg collectorImage "$PERO_ISOLATED_TEST_COLLECTOR_IMAGE" '{namespace:$namespace,runtimeClass:$runtimeClass,agentImage:$agentImage,collectorImage:$collectorImage,agentServiceAccount:"pero-agent",collectorServiceAccount:"pero-artifact-collector"}' > "$work/admission-config.json"
node deployment/agent-sandbox/isolated-admission.mjs "$work/admission-config.json" > "$evidence/admission-manifest.json"
kubectl apply -f "$evidence/admission-manifest.json"
policy="pero-isolated-$PERO_ISOLATED_TEST_NAMESPACE"
deadline=$((SECONDS+120)); checked=0
while ((SECONDS < deadline)); do
 kubectl get validatingadmissionpolicy "$policy" -o json > "$evidence/admission-status.json"
 if jq -e '.status.observedGeneration==.metadata.generation and .status.typeChecking!=null' "$evidence/admission-status.json" >/dev/null; then checked=1; break; fi
 sleep 1
done
[[ $checked == 1 ]]
jq -e '(.status.typeChecking.expressionWarnings // [] | length)==0' "$evidence/admission-status.json" >/dev/null
for variant in valid wrong-runtime privileged hostpath; do
 node "$fixture/admission-probes.mjs" "$work/admission-config.json" "$variant" > "$evidence/admission-$variant.json"
 status=0; kubectl create --dry-run=server -f "$evidence/admission-$variant.json" > "$evidence/admission-$variant.txt" 2>&1 || status=$?
 if [[ $variant == valid ]]; then [[ $status == 0 ]];
 else
  [[ $status != 0 ]]
  grep -Eq 'violates PodSecurity|Pod violates the fixed Pero' "$evidence/admission-$variant.txt"
 fi
done
export PERO_ISOLATED_TEST_TOKEN_FILE="$work/private/control-token"
kubectl -n pero-isolation-control create token pero-control --duration=1h > "$PERO_ISOLATED_TEST_TOKEN_FILE"
chmod 600 "$PERO_ISOLATED_TEST_TOKEN_FILE"
# MinIO's final official security release requires a source build. This is an
# ephemeral S3 compatibility fixture, not a recommendation for production use.
git init --quiet "$work/minio-source"
git -C "$work/minio-source" remote add origin https://github.com/minio/minio.git
git -C "$work/minio-source" fetch --depth 1 origin "$(jq -r .minio.commit "$pins")"
git -C "$work/minio-source" checkout --detach FETCH_HEAD
[[ $(git -C "$work/minio-source" rev-parse HEAD) == "$(jq -r .minio.commit "$pins")" ]]
printf '%s  %s\n' "$(jq -r .minio.licenseSha256 "$pins")" "$work/minio-source/LICENSE" | sha256sum -c -
mkdir -p "$work/minio-image"
(cd "$work/minio-source" && GOWORK=off CGO_ENABLED=0 go build -mod=readonly -trimpath -o "$work/minio-image/minio" .)
cp "$work/minio-source/LICENSE" "$work/minio-image/LICENSE"
sha256sum "$work/minio-source/LICENSE" "$work/minio-image/minio" > "$evidence/minio-source-binary.sha256"
printf 'FROM scratch\nCOPY minio /minio\nCOPY LICENSE /LICENSE\nUSER 10001:10001\nENTRYPOINT ["/minio"]\n' > "$work/minio-image/Dockerfile"
docker build -t "$cluster-minio:fixture" "$work/minio-image" > "$evidence/minio-image-build.txt"
minio_image=$(docker image inspect "$cluster-minio:fixture" --format '{{.Id}}')
[[ $minio_image =~ ^sha256:[a-f0-9]{64}$ ]]
export PERO_ISOLATED_TEST_MINIO_ACCESS_KEY_FILE="$work/private/minio-access-key"
export PERO_ISOLATED_TEST_MINIO_SECRET_KEY_FILE="$work/private/minio-secret-key"
openssl rand -hex 16 > "$PERO_ISOLATED_TEST_MINIO_ACCESS_KEY_FILE"
openssl rand -hex 32 > "$PERO_ISOLATED_TEST_MINIO_SECRET_KEY_FILE"
printf 'MINIO_ROOT_USER=%s\nMINIO_ROOT_PASSWORD=%s\nMINIO_BROWSER=off\nMINIO_UPDATE=off\n' "$(cat "$PERO_ISOLATED_TEST_MINIO_ACCESS_KEY_FILE")" "$(cat "$PERO_ISOLATED_TEST_MINIO_SECRET_KEY_FILE")" > "$work/private/minio.env"
chmod 600 "$work/private/"*
minio_owned=1
docker run -d --name "$minio" -p 127.0.0.1::9000 --env-file "$work/private/minio.env" --tmpfs /data:rw,uid=10001,gid=10001,mode=0700,size=268435456 --read-only --memory 1g --cpus 1 --pids-limit 256 --cap-drop ALL --security-opt no-new-privileges "$minio_image" server /data --address :9000 >/dev/null
minio_port=$(docker port "$minio" 9000/tcp | sed 's/.*://')
export PERO_ISOLATED_TEST_MINIO_ENDPOINT="http://127.0.0.1:$minio_port"
curl --fail --silent --show-error --retry 15 --retry-connrefused --retry-delay 1 --max-time 2 "$PERO_ISOLATED_TEST_MINIO_ENDPOINT/minio/health/live" >/dev/null
export PERO_TEST_S3_ENDPOINT="$PERO_ISOLATED_TEST_MINIO_ENDPOINT"
export PERO_TEST_S3_BUCKET="pero-conformance-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
export PERO_TEST_S3_ACCESS_KEY_FILE="$PERO_ISOLATED_TEST_MINIO_ACCESS_KEY_FILE"
export PERO_TEST_S3_SECRET_KEY_FILE="$PERO_ISOLATED_TEST_MINIO_SECRET_KEY_FILE"
export PERO_REQUIRE_TEST_S3=1
go -C server test -race -json -count=1 ./internal/artifacts/s3 -run '^TestS3RealConditionalWriteConformance$' 2>&1 | tee "$evidence/s3-test.jsonl"
node "$fixture/require-test-pass.mjs" "$evidence/s3-test.jsonl" TestS3RealConditionalWriteConformance
cp "$pins" "$evidence/pins.json"
jq -n --arg head "$(git rev-parse HEAD)" --arg probe "$probe_image" --arg minio_commit "$(jq -r .minio.commit "$pins")" --arg minio_image "$minio_image" --arg agent "$agent_image" --arg test "$PERO_ISOLATED_TEST_IMAGE" --arg collector "$PERO_ISOLATED_TEST_COLLECTOR_IMAGE" '{head:$head,probe_image:$probe,agent_image:$agent,test_image:$test,collector_image:$collector,minio_commit:$minio_commit,minio_image:$minio_image,scope:"single-node disposable infrastructure; not CSI fencing acceptance"}' > "$evidence/build.json"
# Required product cases cannot be replaced by infrastructure-only evidence.
go -C server test -race -json -count=1 -timeout=20m ./internal/sandbox -run '^TestIsolatedClusterRuntime$' 2>&1 | tee "$evidence/isolated-cluster-test.jsonl"
for test in TestIsolatedClusterRuntime TestIsolatedClusterRuntime/success TestIsolatedClusterRuntime/cancel; do
 node "$fixture/require-test-pass.mjs" "$evidence/isolated-cluster-test.jsonl" "$test"
done
