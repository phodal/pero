#!/usr/bin/env bash
set -euo pipefail
release=${1:?release required}
[[ $release =~ ^[0-9TZ]+-[a-f0-9]{8}$ ]]
cd "/opt/openpero/releases/$release"
install -d -m 700 /etc/openpero /var/lib/openpero/backups

# Generate credentials only at first provision. Do not replace existing secrets.
if [[ ! -f /etc/openpero/server.env ]]; then
    python3 - <<'PY'
import json, os, secrets
password = secrets.token_hex(32)
repos = [{"project_id":"pero", "owner":"phodal", "repo":"pero",
          "workspace_key":"pero", "agent_id":"codex",
          "acceptance":"Follow AGENTS.md and verify the task against the repository checks. Report evidence and remaining limitations.",
          "auto_dispatch":False, "roadmap_path":"auto"}]
for path, values in [('/etc/openpero/postgres.env', {
    'POSTGRES_USER':'pero', 'POSTGRES_DB':'pero', 'POSTGRES_PASSWORD':password}),
    ('/etc/openpero/server.env', {
    'PERO_DATABASE_URL':'postgres://pero:'+password+'@openpero-postgres:5432/pero?sslmode=disable&pool_max_conns=4',
    'PERO_OPERATOR_TOKEN':secrets.token_hex(32), 'PERO_LISTEN':'0.0.0.0:8787',
    'PERO_PUBLIC_URL':'https://app.openpero.com',
    'PERO_GITHUB_SYNC_SECONDS':'600',
    'PERO_GITHUB_REPOSITORIES':json.dumps(repos, separators=(',', ':')),
    'GOMEMLIMIT':'48MiB', 'GOMAXPROCS':'1'})]:
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        f.write(''.join(k+'='+v+'\n' for k,v in values.items()))
PY
fi
docker network inspect openpero >/dev/null 2>&1 || docker network create openpero >/dev/null
if ! docker container inspect openpero-postgres >/dev/null 2>&1; then
    docker run -d --name openpero-postgres --restart unless-stopped \
        --network openpero --memory 128m --memory-swap 128m --cpus 0.25 --pids-limit 64 \
        --log-opt max-size=5m --log-opt max-file=2 \
        --env-file /etc/openpero/postgres.env \
        -v /var/lib/openpero/postgres:/var/lib/postgresql/data \
        postgres:17.11-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b postgres -c shared_buffers=16MB -c max_connections=20 \
        -c work_mem=1MB -c maintenance_work_mem=16MB >/dev/null
else
    docker start openpero-postgres >/dev/null
fi
ready=false
for ((i=0; i<60; i++)); do
    if docker exec openpero-postgres pg_isready -U pero -d pero >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
done
[[ $ready == true ]] || { docker logs --tail 25 openpero-postgres; exit 1; }
docker exec openpero-postgres pg_dump -U pero -d pero -Fc > "/var/lib/openpero/backups/$release.dump"
cp /etc/pki/tls/certs/ca-bundle.crt ca-certificates.crt
revision=$(cat source-revision)
sha256sum pero-server ca-certificates.crt > SHA256SUMS
docker build --label "org.opencontainers.image.revision=$revision" -t "openpero:$release" .
if docker container inspect openpero >/dev/null 2>&1; then
    docker rm openpero-previous >/dev/null 2>&1 || true
    docker stop openpero >/dev/null
    docker rename openpero openpero-previous
fi
started=false
if docker run -d --name openpero --restart unless-stopped \
    --network openpero -p 127.0.0.1:18796:8787 \
    --memory 80m --memory-swap 80m --cpus 0.25 --pids-limit 64 \
    --read-only --cap-drop ALL --security-opt no-new-privileges \
    --log-opt max-size=5m --log-opt max-file=2 \
    --env-file /etc/openpero/server.env "openpero:$release" >/dev/null; then
    started=true
fi
ready=false
for ((i=0; i<30; i++)); do
    [[ $started == true ]] || break
    if curl -fsS --max-time 2 http://127.0.0.1:18796/healthz >/dev/null; then ready=true; break; fi
    sleep 1
done
if [[ $ready != true ]]; then
    docker logs --tail 25 openpero || true
    docker rm -f openpero >/dev/null 2>&1 || true
    if docker container inspect openpero-previous >/dev/null 2>&1; then
        docker rename openpero-previous openpero
        docker start openpero >/dev/null
    fi
    exit 1
fi
ln -sfn "/opt/openpero/releases/$release" /opt/openpero/current
install -m 700 maintenance.sh /opt/openpero/maintenance.sh
cat > /etc/cron.d/openpero <<'CRON'
SHELL=/bin/bash
PATH=/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * root flock -n /var/lock/openpero-backup.lock timeout 120 /opt/openpero/maintenance.sh backup >>/var/log/openpero-backup.log 2>&1
47 4 * * * root flock -n /var/lock/openpero-cert.lock timeout 300 /opt/openpero/maintenance.sh renew >>/var/log/openpero-cert.log 2>&1
CRON
chmod 644 /etc/cron.d/openpero
printf 'Healthy release %s\n' "$release"
