---
kind: verification_report
date: 2026-10-28
---

# Default Task Center deployment

The canonical service origin is <https://app.openpero.com>. It shares the existing
AWS machine with DSH through its own Nginx vhost. The website domain's DNS was not
changed. The Go control plane and PostgreSQL have separate containers, credentials,
network and persistent database storage. Workers execute on other machines.

The initial server release was `20261028T114417Z-c000808b`, built locally from
committed source `c000808b85f99248e492dcf9df633585ff33df07`. No source build ran
on the small AWS machine. See the [runbook](../../deployment/task-center/README.md)
for deployment, credentials, resource limits, backups, certificate renewal and
rollback. The PostgreSQL image is fixed to 17.11 Alpine and its observed digest.

## Verified facts

- HTTPS `/healthz` returned 200 with database connectivity; unauthenticated task
  API requests returned 401. The HTTP vhost redirects to HTTPS and preserves the
  existing ACME challenge route.
- The signed certificate is for `app.openpero.com`, expiring 2027-01-26. A targeted
  Certbot staging renewal succeeded. A separate daily renewal command and daily
  database backup are installed in `/etc/cron.d/openpero`.
- Public `phodal/pero` intake imported 413 Tasks: two GitHub Issues and 411
  ROADMAP checkboxes, including 400 unchecked and 11 checked. All source Tasks
  remained undispatched. The project-scoped Client saw the same complete count
  as the operator; source sync reported complete coverage and no errors.
- A separate `deployment-acceptance` project exercised public HTTPS dispatch,
  a local independent Rust Worker, scripted ACP output, persisted events,
  completion and running cancellation. Its Tasks are hidden from the `pero`
  Client. Repeated verification attempts retain their explicitly labeled fixture
  Tasks/Runs; they do not contribute accepted work or community points.
- The normal local Desktop profile saved the `Phodal Desktop` Client credential
  through the Host and OS encryption. After closing and relaunching without cloud
  environment variables, it loaded the `pero` scope and opened Remote tasks.
  The plaintext token was not written to runtime preferences or diagnostics.
- Desktop now uses this service as its default connection origin. A blank URL
  accepts that default when the user explicitly saves a token; saved custom
  connections and explicit disconnects retain priority.
- Full Go race tests ran against a real isolated PostgreSQL database and passed;
  `go vet`, the complete generated-contract/theme/locale checks, the Wasm/web build
  and the actual Desktop encrypted-settings suite passed.

## Operational limits

GitHub login is deferred by user choice. Desktop uses project-scoped Pero Client
tokens. A production Worker is not registered to `pero`; actual source execution
requires provisioning and configuring an approved Worker. Fixture success proves
the deployed dispatch protocol, not model-provider behavior or business acceptance.

The public `/tasks` page remains an explicitly published community board. Source
import does not automatically publish Tasks there. Authorized Desktop/API users
can browse the full source inbox. No GitHub writes, source-task executions,
automatic dispatch, PR publication, task acceptance or points were created.

Backups are stored on this host; off-host disaster recovery is not established.
The shared host still has limited RAM/disk and an old operating system. This
deployment is a working first installation, not Kubernetes, sandboxed code
execution, a signed Desktop release or a load-tested multi-tenant service.

## Reproduce

Run Electron checks sequentially because they use native input focus.

```sh
PERO_DEPLOYMENT_E2E=1 npm run test:deployment
npm run test:remote-settings
```

The opt-in public suite reads private operator/client files from
`~/.config/openpero/task-center`, compares every source page with pinned GitHub
content, executes only its dedicated fixture project, and checks actual Desktop
input, encrypted restart, ROADMAP pagination, narrow/dark layouts and the public
community pages. Generated evidence lives in `test-results/deployment/` and is
ignored by Git. Credentials and binary captures are not committed.

During verification, the harness initially observed default connection metadata
before the canvas had painted the form. Waiting for rendered animation frames
before native input fixed the missed click. Public pagination also needs a longer
observable loading bound than a local fixture; the suite waits for loading to
finish rather than pausing for a fixed duration.
