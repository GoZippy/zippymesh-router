# ZippyCoin Edge Node Setup

The ZippyCoin edge node is an **optional** component. ZippyMesh LLM Router works fully for AI routing without it. Install the node only if you want to:

- Participate in the ZippyCoin mesh network
- Earn routing rewards in ZIP tokens
- Run as a relay or validator node
- Contribute bandwidth to the decentralized inference network

---

## How It Works

The edge node (`zippycoin-node`) is a Rust binary that runs as a sidecar alongside ZMLR. It handles:

- **P2P discovery** — finding and connecting to other mesh nodes
- **Block sync** — keeping up with the ZippyCoin chain
- **Routing rewards** — recording inference requests for on-chain settlement
- **Validator duties** — (optional, stake required)

ZMLR manages the node process lifecycle automatically via the Zippy Console.

---

## Prerequisites

- ZippyMesh LLM Router v1.0.0 or later, running and accessible
- A funded ZippyCoin wallet (for validator mode — edge/relay mode is free)
- Firewall ports open: **9480** (P2P), **8545** (RPC, local only)

---

## Option 1 — Download Pre-built Binary (Recommended)

1. Go to the [latest release](https://github.com/GoZippy/zippymesh-dist/releases/latest)
2. Download the binary for your platform:
   - **Windows**: `zippycoin-node-windows-x64.exe`
   - **macOS (Apple Silicon)**: `zippycoin-node-macos-arm64`
   - **macOS (Intel)**: `zippycoin-node-macos-x64`
   - **Linux (x64)**: `zippycoin-node-linux-x64`
3. Place it in the `bin/` folder inside your ZMLR standalone directory:

```
zippymesh/
  .next/standalone/
    bin/
      zippycoin-node.exe    ← Windows
      zippycoin-node        ← macOS / Linux
    server.js
    run.js
```

4. On macOS/Linux, make it executable:
```bash
chmod +x .next/standalone/bin/zippycoin-node
```

5. Restart ZMLR. The Zippy Console will show the node as available.

---

## Option 2 — Custom Binary Path

If you have the binary elsewhere, set `ZIPPY_NODE_BIN` in your `.env`:

```env
ZIPPY_NODE_BIN=/usr/local/bin/zippycoin-node
```

ZMLR will use that path instead of the default `bin/` folder.

---

## Option 3 — Build from Source

See [build-from-source.md](./build-from-source.md) for instructions on compiling the Rust binary yourself.

---

## Starting the Node

Once the binary is in place:

1. Open the dashboard: `http://localhost:20128/dashboard`
2. Open the **Zippy Console** (bottom of the screen)
3. Go to the **Network** tab
4. Click **Start Node** → choose mode:
   - **Edge** — lightweight, no stake required (recommended for most users)
   - **Relay** — routes traffic for other nodes, earns relay fees
   - **Validator** — requires staked ZIP, earns block rewards

---

## Node Modes

| Mode | Stake Required | Bandwidth | Rewards |
|------|---------------|-----------|---------|
| Edge | None | Low | Routing fees |
| Relay | None | Medium | Relay fees |
| Validator | Yes (ZIP) | High | Block rewards + fees |

---

## Ports & Firewall

| Port | Protocol | Purpose |
|------|----------|---------|
| 9480 | TCP | P2P mesh communication |
| 29480 | TCP | P2P (alternate) |
| 8545 | TCP | RPC (local only — do not expose) |

On Windows, open port 9480:
```cmd
netsh advfirewall firewall add rule name="ZippyCoin P2P" dir=in action=allow protocol=TCP localport=9480
```

On Linux:
```bash
sudo ufw allow 9480/tcp
```

---

## Troubleshooting

**Binary not found error** — Check the binary is at the expected path shown in the Zippy Console error card, or set `ZIPPY_NODE_BIN` in `.env`.

**Node starts but shows 0 peers** — Confirm port 9480 is open in your firewall. The bootstrap peer at `10.0.97.100:30303` must be reachable.

**Node exits immediately** — Check the Logs tab in Zippy Console for the exit reason. Common causes: port already in use, missing data directory permissions.

---

## Monitoring

The Zippy Console Network tab shows live stats once the node is running:
- Block height and sync status
- Connected peer count
- Trust score
- Bandwidth usage (upload/download)
- Peer list with trust scores and block/drop controls
