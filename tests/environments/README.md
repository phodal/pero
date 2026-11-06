# Explicit local environment acceptance resources

These are opt-in fixtures for ADR 0030, not bundled production environments.
Keep images, keys, overlays, kubeconfig and results in ignored `test-results/`.
Select a Docker context explicitly; never switch the user's default context.

Build the scientific tools image with an explicitly selected Ubuntu 24.04 base:

```sh
docker --context "$PERO_TEST_DOCKER_CONTEXT" build --platform linux/amd64 \
  --build-arg BASE_IMAGE=ubuntu:24.04 -f tests/environments/Dockerfile \
  -t pero-compute-validation:20261106 tests/environments
```

The image includes Python, ngspice and Slurm. Docker acceptance resolves the local
platform image and records the identities actually returned by the daemon. It
never silently pulls during method dispatch. Use a test output directory shared
with the selected Docker daemon (Colima may not share macOS `/var/folders`).

```sh
PERO_TEST_COMPUTE_ROOT="$PWD/test-results/compute" \
PERO_TEST_DOCKER_IMAGE=pero-compute-validation:20261106 \
PERO_TEST_DOCKER_PLATFORM=linux/amd64 \
node scripts/cargo.mjs test --locked -p pero-runtime compute::tests --lib -- --include-ignored
# Same variables, actual ngspice + SQLite Use evidence:
node scripts/cargo.mjs test --locked -p pero-host environment_execution -- --include-ignored --nocapture
```

For a disposable single-node Slurm fixture, start `slurm-start.sh` inside the
validation image with an **internal Docker bridge network**, without published
ports. A `none` network has no non-loopback address and Slurm's address discovery
fails. cgroup v1 is selected only to load the plugin; task/proctrack enforcement
uses `task/none` and `proctrack/linuxproc`. This fixture proves submission,
allocation, execution and cancellation, not cgroup limits, MPI, multi-node
behavior, accounting durability or a production site policy. Its node registers
8 logical CPUs and 512 MiB; this declaration is not a container resource limit.
Stop/remove only the container and internal network created for this fixture.

The live QEMU acceptance uses the official Alpine 3.22.6 aarch64 cloud-init image,
verified against its published SHA-512, a separate qcow2 overlay, and a generated
SSH key. SSH is forwarded on an OS-selected loopback port. Never commit the key,
base image, writable disk, or kubeconfig. The KubeVirt fixture uses a separate k3d
cluster with default kubeconfig/context updates disabled. Software emulation,
when selected, must be reported explicitly and is not hardware KVM acceptance.
