# Build stage
FROM rust:1.76 as builder
WORKDIR /usr/src/app
COPY . .
RUN cargo install --path .

# Runtime stage
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/cargo/bin/zippy-mesh-sidecar /usr/local/bin/zippy-sidecar
CMD ["zippy-sidecar"]
