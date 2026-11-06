# Explicit opt-in validation tools, never an implicit App dependency install.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ngspice python3 slurm-wlm procps openssh-server ca-certificates && rm -rf /var/lib/apt/lists/*
