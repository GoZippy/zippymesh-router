# ZippyMesh Docker Setup

This guide explains how to run the ZippyMesh LLM Router using Docker Compose. This setup includes the main application and a placeholder for the future "Zippy Sidecar" (P2P Node).

## Prerequisites

-   Docker Desktop (Windows/Mac) or Docker Engine (Linux)
-   `docker-compose` (usually included with Docker Desktop)

## Quick Start

1.  **Set the three required secrets**, then start the stack:
    ```bash
    export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    export SIDE_CAR_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    export INITIAL_PASSWORD='choose-a-real-password'
    docker-compose up -d --build
    ```
    `docker-compose.yml` uses `${VAR:?...}` for all three, so compose refuses to
    start rather than boot with a guessable default.

2.  **Access the Dashboard**:
    Open [http://localhost:20128/dashboard](http://localhost:20128/dashboard) in your browser.
    *   Password: whatever you set as `INITIAL_PASSWORD` above.

3.  **View Logs**:
    ```bash
    docker-compose logs -f
    ```

4.  **Stop the Stack**:
    ```bash
    docker-compose down
    ```

## Architecture

The `docker-compose.yml` defines two services:

1.  **`zippy-router`**: The Next.js application (LLM Router).
    *   Exposes port `20128`.
    *   Mounts a persistent volume `zippy-data`.
2.  **`zippy-sidecar`**: A placeholder service (currently running Alpine Linux).
    *   Connects to the same internal network `zippy-net`.
    *   Will be replaced by the Rust-based ZippyCoin Node in Phase 2.

## Environment Variables

You can configure the router by creating a `.env` file in this directory (it will be picked up by docker-compose if you uncomment the `env_file` section or pass variables manually).

| Variable | Default | Description |
| :--- | :--- | :--- |
| `JWT_SECRET` | *(required — compose refuses to start without it)* | Secret for signing session tokens. |
| `INITIAL_PASSWORD` | *(required — compose refuses to start without it)* | Password for the first login. |
| `SIDE_CAR_SECRET` | *(required)* | Shared bearer both services authenticate with. |
| `HOST` | `0.0.0.0` | Bind address **inside the container**. See below. |
| `ZIPPY_PORT` | `20128` | Listen port inside the container. |
| `DATA_DIR` | `/app/data` | Store location, backed by the `zippymesh-data` volume. |

## Networking: why the container binds `0.0.0.0`

The standalone server this image runs defaults to **`127.0.0.1`** — the right
default for a laptop install, and the wrong one for a container: a process bound
to the container's own loopback is unreachable from the host, so every published
port refuses the connection.

So both `Dockerfile` and `docker-compose.yml` set `HOST=0.0.0.0` explicitly.
**The containment is the publish, not the bind.** `docker-compose.yml` maps

```yaml
ports:
  - "127.0.0.1:20128:20128"   # reachable from THIS machine only
```

To expose the node to your network, change that mapping to
`"0.0.0.0:20128:20128"` — and enable login at `/setup` first. Do not "harden" by
setting `HOST=127.0.0.1`: that does not restrict who can reach the node, it just
makes the container unreachable from everywhere including the host.

`ZIPPY_BIND_HOST` takes precedence over `HOST` if you set it, and the resolution
order is `ZIPPY_BIND_HOST > HOST > HOSTNAME > 127.0.0.1`
(`scripts/prepare-standalone.cjs`).

## Data Persistence

All configuration (providers, models, API keys) is stored in the `zippy-data` Docker volume. This means your data survives container restarts and upgrades.
