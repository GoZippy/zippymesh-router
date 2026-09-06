# Build the Rust components from source

This guide covers compiling the **Rust** parts of ZippyMesh LLM Router.

> Building the **router itself** (the Node/Next.js app) is a different job —
> see [RUNNING.md](./RUNNING.md#first-install-from-source). ZMLR runs fully
> without any Rust component; everything here is optional.

*Audited against the tree on 2026-08-30. An earlier version of this page
described a `src-tauri` Cargo **workspace** with `edge-node` and
`wallet-generator` crates and a `zippycoin-node` binary. None of those exist in
this repository; the sections below reflect what is actually here.*

---

## What is actually in the tree

| Path | Crate | Produces | Used for |
|------|-------|----------|----------|
| `sidecar/` | `zippy-mesh-sidecar` | `zippy-mesh-sidecar[.exe]` | The mesh sidecar the app spawns and talks to over HTTP. This is the binary `scripts/prepare-standalone.cjs` copies into the bundle's `bin/`. |
| `src-tauri/` | `app` (single package, `[lib] app_lib`) | `app[.exe]` | The Tauri desktop shell. Not a workspace: no `edge-node`, no `wallet-generator`, and no `zippycoin-node` binary target. |

`src-tauri/target/release/` may also contain a stale `zippy-node[.exe]` left
over from an earlier layout — no `[[bin]]` target in `src-tauri/Cargo.toml`
produces it today, and nothing consumes it.

If you only want the router, you need **neither**. `prepare-standalone` logs
`[sidecar] Binary not found … skipping copy` and the build succeeds.

---

## Prerequisites

### 1. Rust

```bash
# macOS / Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Windows — download rustup-init.exe from https://rustup.rs
```

Minimum Rust version: **1.77.2** (`rust-version` in `src-tauri/Cargo.toml`).

```bash
rustc --version && cargo --version
```

### 2. Platform build dependencies

**Windows** — Visual Studio Build Tools with the **C++ workload**:
<https://visualstudio.microsoft.com/visual-cpp-build-tools/>

**macOS**
```bash
xcode-select --install
```

**Linux (Debian/Ubuntu)**
```bash
sudo apt install build-essential pkg-config libssl-dev
```

---

## Build the mesh sidecar

This is the one most people want — it is what the router bundle ships.

```bash
cd sidecar
cargo build --release
```

Output:
- **Windows**: `sidecar/target/release/zippy-mesh-sidecar.exe`
- **macOS / Linux**: `sidecar/target/release/zippy-mesh-sidecar`

There is also a convenience wrapper from the repo root:

```bash
npm run build:sidecar
```

### Install it into the router bundle

`npm run prepare-standalone` copies the binary automatically if it exists, so
the normal flow is:

```bash
npm run build:sidecar
npm run build            # prepare-standalone picks the binary up
```

To place it by hand:

**Windows**
```cmd
copy sidecar\target\release\zippy-mesh-sidecar.exe .next\standalone\bin\
```

**macOS / Linux**
```bash
cp sidecar/target/release/zippy-mesh-sidecar .next/standalone/bin/
chmod +x .next/standalone/bin/zippy-mesh-sidecar
```

Or point the app at a binary anywhere on disk via `.env`:

```env
ZIPPY_NODE_BIN=/absolute/path/to/zippy-mesh-sidecar
```

`sidecar/zippy-node-manager.js` checks `ZIPPY_NODE_BIN` first, then the
bundle's `bin/` directory.

### Sidecar authentication

Every sidecar route except `/health` and `/version` requires
`Authorization: Bearer <SIDE_CAR_SECRET>`. `npm run setup` generates and
persists that value; the app passes it to the sidecar it spawns. If you run the
sidecar yourself, set the **same** `SIDE_CAR_SECRET` in its environment — with
no secret set it fails closed (401) outside development.

---

## Build the Tauri desktop app

```bash
npm run tauri:build
```

That runs the frontend build, the sidecar build, then `tauri build`. To compile
just the Rust shell:

```bash
cd src-tauri
cargo build --release
```

---

## Verify

Restart ZMLR and open the Zippy Console. The "ZippyCoin Edge Node — Not
Installed" card should disappear and node status should show **idle**. Start it
from the Network tab.

---

## Cross-compilation

```bash
rustup target add x86_64-unknown-linux-gnu
cargo build --release --target x86_64-unknown-linux-gnu
```

| Target | Platform |
|--------|----------|
| `x86_64-pc-windows-msvc` | Windows 64-bit |
| `x86_64-apple-darwin` | macOS Intel |
| `aarch64-apple-darwin` | macOS Apple Silicon |
| `x86_64-unknown-linux-gnu` | Linux 64-bit |

Note that cross-compiling the **router** bundle is not possible this way: its
`better-sqlite3` native module is built for the host platform by `npm ci`.
Build each platform's release on that platform.

---

## Troubleshooting

**`error: linker 'link.exe' not found`** (Windows) — install Visual Studio
Build Tools with the C++ workload.

**`error[E0463]: can't find crate for 'std'`** — `rustup component add rust-std`
for the target.

**OpenSSL errors** (Linux) — install `libssl-dev` (Debian/Ubuntu) or
`openssl-devel` (Fedora/RHEL).

**Slow build** — use `cargo build` (debug) while developing; `--release` only
for the binary you deploy.
