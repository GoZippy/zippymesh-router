# `zvault run` — ZippyVault secrets in a child process's environment

`zvault` is a small, dependency-free launcher that fetches secrets from a
running ZMLR instance's **ZippyVault** and puts them into the environment of a
command it starts — and nowhere else. It is the `op run` / `doppler run`
pattern for ZippyVault.

```bash
ANTHROPIC_API_KEY='zvault://anthropic-api-key' zvault run -- claude
```

`claude` gets a real `ANTHROPIC_API_KEY`. Your shell, your shell history, your
`.env` files, your dotfiles repo and the agent's own transcript never see the
value: the reference is what is written down; the secret only ever exists in
the vault, in `zvault`'s memory for the moment it takes to spawn, and in the
child process's environment block.

- Node ≥ 20. Windows, macOS and Linux. No npm dependencies.
- Talks only to the two frozen vault token routes over loopback.
- Never accepts a token as a command-line argument.
- Writes no temp files, no cache, no plaintext to disk.

---

## Install

The CLI is a single file, `bin/zvault.mjs`.

```bash
# From a ZMLR checkout, no install at all:
node bin/zvault.mjs check

# Or, once package.json exposes the bin (see "Packaging" below):
npm i -g .          # in the ZMLR checkout
zvault check
```

A shell alias works just as well if you would rather not install globally:

```bash
alias zvault='node /path/to/ZippyMesh_LLM_Router/bin/zvault.mjs'
```

```powershell
# PowerShell profile
function zvault { node C:\path\to\ZippyMesh_LLM_Router\bin\zvault.mjs @args }
```

---

## Issue a scoped agent token

`zvault` authenticates with a **ZippyVault agent token**: scoped to specific
entries (or `*`), revocable, optionally time-limited, stored server-side as a
SHA-256 hash. It is not your master password and it cannot unlock the vault.

**In the dashboard:** ZMLR → **Vault** → **Agent tokens** → *Issue token*.
Choose the entries the tool actually needs, set an expiry, copy the token once.

**Or over the API** (session-authenticated):

```bash
curl -sS http://127.0.0.1:20128/api/vault/tokens \
  -H 'content-type: application/json' \
  --cookie "$ZMLR_SESSION_COOKIE" \
  -d '{"name":"claude-code","scopes":["anthropic-api-key"],"ttlDays":90}'
```

Then hand it to `zvault` **out of band** — never on a command line:

```bash
# Preferred: a file with tight permissions
umask 077 && printf '%s' 'zvt_...' > ~/.zvault-token
export ZIPPYVAULT_TOKEN_FILE=~/.zvault-token

# Or straight in the environment
export ZIPPYVAULT_TOKEN='zvt_...'
```

```powershell
# Windows
'zvt_...' | Set-Content -NoNewline "$env:USERPROFILE\.zvault-token"
$env:ZIPPYVAULT_TOKEN_FILE = "$env:USERPROFILE\.zvault-token"
```

`zvault --token …` is **refused with exit 2** on purpose: an argument lands in
shell history and is visible to every process on the machine via the process
list.

---

## Configuration

Resolved highest-precedence first:

| Setting | Flag | Environment | Config file |
|---|---|---|---|
| Server URL | `--url` | `ZIPPYVAULT_URL` | `url` (default `http://127.0.0.1:20128`) |
| Token | *(none — refused)* | `ZIPPYVAULT_TOKEN` | — |
| Token file | `--token-file` | `ZIPPYVAULT_TOKEN_FILE` | `tokenFile` |
| Request timeout | `--timeout <ms>` | — | — (default 10000) |

The config file is the one named by `--config <path>`, else `~/.zvault.json` in
your home directory:

```json
{
  "url": "http://127.0.0.1:20128",
  "tokenFile": "~/.zvault-token"
}
```

> **A repo-local `./.zvault.json` is deliberately ignored.** It can set both
> `url` and `tokenFile`, the two levers that would redirect the vault token to
> another host or read an arbitrary file, so a **cloned/hostile repo must never
> influence them**. Only `--config <path>` (an explicit operator choice) or your
> own `~/.zvault.json` may set `url` / `tokenFile`. Never commit a token file.

---

## Reference syntax

A variable is a reference when its **entire value** is one of:

```
zvault://<entry-name>
{{zvault:<entry-name>}}
```

Substrings are not interpolated — a value that merely mentions the scheme is
left alone. Both forms are equivalent; `{{zvault:…}}` is friendlier in YAML and
JSON where `://` sometimes needs quoting.

Three ways to declare what to resolve:

```bash
# 1. In the environment you already have (shell, .env you sourced, CI secrets)
export DATABASE_URL='zvault://prod-dsn'
zvault run -- ./migrate.sh

# 2. Explicit per-variable mapping
zvault run --env OPENAI_API_KEY=openai-key --env DATABASE_URL=prod-dsn -- ./app

# 3. A map file (names and entries only, no values)
cat zvault.map.json
{ "OPENAI_API_KEY": "openai-key", "DATABASE_URL": "prod-dsn" }
zvault run --map zvault.map.json -- ./app
```

Precedence when the same NAME appears more than once: inherited reference <
`--map` < `--env`. Entries are de-duplicated, so ten variables pointing at one
entry cost one vault read. Reads run with a small concurrency cap.

A map file (or `--env`, or a `zvault://` reference in the environment) may **not**
target the variables that steer how the child finds its own executable or loads
code — `PATH`, `PATHEXT`, `NODE_OPTIONS`, `LD_PRELOAD`/`LD_LIBRARY_PATH` and the
`DYLD_*` family. Setting one is refused with exit 2, so a committed map file
cannot turn a vault read into code execution.

---

## Commands

### `zvault run [options] -- <command> [args...]`

Resolves everything, then spawns the command with `stdio` inherited and exits
with the child's exit code (or `128 + signal` if it died on a signal).

| Option | Meaning |
|---|---|
| `--env NAME=entry` | map one variable; repeatable; `entry` may be bare or a full reference |
| `--map file.json` | JSON object `{ "NAME": "entry" }` |
| `--strict` | **default** — fail *before spawning* if any reference cannot be resolved |
| `--no-strict` | leave unresolved references as their literal text, warn on stderr, run anyway |
| `--dry-run` | print which NAMEs would resolve from which entries, then exit 0. Makes **no** vault request and prints no values |
| `--strip-token` | remove `ZIPPYVAULT_TOKEN` / `ZIPPYVAULT_TOKEN_FILE` from the child's environment |

```bash
$ zvault run --dry-run --env OPENAI_API_KEY=openai-key -- claude
zvault 0.1.0 — dry run (no vault requests, nothing spawned)
command: claude
would resolve 2 variable(s) from 2 vault entries:
  ANTHROPIC_API_KEY <- anthropic-api-key
  OPENAI_API_KEY    <- openai-key
(values are never printed; strict=true)
```

By default the child inherits `ZIPPYVAULT_TOKEN` if you had it exported — the
same as if you had launched the command yourself. `--strip-token` removes it,
which is worth doing for a tool that has no business talking to the vault
directly.

### `zvault check`

One-shot diagnosis of the whole path.

```
$ zvault check
server:  http://127.0.0.1:20128
status:  reachable
token:   accepted (scopes: *)
vault:   unlocked
entries: 3 in scope
  - anthropic-api-key
  - openai-key
  - prod-dsn
```

Exit 0 unlocked · 3 locked · 4 token rejected · 6 unreachable.

### `zvault list`

Names, labels and categories the token may read. Metadata only — this never
performs a read and never prints a value. Works while the vault is locked
(entry metadata is stored in the clear); warns if reads would currently fail.

### `zvault get <entry> --stdout`

The escape hatch for a shell that genuinely needs the value:

```bash
export GH_TOKEN="$(zvault get github-token --stdout)"
```

Guard rails: `--stdout` is mandatory (without it, exit 2), the value is refused
when stdout is a terminal unless you add `--force-tty`, and a warning always
goes to stderr. The value is written raw with no trailing newline, so `$( )`
and `> file` both get exactly the secret. **Prefer `zvault run --`** — this
command puts the secret in your shell, which is the thing `run` exists to
avoid.

---

## Wiring it into the tools

### Claude Code

```bash
export ANTHROPIC_API_KEY='zvault://anthropic-api-key'
zvault run -- claude
```

Everything Claude Code spawns (hooks, MCP servers, your build commands)
inherits the resolved environment, so one wrapper covers the whole session.

### Cursor / Kilo / any MCP client

Wrap the server command in `mcp.json` (or `.cursor/mcp.json`,
`.kilocode/mcp.json`) instead of pasting the key into the config file:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "zvault",
      "args": ["run", "--env", "API_KEY=my-service-key", "--", "node", "server.js"]
    }
  }
}
```

The config that gets committed names the entry; the key never appears in it.
If `zvault` is not on the client's PATH, use the absolute path to `node` and
`bin/zvault.mjs`:

```json
{
  "command": "node",
  "args": ["/abs/path/ZippyMesh_LLM_Router/bin/zvault.mjs", "run", "--", "node", "server.js"]
}
```

On Windows `zvault run -- npm …` / `npx …` works: `zvault` resolves `.cmd` and
`.bat` shims itself through `PATHEXT` and invokes them via `cmd.exe /d /s /c`
with proper two-layer quoting. It never uses `shell: true` with your arguments.

### A plain script

```bash
#!/usr/bin/env bash
set -euo pipefail
exec zvault run --map ./zvault.map.json -- ./deploy.sh "$@"
```

### CI

`zvault` needs to reach a ZMLR instance, so in CI it fits a self-hosted runner
that already runs one (or reaches one over a private network):

```yaml
- name: Deploy
  env:
    ZIPPYVAULT_URL: http://<zmlr-host>:20128
    ZIPPYVAULT_TOKEN: ${{ secrets.ZIPPYVAULT_AGENT_TOKEN }}
    DATABASE_URL: zvault://prod-dsn
  run: node bin/zvault.mjs run --strip-token -- ./deploy.sh
```

Issue a CI token scoped to exactly the entries that job needs, with a short
TTL, and revoke it from the dashboard when the job is retired.

---

## Exit codes

| Code | Meaning |
|---|---|
| `0` | success — for `run`, the child exited 0 |
| *child's* | `run` passes the child's exit code through; `128 + signal` if it was signalled |
| `2` | usage error (bad flag, no `--`, `--token` refused, `get` without `--stdout`) |
| `3` | the vault is **locked** — unlock it in the dashboard or `POST /api/vault {action:'unlock'}` |
| `4` | the token was rejected: invalid, revoked or expired — issue a new one |
| `5` | entry not found, or outside this token's scope — `zvault list` shows what it may read |
| `6` | server unreachable or timed out — is ZMLR running on that URL? |
| `7` | rate limited (60 requests/minute per token). `zvault` honours `Retry-After` once, then gives up |
| `127` | `run`: the command itself was not found on PATH |

With `--strict` (the default) every one of 3–7 happens **before** the child is
spawned, so a command never starts with a half-populated environment.

---

## Security notes

**What this protects.** The secret is never written to disk by `zvault`, never
appears in a command line or process list, never lands in shell history, and
is not in the config or `.env` you commit — those hold a reference name. A
coding agent launched through `zvault run` reads the value from
`process.env`, which is not part of its conversation transcript, so the
secret does not get sent to a model or stored in a session log.

**What it does not protect.** Once the child holds the value, the child owns
it:

- The child can print it. `zvault run -- printenv` will show it; so will a tool
  that dumps its environment into a debug log or an error report.
- Anything the child spawns inherits it, including subshells, hooks and MCP
  servers the child starts.
- On most systems another process running as the same user can read
  `/proc/<pid>/environ` (or the Windows equivalent). This is process-level
  isolation, not sandboxing.
- `zvault get --stdout` deliberately hands the value to your shell. Everything
  above stops applying at that point.

**Operational notes.**

- The agent token is a bearer credential for everything in its scope. Scope it
  narrowly, give it a TTL, keep it in a file with `600` permissions, revoke it
  the moment a laptop or a runner is retired.
- `zvault` redacts the token and every resolved value from its own output, so
  a server error string that echoed one would still be printed as
  `[redacted]`. It cannot redact what the *child* prints.
- Talk to ZMLR over loopback (`127.0.0.1`). The token travels in the request
  **body**, so `zvault` refuses to send it to a non-loopback host unless you set
  `ZVAULT_ALLOW_REMOTE=1` **and** use an `https://` URL — a cleartext http POST
  to a remote host would expose the token on the wire. A LAN deployment should
  sit behind TLS and set `TRUST_PROXY=1` only when there is a real proxy in front.
- Reads are logged server-side against the token (entry name, timestamp) — the
  vault's usage audit shows which tool read what and when.
- A vault read requires the vault to be **unlocked** on the server. Unlocking
  is an operator action; a token can never unlock it.

---

## Packaging

To expose the CLI as `zvault` from an install, `package.json` needs:

```json
"bin": { "zvault": "bin/zvault.mjs" },
"scripts": { "zvault": "node bin/zvault.mjs" }
```

Tests live in `tests/unit/zvaultRun.test.js` and run the real binary as a child
process against a mock server that implements the two frozen routes:

```bash
DATA_DIR=/tmp/zmlr-test JWT_SECRET=<hex> npx vitest run tests/unit/zvaultRun.test.js
```
