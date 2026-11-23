FROM rust:1.95-bookworm AS computer
WORKDIR /src
COPY Cargo.toml .
COPY crates/pero-contracts crates/pero-contracts
COPY locales locales
COPY use/computer use/computer
# Cargo only needs the contracts package in the parent workspace for this build.
RUN sed -i 's/^members = .*/members = ["crates\/pero-contracts"]/g' Cargo.toml \
    && cargo build --locked --manifest-path use/computer/Cargo.toml \
    && install -m 755 use/computer/target/debug/pero-computer /pero-computer

FROM debian:bookworm-slim AS desktop
RUN apt-get update && apt-get install -y --no-install-recommends \
    at-spi2-core dbus fonts-dejavu-core mousepad openbox socat x11-utils x11vnc xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /bin/bash pero
COPY --from=computer /pero-computer /usr/local/bin/pero-computer
COPY --chmod=755 environments/linux-desktop/desktop.sh /usr/local/bin/pero-desktop
ENV DISPLAY=:1 HOME=/home/pero XDG_SESSION_TYPE=x11 \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/pero-desktop-dbus NO_AT_BRIDGE=0
WORKDIR /home/pero
USER pero
ENTRYPOINT ["/usr/local/bin/pero-desktop"]

FROM desktop AS blender
USER root
RUN apt-get update && apt-get install -y --no-install-recommends blender libgl1-mesa-dri \
    && rm -rf /var/lib/apt/lists/*
USER pero
ENV PERO_DESKTOP_APP=blender

FROM desktop
