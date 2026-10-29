#!/usr/bin/env bash
# Disposable GitHub Actions acceptance only. Never reads an ambient kubeconfig.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Run only on an authorized disposable GitHub Actions runner' >&2; exit 2; }
: "${PERO_TEST_DATABASE_URL:?Dedicated synthetic test PostgreSQL is required}"
: "${PERO_SANDBOX_WORKER_BINARY:?Built Linux Worker is required}"
: "${PERO_SANDBOX_AGENT_BINARY:?Built Linux ACP executable is required}"
root=$(git rev-parse --show-toplevel)
cd "$root"
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/pero-kind.XXXXXXXX")
cluster="pero-e2e-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:-1}"
registry="${cluster}-registry"
evidence=${PERO_SANDBOX_EVIDENCE:-$work/evidence}
mkdir -p "$evidence" "$work/bin" "$work/image"
export KUBECONFIG="$work/kubeconfig"
unset KUBERNETES_SERVICE_HOST KUBERNETES_SERVICE_PORT
cluster_owned=0 registry_owned=0 proxy_pid=
cleanup() {
  status=$?
  trap - EXIT
  if [[ $cluster_owned == 1 ]]; then
    "$work/bin/kubectl" --kubeconfig "$KUBECONFIG" get pods -A -o wide > "$evidence/pods.txt" 2>&1 || true
    "$work/bin/kubectl" --kubeconfig "$KUBECONFIG" -n agent-sandbox-system logs deployment/agent-sandbox-controller --tail=200 > "$evidence/controller.log" 2>&1 || true
  fi
  [[ -z $proxy_pid ]] || { kill "$proxy_pid" 2>/dev/null || true; wait "$proxy_pid" 2>/dev/null || true; }
  if [[ $cluster_owned == 1 ]]; then "$work/bin/kind" delete cluster --name "$cluster" || status=1; fi
  if [[ $registry_owned == 1 ]]; then
    docker inspect --format '{{json .State}}' "$registry" > "$evidence/registry-state.json" 2>&1 || true
    docker port "$registry" > "$evidence/registry-ports.txt" 2>&1 || true
    docker logs --tail=100 "$registry" > "$evidence/registry.log" 2>&1 || true
    docker rm -f "$registry" > "$evidence/registry-removed.txt" || status=1
  fi
  printf 'cluster=%s\nregistry=%s\nexit=%s\n' "$cluster" "$registry" "$status" > "$evidence/cleanup.txt"
  # Ephemeral kubeconfig, build context, and test secrets are never uploaded.
  rm -rf "$work/bin" "$work/image" "$work/kubeconfig" "$work/cluster-ca.crt" "$work/controller.yaml"
  exit "$status"
}
trap cleanup EXIT
curl --fail --silent --show-error --location --retry 2 https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-linux-amd64 -o "$work/bin/kind"
echo "aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d  $work/bin/kind" | sha256sum -c -
curl --fail --silent --show-error --location --retry 2 https://dl.k8s.io/release/v1.36.4/bin/linux/amd64/kubectl -o "$work/bin/kubectl"
# Kubectl's official versioned checksum is verified before executing it.
curl --fail --silent --show-error --location https://dl.k8s.io/release/v1.36.4/bin/linux/amd64/kubectl.sha256 -o "$work/kubectl.sha256"
printf '%s  %s\n' "$(cat "$work/kubectl.sha256")" "$work/bin/kubectl" | sha256sum -c -
chmod 0755 "$work/bin/kind" "$work/bin/kubectl"
export PATH="$work/bin:$PATH"
if kind get clusters 2>/dev/null | grep -Fxq "$cluster"; then echo 'Refusing to use an existing cluster' >&2; exit 2; fi
if docker inspect "$registry" >/dev/null 2>&1; then echo 'Refusing to use an existing registry' >&2; exit 2; fi
cluster_owned=1
kind create cluster --name "$cluster" --kubeconfig "$KUBECONFIG" --wait 180s --image kindest/node:v1.36.4@sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed
# Attach at creation: a later network connect can reassign dynamic host ports
# (moby/moby#44137), invalidating both image names and containerd host aliases.
registry_owned=1
docker run -d --network kind -p 127.0.0.1::5000 --name "$registry" registry:3.0.0@sha256:6c5666b861f3505b116bb9aa9b25175e71210414bd010d92035ff64018f9457e >/dev/null
port=$(docker port "$registry" 5000/tcp | sed 's/.*://')
# Match the IPv4-only published socket; localhost may resolve to ::1 first.
curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 \
  --max-time 2 "http://127.0.0.1:$port/v2/" > /dev/null
export PERO_SANDBOX_DIRECT_API=$(kubectl --kubeconfig "$KUBECONFIG" config view --minify -o jsonpath='{.clusters[0].cluster.server}')
export PERO_SANDBOX_CA_FILE="$work/cluster-ca.crt"
kubectl --kubeconfig "$KUBECONFIG" config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 --decode > "$PERO_SANDBOX_CA_FILE"
[[ -s $PERO_SANDBOX_CA_FILE && $PERO_SANDBOX_DIRECT_API == https://127.0.0.1:* ]] || { echo 'Invalid owned cluster API identity' >&2; exit 1; }
# Containerd host aliases follow kind's documented local registry contract.
for node in $(kind get nodes --name "$cluster"); do
  docker exec "$node" mkdir -p "/etc/containerd/certs.d/127.0.0.1:$port"
  printf '[host."http://%s:5000"]\n' "$registry" | docker exec -i "$node" cp /dev/stdin "/etc/containerd/certs.d/127.0.0.1:$port/hosts.toml"
done
curl --fail --silent --show-error --location --retry 2 https://github.com/kubernetes-sigs/agent-sandbox/releases/download/v1.0.2/sandbox-with-extensions.yaml -o "$work/controller.yaml"
echo "e3dda8359fee2b1bb6f4a9448d7004888286482b17670c581dee976f370fd165  $work/controller.yaml" | sha256sum -c -
sed -i 's|registry.k8s.io/agent-sandbox/agent-sandbox-controller:v1.0.2|registry.k8s.io/agent-sandbox/agent-sandbox-controller@sha256:dc700a37ecf4e680a146098a30996f420507e76e83a27dbd293f2b8114b14daa|' "$work/controller.yaml"
grep -Fq 'image: registry.k8s.io/agent-sandbox/agent-sandbox-controller@sha256:dc700a37ecf4e680a146098a30996f420507e76e83a27dbd293f2b8114b14daa' "$work/controller.yaml"
kubectl --kubeconfig "$KUBECONFIG" apply --server-side --field-manager=pero-disposable-e2e -f "$work/controller.yaml"
kubectl --kubeconfig "$KUBECONFIG" wait --for=condition=Established --timeout=120s crd/sandboxes.agents.x-k8s.io crd/sandboxclaims.extensions.agents.x-k8s.io crd/sandboxtemplates.extensions.agents.x-k8s.io crd/sandboxwarmpools.extensions.agents.x-k8s.io
kubectl --kubeconfig "$KUBECONFIG" -n agent-sandbox-system rollout status deployment/agent-sandbox-controller --timeout=180s
export PERO_SANDBOX_WORKSPACE_REVISION=$(git rev-parse HEAD)
cp "$PERO_SANDBOX_WORKER_BINARY" "$work/image/pero-worker"
cp "$PERO_SANDBOX_AGENT_BINARY" "$work/image/pero-agent-acp"
cp deployment/agent-sandbox/{Dockerfile,entrypoint.sh} "$work/image/"
node deployment/agent-sandbox/prepare-workspace.mjs "$root" "$PERO_SANDBOX_WORKSPACE_REVISION" "$work/image/workspace"
# Only the disposable CI prepares a base; the product Dockerfile installs nothing.
cat > "$work/image/RuntimeBase.Dockerfile" <<'BASE'
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates procps \
 && mkdir -p /opt/pero && dpkg-query -W > /opt/pero/runtime-packages.txt \
 && rm -rf /var/lib/apt/lists/*
BASE
runtime_base="127.0.0.1:$port/pero-runtime-base:ci"
docker build --file "$work/image/RuntimeBase.Dockerfile" --tag "$runtime_base" "$work/image"
docker push "$runtime_base"
runtime_base_digest=$(docker image inspect "$runtime_base" --format '{{index .RepoDigests 0}}')
[[ $runtime_base_digest =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'Missing runtime base manifest digest' >&2; exit 1; }
base="127.0.0.1:$port/pero-worker-base:ci"
docker build --build-arg RUNTIME_BASE_IMAGE="$runtime_base_digest" --build-arg SOURCE_REVISION="$PERO_SANDBOX_WORKSPACE_REVISION" --tag "$base" "$work/image"
CGO_ENABLED=0 go build -trimpath -o "$work/image/gateway" ./deployment/agent-sandbox/test/gateway.go
printf 'ARG BASE\nFROM ${BASE}\nCOPY --chmod=0555 gateway /usr/local/bin/pero-sandbox-test-gateway\n' > "$work/image/Test.Dockerfile"
tag="127.0.0.1:$port/pero-worker:ci"
docker build --file "$work/image/Test.Dockerfile" --build-arg BASE="$base" --tag "$tag" "$work/image"
docker push "$tag"
export PERO_SANDBOX_IMAGE=$(docker image inspect "$tag" --format '{{index .RepoDigests 0}}')
[[ $PERO_SANDBOX_IMAGE =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'Missing pushed manifest digest' >&2; exit 1; }
# Validate the actual production renderer against installed CRDs without creating
# ConfigMaps, templates, pools or Pods. The Go workload fixture has test-only routing.
node --input-type=module <<'RENDER' > "$work/rendered-dry-run.json"
import { manifests } from './deployment/agent-sandbox/render.mjs';
console.log(JSON.stringify(manifests({
  namespace: 'default', name: 'pero-renderer-dry-run',
  image: process.env.PERO_SANDBOX_IMAGE,
  workspaceRevision: process.env.PERO_SANDBOX_WORKSPACE_REVISION,
  workspaceKey: 'repo', agentID: 'dsh',
  cloudURL: 'https://control.example.invalid', providerEndpoint: 'https://provider.example.invalid/v1',
  model: 'synthetic-only', workerSecret: 'synthetic-worker-reference', providerSecret: 'synthetic-provider-reference',
  dnsCIDR: '10.96.0.10/32', egress: [{ cidr: '192.0.2.10/32', port: 443 }],
})));
RENDER
kubectl --kubeconfig "$KUBECONFIG" apply --dry-run=server --server-side --field-manager=pero-disposable-dry-run -f "$work/rendered-dry-run.json" | tee "$evidence/renderer-dry-run.txt"
sha256sum "$work/rendered-dry-run.json" > "$evidence/renderer-digest.txt"
# IPAM.Config describes requested pools and may omit an automatically assigned
# gateway. The registry endpoint is attached to the exact node bridge network.
docker inspect --format '{{json (index .NetworkSettings.Networks "kind")}}' "$registry" > "$evidence/kind-endpoint.json"
PERO_SANDBOX_HOST=$(python3 - "$evidence/kind-endpoint.json" <<'GATEWAY'
import ipaddress,json,sys
endpoint=json.load(open(sys.argv[1]))
print(ipaddress.IPv4Address(endpoint['Gateway']))
GATEWAY
)
export PERO_SANDBOX_HOST
kubectl --kubeconfig "$KUBECONFIG" proxy --address=127.0.0.1 --port=0 > "$work/proxy.log" 2>&1 &
proxy_pid=$!
for _ in $(seq 1 100); do
  if grep -q 'Starting to serve on 127.0.0.1:' "$work/proxy.log"; then break; fi
  kill -0 "$proxy_pid" || { cat "$work/proxy.log"; exit 1; }
  sleep 0.1
done
proxy=$(sed -n 's/Starting to serve on //p' "$work/proxy.log" | head -1)
[[ $proxy == 127.0.0.1:* ]] || { echo 'Owned API proxy did not become ready' >&2; exit 1; }
export PERO_SANDBOX_KUBE_API="http://$proxy"
export PERO_SANDBOX_CLUSTER_E2E=1
{
  printf 'runtime_base=%s\nhost_gateway=%s\n' "$runtime_base_digest" "$PERO_SANDBOX_HOST"
  printf 'source=%s\nimage=%s\nagent_sandbox=v1.0.2\nagent_sandbox_commit=9a85153590e54cb980f3241f9e7a9228449412c9\n' "$PERO_SANDBOX_WORKSPACE_REVISION" "$PERO_SANDBOX_IMAGE"
  kind version; kubectl version --client; go version; rustc --version
  sha256sum "$PERO_SANDBOX_WORKER_BINARY" "$PERO_SANDBOX_AGENT_BINARY"
} > "$evidence/versions.txt"
go -C server test -count=1 -json ./internal/sandbox -run '^TestClusterRuntime$' 2>&1 | tee "$evidence/cluster-test.jsonl"
python3 - "$evidence/cluster-test.jsonl" <<'CHECK'
import json,sys
records=[]
for line in open(sys.argv[1]):
    try: records.append(json.loads(line))
    except json.JSONDecodeError: pass
if not any(r.get('Test') == 'TestClusterRuntime' and r.get('Action') == 'pass' for r in records):
    raise SystemExit('Required real cluster test did not PASS (missing/skipped is failure)')
CHECK
