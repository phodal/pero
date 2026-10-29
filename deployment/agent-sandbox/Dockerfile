# Build from a reviewed, digest-pinned Debian-compatible runtime base. The base
# must contain /bin/sh, /bin/ps, coreutils and CA certificates, with a libc ABI
# compatible with the prebuilt Worker. No package installation, source checkout,
# provider login or cluster access takes place in this product image build.
ARG RUNTIME_BASE_IMAGE
FROM ${RUNTIME_BASE_IMAGE}
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/phodal/pero" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
COPY --chmod=0555 pero-worker pero-agent-acp /usr/local/bin/
COPY --chmod=0555 entrypoint.sh /usr/local/bin/pero-sandbox-entrypoint
COPY --chown=10001:10001 workspace/ /opt/pero/workspace/
RUN test -x /bin/ps && test -x /bin/sh && test -f /etc/ssl/certs/ca-certificates.crt \
 && test -s /opt/pero/workspace/.pero-workspace-revision \
 && /bin/ps -eo pid=,ppid=,pgid= >/dev/null
ENV HOME=/home/pero
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/pero-sandbox-entrypoint"]
