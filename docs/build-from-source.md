# Build ZippyCoin Node from Source

This guide covers compiling the `zippycoin-node` binary from the Rust source included in the full ZippyMesh LLM Router repository.

> **Note**: The Rust sidecar source is available in the private repository (`BookingBill/ZippyMesh_LLM_Router`). Community edition users can download a pre-built binary from [the releases page](https://github.com/GoZippy/zippymesh-dist/releases/latest) instead.

---

## Prerequisites

### 1. Install Rust

```bash
# macOS / Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Windows — download rustup-init.exe from https://rustup.rs
```

Minimum Rust version: **1.77.2**

Verify:
```bash
rustc --version
cargo --version
```

### 2. Platform Build Dependencies

**Windows:**
```cmd
# Install Visual Studio Build Tools (C++ workload required)
# https://visualstudio.microsoft.com/visual-cpp-build-tools/
```

**macOS:**
```bash
xcode-select --install
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install build-essential pkg-config libssl-dev
```

---

## Build

From the repo root:

```bash
cd src-tauri
cargo build --release --bin zippycoin-node
```

The compiled binary will be at:
- **Windows**: `src-tauri/target/release/zippycoin-node.exe`
- **macOS / Linux**: `src-tauri/target/release/zippycoin-node`

Build time is typically 3–10 minutes depending on your machine.

---

## Install into ZMLR

Copy the compiled binary to the ZMLR standalone `bin/` directory:

**Windows:**
```cmd
copy src-tauri\target\release\zippycoin-node.exe .next\standalone\bin\zippycoin-node.exe
```

**macOS / Linux:**
```bash
cp src-tauri/target/release/zippycoin-node .next/standalone/bin/zippycoin-node
chmod +x .next/standalone/bin/zippycoin-node
```

Or point ZMLR at the build output directly via `.env`:
```env
ZIPPY_NODE_BIN=/absolute/path/to/src-tauri/target/release/zippycoin-node
```

---

## Verify

Restart ZMLR and open the Zippy Console. The "ZippyCoin Edge Node — Not Installed" card should disappear and the node status should show **idle** (ready to start).

To start the node, go to the Network tab in the Zippy Console and click **Start Node**.

---

## Workspace Structure

The Rust workspace lives at `src-tauri/` and includes:

| Crate | Purpose |
|-------|---------|
| `app` | Tauri desktop app shell |
| `edge-node` | P2P mesh node (ZippyCoin protocol) |
| `wallet-generator` | ZippyCoin HD wallet tooling |

The `zippycoin-node` binary is the `edge-node` crate compiled as a standalone executable.

---

## Cross-compilation

To build for a different target platform:

```bash
# Add target
rustup target add x86_64-unknown-linux-gnu

# Build
cargo build --release --bin zippycoin-node --target x86_64-unknown-linux-gnu
```

Common targets:
| Target | Platform |
|--------|---------|
| `x86_64-pc-windows-msvc` | Windows 64-bit |
| `x86_64-apple-darwin` | macOS Intel |
| `aarch64-apple-darwin` | macOS Apple Silicon |
| `x86_64-unknown-linux-gnu` | Linux 64-bit |

---

## Troubleshooting

**`error: linker 'link.exe' not found`** (Windows) — Install Visual Studio Build Tools with the C++ workload.

**`error[E0463]: can't find crate for 'std'`** — Run `rustup component add rust-std` for the target.

**OpenSSL errors** (Linux) — Install `libssl-dev` (Debian/Ubuntu) or `openssl-devel` (Fedora/RHEL).

**Slow build** — Use `cargo build` (debug) during development; only use `--release` for the final binary to deploy.
