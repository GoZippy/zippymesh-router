# Security Policy

## Trust Model

- **No telemetry.** The router does not phone home or send usage analytics.
- **No inference logging by default.** Prompts and responses are not logged unless you explicitly enable `ENABLE_REQUEST_LOGS`.
- **Keys stay local.** Provider credentials and OAuth tokens are stored in your local user-data directory; they never traverse the network except to the upstream provider you configured them for.
- **Local-first.** All routing decisions happen on the device running the router. Nothing about your traffic is observed by Zippy Technologies infrastructure.

## Production Deployment

When running ZMLR for anything other than local development, follow these guardrails:

1. **Generate a strong `JWT_SECRET`** — at least 32 random characters. The provided defaults are placeholders only and unsafe in production. Generate with `openssl rand -base64 48` or your preferred CSPRNG.
2. **Change `INITIAL_PASSWORD`** on first login. Never deploy with the default.
3. **Verify the interface you are actually bound to** — see "Network exposure" below. Do not assume it is loopback.
4. **Use HTTPS** when the dashboard is reachable from outside the host. Terminate TLS at a reverse proxy (nginx, Caddy, Traefik) or use a tunnel (Cloudflare, Tailscale).
5. **Lock down `data/`** — the user-data directory contains encrypted-at-rest credentials, but file-system access still grants tampering capability. Restrict permissions to the application's runtime user.
6. **Audit virtual-key budgets** — virtual keys (`zm_live_…`) carry token and dollar budgets. Set realistic ceilings to bound the cost of a compromised key.

## Network Exposure

ZMLR's authorisation model assumes the router is reachable only by people you
trust. Read this section before binding it to anything other than loopback.

### Two settings decide almost everything

| Setting | Where | Effect |
|---|---|---|
| `requireLogin` | dashboard → Profile, or `PATCH /api/settings` | When `false` ("open" mode), **every caller is treated as a superadmin**. The edge auth gate is skipped and role checks return the top role. This is a deliberate convenience for a single-user install on loopback. It is not an access-control posture. |
| bind host | `ZIPPY_BIND_HOST`, else `HOST`, else `127.0.0.1` | Which interfaces the HTTP port accepts connections on. |

**Never combine `requireLogin: false` with a non-loopback bind.** In that
configuration any host that can reach the port can read and rewrite your
provider credentials, mint API keys, write your `~/.claude` and `~/.codex`
config files, control the node process, and shut the router down — without
authenticating. Enable login *before* you expose the port, not after.

> **Fixed in 1.3.1 — the built server binds loopback by default.** An earlier
> revision of this page carried a "Known issue" saying the server produced by
> `npm run build` ignored `ZIPPY_BIND_HOST` and `HOST`, read only `HOSTNAME`,
> and defaulted to `0.0.0.0`. That was true when it was written and stopped
> being true minutes later. `scripts/prepare-standalone.cjs` now injects a
> preamble into `.next/standalone/server.js` that resolves
> `ZIPPY_BIND_HOST > HOST > HOSTNAME > 127.0.0.1`, warns loudly on a
> non-loopback bind, and **fails the build** if the patch cannot be applied — so
> a bundle that ignores those variables cannot be produced. The loopback default
> documented above applies to `npm run dev`, `npm start` **and** the built
> standalone server. Verifying with `netstat -an` / `ss -ltn` is still good
> practice before exposing a port; setting `HOSTNAME=127.0.0.1` is no longer
> required.
>
> The same applies to the port. `ZIPPY_PORT` **is** read (`PORT` wins if both
> are set) and the default is **20128**, the port mesh discovery advertises —
> not 3000.

**Docker is the exception, deliberately.** `Dockerfile` and
`docker-compose.yml` set `HOST=0.0.0.0`, because a container process bound to
its own loopback is unreachable from the host. The containment there is the
published port — `docker-compose.yml` maps `127.0.0.1:20128:20128` — not the
bind. See [README_DOCKER.md](README_DOCKER.md).

### Reaching the router from other machines

The minimum safe configuration:

1. **`requireLogin: true`**, with a password set through the setup wizard
   *before* the first non-loopback bind. The first-run window is
   unauthenticated by design so the wizard can complete; do not leave it open
   on a network.
2. **`requireApiKey: true`** (dashboard → Profile). This gates the
   OpenAI-compatible surface (`/v1/chat/completions`, `/v1/messages`,
   `/v1/responses`, `/v1beta/models/*`). It defaults to **off**, which means
   anyone who can reach the port can spend your provider credits.
3. **A distinct `API_KEY_SECRET`** alongside `JWT_SECRET`. Both now
   self-provision on first start: `bootstrapEnv.cjs` generates each one into
   `<data dir>/bootstrap.secret` (mode 0600) if it is not already set, and
   reuses it on every later start. An explicit value from `.env` or the service
   manager always wins and is never written to disk. Set both explicitly, to
   the *same* values on every instance, if you run more than one replica behind
   a load balancer — otherwise each replica mints its own and sessions appear to
   expire at random. (An earlier revision of this page said an unset
   `API_KEY_SECRET` meant "cookie auth only"; that stopped being true in
   `4726f6da`.)
4. **TLS at a reverse proxy**, and `TRUST_PROXY=1` **only** if that proxy
   overwrites the forwarding headers (see below).
5. **Firewall UDP 20129** unless you want mesh discovery. The discovery beacon
   broadcasts this node's address and model list to the local network, so an
   exposed node advertises itself rather than waiting to be found.
6. Prefer an authenticated overlay network (Tailscale, WireGuard) over a bare
   LAN bind. Route-level authorisation is still being hardened; an overlay
   gives you an access-control layer that does not depend on it.

### `TRUST_PROXY` and client addresses

Next.js route handlers receive a `Request`, not a socket — there is no peer
address, only headers, and headers are written by whoever connects. ZMLR
therefore treats the client address as **either** asserted by infrastructure you
vouched for **or** unknown; there is no middle setting.

- **`TRUST_PROXY` unset (default)** — `x-forwarded-for` and `x-real-ip` are
  ignored entirely. Every caller shares one rate-limit bucket, and no
  address-based allowance applies. Correct whenever clients connect directly.
- **`TRUST_PROXY=1`** — the first hop of `x-forwarded-for` (else `x-real-ip`) is
  taken as the client address. It is then used for per-client rate limiting and
  for the `trustedLanCidrs` allowance, which lets addresses in
  `10.0.0.0/16`, `127.0.0.0/8` and `::1/128` skip the API key.

Only set `TRUST_PROXY=1` when a reverse proxy you control **overwrites**
`x-forwarded-for` rather than appending to it. Caddy and
`proxy_set_header X-Forwarded-For $remote_addr` in nginx overwrite; nginx's
`$proxy_add_x_forwarded_for` appends, which would let a remote client choose the
address ZMLR believes — and with it, the API-key allowance.

## Supply-Chain Hygiene

- Each release is built reproducibly from a tagged commit. The publish workflow gates on `validate-open-core.cjs` to confirm no internal-only material is in the open-core tree.
- Tauri installers are produced by `release-tauri.yml` running in a matrix across Windows, macOS, and Linux GitHub Actions runners. They are not signed by an Apple Developer certificate at this time; macOS users must approve the build via right-click → Open. Windows installers are NSIS-bundled and unsigned.
- All third-party Node and Rust dependencies are pinned in `package-lock.json` and `Cargo.lock`. Run `npm audit` and `cargo audit` (if installed) before releasing.

## Reporting Vulnerabilities

Please report security issues privately. **Do not** open public GitHub issues for vulnerabilities.

- **Email:** `security@gozippy.com`
- **PGP key:** available on request at the same address. Encrypted reports are appreciated for high-severity issues.
- **Response SLA:** we aim to acknowledge within 72 hours and provide a remediation plan within 14 days for medium and higher severity reports.

When reporting, please include:

- Affected version and platform.
- Steps to reproduce or proof-of-concept code.
- Impact and any suggested fix or mitigation.
- Whether you would like to be credited in the fix advisory.

Good-faith security research that does not exfiltrate user data and that respects the responsible-disclosure timeline above is welcome and will not be pursued legally.

## Scope

In-scope for this policy:

- The router binary and dashboard distributed under this repository.
- The Rust sidecar shipped with the desktop app.
- Build, release, and supply-chain workflows under `.github/workflows/`.

Out-of-scope:

- Vulnerabilities in upstream providers (OpenAI, Anthropic, Google, etc.) — report to those vendors directly.
- Social-engineering of Zippy Technologies staff or customers.
- Denial-of-service attacks against demo or community infrastructure.
- Issues that require physical access to the user's machine.
