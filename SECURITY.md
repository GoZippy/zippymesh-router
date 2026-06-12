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
3. **Bind to localhost by default.** Only expose the router beyond `127.0.0.1` after you have configured authentication and TLS.
4. **Use HTTPS** when the dashboard is reachable from outside the host. Terminate TLS at a reverse proxy (nginx, Caddy, Traefik) or use a tunnel (Cloudflare, Tailscale).
5. **Lock down `data/`** — the user-data directory contains encrypted-at-rest credentials, but file-system access still grants tampering capability. Restrict permissions to the application's runtime user.
6. **Audit virtual-key budgets** — virtual keys (`zm_live_…`) carry token and dollar budgets. Set realistic ceilings to bound the cost of a compromised key.

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
