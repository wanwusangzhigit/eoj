# Multi-stage build for a lightweight but complete toolchain image.
# Contains: nsjail, gcc/g++, python3, openjdk, nodejs, golang, rust.

# Stage 1: Build nsjail from source
FROM debian:bookworm-slim AS nsjail-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git protobuf-compiler libprotobuf-dev \
    libnl-3-dev libnl-route-3-dev libcap-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 3.4 https://github.com/google/nsjail.git /tmp/nsjail \
    && cd /tmp/nsjail && make && cp nsjail /tmp/

# Stage 2: Runtime image with all language toolchains
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

# Copy nsjail binary
COPY --from=nsjail-builder /tmp/nsjail /usr/local/bin/nsjail

# Install compilers and runtimes
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ make \
    python3 python3-pip \
    default-jdk \
    golang-go \
    rustc cargo \
    time curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Verify
RUN nsjail --version | head -1 \
    && gcc --version | head -1 \
    && python3 --version \
    && java -version 2>&1 | head -1 \
    && node --version \
    && go version \
    && rustc --version

# Ensure nobody user exists
RUN id -u nobody >/dev/null 2>&1 || useradd -M -u 65534 -s /sbin/nologin nobody

WORKDIR /judge
