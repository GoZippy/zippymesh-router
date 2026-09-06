# `zmlr doctor` and `/api/health`

Two ways to ask a ZippyMesh node whether it is healthy:

| | Who runs it | Needs the server running? | What it can see |
|---|---|---|---|
| `zmlr doctor` | a person, or CI, on the box | no (it checks more when it is) | the filesystem, the database, the environment, the LAN |
| `GET /api/health` | a supervisor, a load balancer, a monitor | yes | only what the process itself knows |

The doctor is the one that tells you *why* something is broken. `/api/health`
is the one a machine polls forever.

---

## `zmlr doctor`

```bash
node scripts/doctor.mjs                 # human-readable report
node scripts/doctor.mjs --json          # machine-readable array
npm run cli -- doctor                   # via the CLI dispatcher
npm run doctor                          # if the script is wired in package.json
```

Options:

| Flag | Meaning |
|---|---|
| `--json` | Emit a JSON array of `{ id, title, status, detail, remedy }` instead of text |
| `--url <url>` | Base URL of a running server (default `http://127.0.0.1:20128`) |
| `--data-dir <path>` | Check this data directory instead of the resolved one, and enable the write probe |
| `-h`, `--help` | Usage |

Exit code:

* **1** — at least one check FAILED.
* **0** — everything else, including warnings. Warnings are things an operator
  should know about; they do not stop a node from working.

Statuses: `PASS` (ok), `WARN` (works, but read it), `FAIL` (will not work
correctly), `SKIP` (could not be determined — usually an optional dependency or
a server that is not running).

### What it will and will not touch

The doctor is **read-only by design**:

* It never writes inside the real per-user data directory
  (`%APPDATA%\zippy-mesh` / `~/.zippy-mesh`). For that directory it only asks
  the OS whether the account has write permission.
* It writes exactly one file — a probe it immediately deletes — and only inside
  a directory you named yourself with `--data-dir` or `DATA_DIR`.
* It opens `zippymesh.db` **read-only** (`fileMustExist`), so it can never run a
  migration or create a store as a side effect. One caveat, stated plainly:
  opening a WAL-mode database — even read-only — makes SQLite map the shared
  memory index, so `zippymesh.db-shm` may get a new mtime. No application data
  and no `-wal` content is modified.
* It never reads `router-config.json`, only checks that it exists.
* It never prints a secret, an API key, or a vault entry name. `JWT_SECRET` is
  reported by length and source, never by value. Provider URLs are stripped of
  credentials and query strings before they are printed.

It has no npm dependencies (Node ≥ 20 builtins only), so it runs in a
standalone build where `node_modules` is trimmed — it just downgrades the
SQLite check to `SKIP` when `better-sqlite3` is not resolvable.

---

## The checks

### `node-version` — Node.js version

ZippyMesh needs **Node 20 or newer**.

* `FAIL` — you are on an older Node. Install Node 20 LTS or newer.
* `WARN` — Node is fine, but `package.json` declares no `engines.node`, so
  `npm install` will happily proceed on an unsupported runtime. Fix by adding
  `"engines": { "node": ">=20" }`.

### `context` — Install context

Is this a source checkout (`src/` + `next.config.mjs`) or an unpacked
standalone build (`server.js` + `.next`, no `src/`)? Several later checks read
differently in each. `WARN` means you are probably running the doctor from the
wrong directory.

### `env-file` — `.env` and `JWT_SECRET`

`JWT_SECRET` signs session cookies. A value in the process environment wins
over one in `.env` — that is how Node reads it, and the doctor says which one
it found.

* `FAIL` — no secret anywhere, or it still looks like a placeholder
  (`REPLACE_WITH_...`, `changeme`, …). Fix with `npm run setup`, which writes
  `.env` from the persisted `router-config.json`, or set it yourself:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
* `WARN` — shorter than 32 characters. Use 64 hex characters.

The value is never printed — only its length and where it came from.

### `bind-host` — Bind host

Mirrors `src/lib/net/bindHost.js`: `ZIPPY_BIND_HOST` → `HOST` → `HOSTNAME` →
`127.0.0.1`.

* `PASS` — loopback. Nothing on the LAN can reach this node.
* `WARN` — bound to a non-loopback address. Deliberate exposure is fine;
  confirm login is enabled first.
* `FAIL` — bound off-box **and** `settings.requireLogin` is `false`. The app
  treats no-login as superadmin, so any host that can reach the address can
  reconfigure the node without a password. Fix by enabling login via `/setup`,
  or by unsetting `ZIPPY_BIND_HOST`/`HOST` to return to the loopback default.

### `ports` — Port resolution

Three different numbers are in play and they can disagree:

* `PORT` — what `server.js` actually binds; **falls back to 3000**, not 20128.
* `ZIPPY_PORT` — what `.env.example`, `Dockerfile` and `docker-compose.yml`
  set, and what `src/lib/discovery/localDiscovery.js` and
  `/api/mesh/peers/filtered` advertise to peers; falls back to 20128.
* The `dev` / `start` npm scripts hardcode `-p 20128` and read neither.

`WARN` means the bound port and the advertised port differ, so peers would be
told to talk to a port nothing is listening on. Set `PORT` and `ZIPPY_PORT` to
the same value.

### `data-dir` — Data directory

Mirrors `src/lib/localDb.js`: `DATA_DIR` → `%APPDATA%\zippy-mesh` (Windows) →
`~/.zippy-mesh`. `--data-dir` overrides everything.

* `WARN` — does not exist yet. Normal before the first run; it is created
  automatically.
* `FAIL` — exists but is not writable by the account running ZippyMesh. The
  report says which resolution rule produced the path, and whether writability
  was proven with a probe file (explicit directories only) or merely checked
  as a permission (the real per-user store).

### `db-json` — `db.json`

The lowdb settings store. `WARN` if absent (first run). `FAIL` if present but
not valid JSON — restore from a backup, or move it aside and lose local
settings. On success it reports how many top-level collections it holds and
what `settings.requireLogin` says, which is the input to the `bind-host` check.

### `sqlite` — `zippymesh.db` schema

Opens the SQLite store read-only and reports the table count and
`PRAGMA user_version`.

* `SKIP` — `better-sqlite3` could not be resolved from here.
* `WARN` — `user_version` is `0`. **This is the current state of the project**:
  `localDb.js` migrates idempotently (`CREATE TABLE IF NOT EXISTS` plus
  per-column `PRAGMA table_info` / `ALTER TABLE` checks) and never stamps a
  version. Nothing is broken, but there is no way to distinguish a
  partially-migrated store from a current one. Not an operator action.

### `trust-proxy` — `TRUST_PROXY`

Controls whether the token-authenticated vault routes believe
`X-Forwarded-For` / `X-Real-IP` when choosing a rate-limit bucket
(`src/lib/vaultRateLimit.js`).

* `PASS` — unset. Those headers are ignored, which is the safe default: Next's
  App Router exposes no socket address, so a caller could otherwise pick its own
  bucket.
* `WARN` (enabled) — correct **only** when a reverse proxy you control rewrites
  those headers. Otherwise unset it.
* `WARN` (unrecognised value) — only `1` and `true` enable it. `yes`, `on`, `0`
  are all treated as disabled, which may not be what you meant.

### `router-config` — `router-config.json`

The persistent `JWT_SECRET` / `SIDE_CAR_SECRET` / `INITIAL_PASSWORD` store that
`npm run setup` writes. `WARN` if missing — run `npm run setup`.

Note the asymmetry the doctor points out: `scripts/setup-env.mjs` always writes
the **OS per-user directory** and ignores `DATA_DIR`, while `src/lib/localDb.js`
honours `DATA_DIR`. With `DATA_DIR` set, the two files live in different places.

### `standalone-build` — Standalone build

Is `.next/standalone/server.js` present, and is it newer than the current git
HEAD commit?

* `WARN` (absent) — nothing built yet; run `npm run build`.
* `WARN` (stale) — the build predates HEAD, so the running server does not
  match the checked-out code. Rebuild.

### `standalone-bind` — Built server bind host

`.next/standalone/server.js` is **regenerated by every `next build`** from
Next's own template, whose default is `process.env.HOSTNAME || '0.0.0.0'` — every
interface. `npm run build` therefore runs `scripts/prepare-standalone.cjs`,
which **prepends a preamble** to that generated file resolving
`ZIPPY_BIND_HOST > HOST > HOSTNAME > 127.0.0.1`, warns loudly on a non-loopback
bind, and **fails the build** if the patch cannot be applied. So a bundle
produced by `npm run build` binds loopback by default; one that does not should
not exist.

The check reads the first 4 KB of the built file and looks for
`prepare-standalone.cjs`'s own sentinel, `ZippyMesh standalone preamble`.

* `PASS` — the built file carries the preamble (or genuinely calls
  `resolveBindHost()`).
* `WARN` — stock template, but `HOSTNAME` pins it to loopback, or login is
  enabled; or the head is unrecognisable.
* `FAIL` — stock template binding `0.0.0.0` while `settings.requireLogin` is
  `false`.

Remedy for a `WARN`/`FAIL`: rebuild with `npm run build`, or re-apply the patch
to an already-unpacked install with
`node scripts/prepare-standalone.cjs --patch-server <dir>`.

> **Corrected 2026-08-30.** This section used to say the built server "knows
> nothing about `ZIPPY_BIND_HOST`, nothing about `HOST`, and prints no warning",
> and told operators to run `node server.js` from the repo root as a workaround.
> That was written before `4726f6da` and had been wrong since. Worse, the check
> itself looked for the string `resolveBindHost`, which the injected preamble
> never contains — so it reported a correctly hardened bundle as a stock
> template, hard-failing (exit 1) exactly when `requireLogin` was `false`. Both
> the check and this text now key on the preamble marker.

### `server` — Server `/api/health`

`GET <url>/api/health` with a 3 s timeout and a summary of the fields it
returned.

* `WARN` — not reachable. The server is not running, or it is listening
  somewhere else; pass `--url`.
* `FAIL` — answered non-200, or answered 200 with a body that is not JSON
  (something is intercepting the route).

### `vault` — Vault state

Read from the `/api/health` payload, so it needs a running server.

* `SKIP` — the server was not reachable.
* `WARN` (not initialised) — no verifier blob and no entries. The master
  password is anchored on the first write; until then a fresh vault accepts any
  password at setup.
* `WARN` (locked) — initialised, but the process is not holding the master
  password, so token reads answer `401 Vault is locked`. Unlock it in the UI.
  **The unlock lives in the server process memory and is lost on every restart.**
* `PASS` — initialised and unlocked.

### `providers` — Local provider reachability

Collects every provider base URL on loopback or a private/LAN address, from the
SQLite `provider_nodes` table and from `db.json`'s `providerNodes` /
`providerConnections`, de-duplicates them, and `GET`s each with a 3 s timeout.
Public endpoints (`api.openai.com`, …) are deliberately not probed. API keys are
never read or sent.

* `SKIP` — nothing local configured.
* `WARN` — at least one node did not answer. Start the runtime (`ollama serve`,
  LM Studio's server), or remove the stale node on the Providers page — routing
  will skip it either way.

Any HTTP response counts as reachable, including a `401` — LM Studio answers
`401` on `/v1` when it is up, and that is exactly the fact you wanted.

---

## `GET /api/health`

Unauthenticated by design (`src/middleware.js` lets it through) so a supervisor
can poll it without a session. It may therefore be reachable from the LAN, and
the payload is limited to **booleans, versions and counts**: no filesystem
paths, no hostnames or addresses, no secrets, no vault entry names, no provider
names or URLs.

`HEAD /api/health` is also supported for supervisors that probe with HEAD:
`200` when the store answers, `503` when it does not, no body either way.

```jsonc
{
  // ── original fields; other tools poll these, they do not change ──
  "ok": true,
  "status": "ok",
  "service": "zippymesh",
  "version": "1.3.0",
  "uptime": 42.7,
  "providersConfigured": 8,
  "providersActive": 3,
  "providersRateLimited": 0,
  "timestamp": "2026-08-30T13:20:00.000Z",
  "apiVersion": "v1",
  "endpoints": { "models": "/v1/models", "chat": "/v1/chat/completions",
                 "providerStatus": "/api/provider-status",
                 "rateLimits": "/api/tokenbuddy/rate-limits?all=true" },

  // ── supervisor fields ──
  "vault":      { "initialized": false, "unlocked": false },
  "dataDir":    { "configured": true,   "writable": true },
  "trustProxy": false,
  "bindHost":   { "loopbackOnly": true },
  "db":         { "ok": true, "schemaVersion": 0 },
  "build":      { "version": "1.3.0", "standalone": true, "nodeVersion": "v22.11.0" }
}
```

| Field | Meaning |
|---|---|
| `vault.initialized` | A master-password verifier exists, or at least one entry is stored. `false` means a fresh vault that still accepts any password at setup. |
| `vault.unlocked` | The process is holding the master password. Always `false` right after a restart. |
| `dataDir.configured` | `DATA_DIR` was set explicitly, rather than falling back to the OS default. The path itself is never disclosed. |
| `dataDir.writable` | Permission check only — this route never writes a file. |
| `trustProxy` | The same `isTrustedProxy()` the vault rate limiter uses. |
| `bindHost.loopbackOnly` | Whether the resolved bind host is loopback. A boolean on purpose: the address is not disclosed. |
| `db.ok` | The SQLite store opened and answered. |
| `db.schemaVersion` | `PRAGMA user_version`. `0` today (see the `sqlite` check); `null` when the store would not open. |
| `build.standalone` | A `.next/standalone/server.js` exists next to the running process. |
| `build.nodeVersion` | `process.version` of the server, which is not necessarily the Node the doctor is running under. |

Useful polls:

```bash
curl -s http://127.0.0.1:20128/api/health | jq '{ok, "vault": .vault, "db": .db}'
curl -sf -o /dev/null http://127.0.0.1:20128/api/health && echo up      # GET
curl -sfI -o /dev/null http://127.0.0.1:20128/api/health && echo up     # HEAD
```

On failure the route keeps its original 500 shape
(`{ ok:false, status:"error", service, version, message, timestamp }`). Note
that `message` is the raw driver error and can contain a filesystem path
(`SQLITE_CANTOPEN: unable to open database file …`); narrowing it is a
deliberate open item for the security pass, not an accident.

---

## Running the doctor in CI

```bash
node scripts/doctor.mjs --json --data-dir "$RUNNER_TEMP/zmlr-data" > doctor.json
# exit 1 means at least one check failed
```

Each result carries a stable `id` (`node-version`, `context`, `env-file`,
`bind-host`, `ports`, `data-dir`, `db-json`, `sqlite`, `trust-proxy`,
`router-config`, `standalone-build`, `standalone-bind`, `server`, `vault`,
`providers`), so a pipeline can key on ids rather than on prose.
