# Build stage
FROM rust:latest as builder

WORKDIR /usr/src/app
COPY . .

# Install dependencies and build
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install OpenSSL (required for many Rust networking crates which link dynamically)
RUN apt-get update && apt-get install -y libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/src/app/target/release/zippy-mesh-sidecar /usr/local/bin/zippy-mesh-sidecar

# Expose internal API and P2P port
EXPOSE 9000 4001

CMD ["zippy-mesh-sidecar"]
