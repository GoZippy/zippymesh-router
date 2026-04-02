# ZippyMesh LLM Router Architecture

This document describes the high-level architecture of the ZippyMesh LLM Router and how its components interact.

## Components

### 1. Dashboard (Next.js 15)
- **Frontend**: React-based UI for managing providers, models, playbooks, and viewing usage metrics.
- **API Engine**: Next.js App Router API endpoints that handle local database interaction, provider discovery, and OAuth flows.
- **Routing Logic**: Core intelligence that decides which provider/model to use based on playbooks and real-time state.

### 2. Node Manager Sidecar (Node.js)
- **Process**: A persistent background process (`zippy-node-manager.js`) that manages the lifecycle of the P2P node.
- **Responsibilities**: 
  - Starting/stopping the native `zippy-node` binary.
  - Buffering and streaming node logs.
  - Aggregating network health and peer statistics via RPC polling.
  - Exposing an internal API for the dashboard to control the node.

### 3. Native P2P Node (Go/C++)
- **Binary**: `zippy-node`
- **Responsibilities**: 
  - Participating in the ZippyMesh P2P network.
  - Handling low-level networking, protocol versioning, and peer trust management.
  - Providing an RPC interface for local interaction.

### 4. Local Database (LowDB)
- **Storage**: JSON-based storage (`db.json`) located in the user's home directory.
- **Data**: Stores provider connections, model aliases, playbooks, settings, and encrypted tokens (where applicable).

## Data Flow

### Request Routing
1. User sends a message via the dashboard or external API.
2. The Routing Engine evaluates active Playbooks.
3. It selects the best available Provider Connection based on priority, cost, and latency.
4. If the provider fails, the failover logic kicks in and attempts the next best option.

### Node Management
1. Dashboard sends a "Start Node" command to the API.
2. API communicates with the Sidecar via local HTTP.
3. Sidecar spawns the `zippy-node` process and begins log capture.
4. Dashboard polls the Sidecar for real-time health and log updates.

## Security Model

- **Local-First**: All sensitive data (API keys, OAuth tokens) stays on the user's machine unless Explicitly synced to Cloud.
- **Redaction**: API endpoints redact sensitive fields from responses before sending them to the UI.
- **Environment Variables**: Core app secrets are loaded via environment variables or a local `.env.local` file.
- **Tauri Sandbox (Planned)**: Future native builds will run in a sandboxed environment with restricted filesystem and network access.

## Cross-Platform Readiness

The application is designed to be packaged as a native app using **Tauri**:
- **Windows/Mac/Linux**: Standalone desktop application with embedded Node.js sidecar.
- **Mobile (iOS/Android)**: Mobile application with the sidecar logic integrated into the native runtime or a background service.
