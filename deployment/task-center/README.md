# Default Task Center

The canonical service origin is `https://app.openpero.com`. Desktop uses this
origin for a new connection; the URL field shows it as a placeholder and accepts
the default when left blank. Saved connections and explicit disconnects retain
priority. GitHub OAuth is enabled for Desktop sign-in. New GitHub accounts can
claim published coding tasks without private project or Worker grants. Scoped
Client tokens remain available for operator-provisioned private connections.

The Go control plane and PostgreSQL run independently of DSH on the existing
AWS machine. Nginx proxies to `127.0.0.1:18796`, preserving bearer authorization.
PostgreSQL has no host port. Execution Workers belong on separate machines.
This installation reads public `phodal/pero` Issues and root `ROADMAP.md` into
project `pero`, workspace key `pero`, Agent `codex`. Import does not dispatch;
automatic dispatch is disabled. The anonymous connector polls every 600 seconds.

## Deploy

Prerequisites: local Go, SSH and scp; remote Docker, Python 3, curl, Nginx and
the existing Certbot installation. The scripts target this Amazon Linux host.
Run the server's real PostgreSQL checks before deploying. The Go binary is built
locally from the exact committed revision, without compiling on the small host.

```sh
PERO_DEPLOY_SSH_TARGET=ec2-user@13.125.244.183 \
PERO_DEPLOY_SSH_KEY="$HOME/.ssh/phodalasia.pem" \
bash deployment/task-center/deploy.sh
```

`PERO_DEPLOY_REVISION` can select an existing commit. Release directories contain
the source revision, binary/CA hashes and build context. Credentials are generated
on first provision in root-only `/etc/openpero/server.env` and `postgres.env`.
Existing secrets and repository bindings are retained on redeploy. Edit the
server environment there to add OAuth or a dedicated GitHub read credential.

First-time TLS setup uses the HTTP server block from `nginx.conf` to serve
`/var/lib/letsencrypt`, requests the `app.openpero.com` webroot certificate, then
installs the complete vhost after the service is healthy. Test Nginx before a
graceful reload. Do not replace the existing DSH vhost or the public-site DNS.

The service runs as UID 10001 in a read-only image, with 80 MiB memory and 0.25 CPU.
PostgreSQL 17.11 Alpine has 128 MiB and 0.25 CPU, with its own network and
`/var/lib/openpero/postgres` data directory. Both restart unless explicitly stopped.
No source, Node runtime or Agent is installed in the server image.

## Credentials and clients

Provision Client credentials with the existing operator API, scoped to `pero`.
Never put the operator token in Desktop. This installation's initial client is
`Phodal Desktop`; its one-time credential is kept in root-only
`/etc/openpero/desktop-client.json`. The operator's local private copy is
`~/.config/openpero/task-center/client.json`; it is outside the repository.
Use Desktop's connection form to persist the token in OS-encrypted runtime
settings. Nonsecret metadata and ciphertext remain owned by the Host.

The public `/tasks` page shows reviewed community publications and imported goals
whose repositories GitHub has reported as public. Private repository and manual
tasks still require explicit publication. Public contribution responses contain
only the public goal and source metadata; private execution inputs remain private.
Importing or reading a source does not dispatch work.

## Desktop releases

The GitHub `Release` workflow builds macOS arm64 installers from a version tag and
publishes them as GitHub Release assets. The shipped default service is
`https://app.openpero.com`; no credentials or fixture origins are baked into the
App. Asset metadata records that service origin, the exact source revision and
the installer checksum. Local DMGs are development verification artifacts; public
downloads come from the workflow build.

## Recovery and maintenance

Deployment saves a pre-migration `pg_dump` under `/var/lib/openpero/backups`.
It keeps `openpero-previous` on upgrade and restores it if the new health check
fails. Database migrations are not automatically reversed: check schema
compatibility before manually switching an older binary. If restoring a dump is
necessary, stop the service first and review the desired recovery point.

Daily PostgreSQL dumps retain seven days; pre-deployment dumps remain until
explicitly removed. These backups are local to the host, not off-host recovery.
Certificate renewal targets only `app.openpero.com`; a successful renewal tests
and reloads Nginx. `/etc/cron.d/openpero` invokes both maintenance commands under
bounded locks/timeouts. Verify them manually after first installation:

```sh
sudo /opt/openpero/maintenance.sh backup
sudo /root/certenv/bin/certbot renew --cert-name app.openpero.com --dry-run \
  --non-interactive --no-random-sleep-on-renew
curl -fsS https://app.openpero.com/healthz
```

Check source status through the authenticated API and compare all task pages
with the pinned GitHub content. Restart the service, confirm Task IDs persist,
and verify a real Desktop can reconnect from encrypted settings. A dedicated
acceptance project/fixture Worker can verify the public execution path without
dispatching repository work or making model calls.
