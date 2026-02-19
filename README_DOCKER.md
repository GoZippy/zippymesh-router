# ZippyMesh Docker Setup

This guide explains how to run the ZippyMesh LLM Router using Docker Compose. This setup includes the main application and a placeholder for the future "Zippy Sidecar" (P2P Node).

## Prerequisites

-   Docker Desktop (Windows/Mac) or Docker Engine (Linux)
-   `docker-compose` (usually included with Docker Desktop)

## Quick Start

1.  **Start the Stack**:
    ```bash
    docker-compose up -d --build
    ```

2.  **Access the Dashboard**:
    Open [http://localhost:20128/dashboard](http://localhost:20128/dashboard) in your browser.
    *   Default Password: `123456`

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
| `JWT_SECRET` | `zippy_mesh_secret_key_change_me` | Secret for signing session tokens. |
| `INITIAL_PASSWORD` | `123456` | Password for the first login. |

## Data Persistence

All configuration (providers, models, API keys) is stored in the `zippy-data` Docker volume. This means your data survives container restarts and upgrades.
