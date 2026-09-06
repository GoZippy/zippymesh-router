/**
 * `zvault` CLI tests — bin/zvault.mjs.
 *
 * The CLI is exercised as a REAL child process (spawned with process.execPath)
 * against a REAL node:http server on an ephemeral port that implements the two
 * frozen vault token routes (read-with-token / list-with-token) exactly as
 * src/app/api/vault/*-with-token/route.js do: status codes, the `Vault is
 * locked` 401 text, 403 for out-of-scope, 404 for missing, 429 + Retry-After.
 *
 * The point of the launcher is that a secret reaches the CHILD's environment
 * and nowhere else, so every test that captures the parent's stdout/stderr
 * asserts the fixture values and the fixture token are ABSENT from them. The
 * child proves it received the real value by printing a SHA-256 of it, which
 * the test compares against the hash of the fixture value — the value itself
 * is never printed by anything.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../../bin/zvault.mjs", import.meta.url));

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Deliberately distinctive strings so an accidental leak into parent output is
// impossible to miss. They are fixtures, not credentials.
const TOKEN = "zvt-fixture-token-4b8e2d1a7c90";
const VALUES = {
  "alpha-key": "fixture-value-ALPHA-9d41c7e2b05f",
  "beta-dsn": "fixture-value-BETA-3a7f10c8e6d2",
};
const META = [
  { name: "alpha-key", label: "Alpha API key", category: "api", tags: [], updated_at: 1 },
  { name: "beta-dsn", label: "Beta DSN", category: "database", tags: [], updated_at: 2 },
];
const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

/** A child that prints SHA-256 of the named env vars — never the values. */
const hashScript = (names) =>
  `const c=require('node:crypto');` +
  names
    .map(
      (n) =>
        `process.stdout.write('${n}=' + c.createHash('sha256').update(String(process.env.${n})).digest('hex') + '\\n');`,
    )
    .join("");

// ── Mock ZippyVault server ───────────────────────────────────────────────────

const state = {
  mode: "ok", // 'ok' | 'locked'
  rateLimitLeft: 0, // how many upcoming requests answer 429
  retryAfter: "1",
  requests: [],
  reads: [],
};

let server;
let baseUrl;
let deadUrl;

function send(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      state.requests.push(req.url);

      if (state.rateLimitLeft > 0) {
        state.rateLimitLeft -= 1;
        return send(
          res,
          429,
          { ok: false, error: "Rate limit exceeded. Try again shortly." },
          { "Retry-After": state.retryAfter },
        );
      }

      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return send(res, 400, { ok: false, error: "Invalid JSON body" });
      }

      if (req.url === "/api/vault/list-with-token") {
        if (!body.token || typeof body.token !== "string")
          return send(res, 400, { ok: false, error: "token is required" });
        if (body.token !== TOKEN) return send(res, 401, { ok: false, error: "Invalid token" });
        return send(res, 200, {
          ok: true,
          scopes: ["*"],
          unlocked: state.mode !== "locked",
          entries: META,
        });
      }

      if (req.url === "/api/vault/read-with-token") {
        if (!body.token || typeof body.token !== "string")
          return send(res, 400, { ok: false, error: "token is required" });
        if (!body.entry || typeof body.entry !== "string")
          return send(res, 400, { ok: false, error: "entry is required" });
        if (body.token !== TOKEN) return send(res, 401, { ok: false, error: "Invalid token" });
        if (state.mode === "locked") return send(res, 401, { ok: false, error: "Vault is locked" });
        // A 200 "ok" response that carries no usable string value (M-9 fixture).
        if (body.entry === "no-value")
          return send(res, 200, { ok: true, name: body.entry, label: "No value", category: "api" });
        if (body.entry === "out-of-scope")
          return send(res, 403, {
            ok: false,
            error: `Token is not scoped for entry '${body.entry}'. Allowed scopes: alpha-key`,
          });
        if (!(body.entry in VALUES))
          return send(res, 404, { ok: false, error: `Entry not found: ${body.entry}` });

        state.reads.push(body.entry);
        const meta = META.find((m) => m.name === body.entry);
        return send(res, 200, {
          ok: true,
          name: body.entry,
          label: meta.label,
          category: meta.category,
          value: VALUES[body.entry],
        });
      }

      send(res, 404, { ok: false, error: "not found" });
    });
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // A port that is guaranteed closed: bind, note it, release it.
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  deadUrl = `http://127.0.0.1:${probe.address().port}`;
  await new Promise((r) => probe.close(r));
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  state.mode = "ok";
  state.rateLimitLeft = 0;
  state.retryAfter = "1";
  state.requests = [];
  state.reads = [];
});

// ── CLI harness ──────────────────────────────────────────────────────────────
// cwd and HOME both point at an empty sandbox so no ./.zvault.json or
// ~/.zvault.json on the developer's machine can influence a run.

const sandbox = mkdtempSync(path.join(tmpdir(), "zvault-test-"));

function cliEnv(extra = {}) {
  const env = { ...process.env, HOME: sandbox, USERPROFILE: sandbox };
  delete env.ZIPPYVAULT_TOKEN;
  delete env.ZIPPYVAULT_TOKEN_FILE;
  delete env.ZIPPYVAULT_URL;
  return { ...env, ...extra };
}

function runCli(args, { env = {}, cwd = sandbox, timeoutMs = 25_000, withAuth = true } = {}) {
  const base = withAuth ? { ZIPPYVAULT_URL: baseUrl, ZIPPYVAULT_TOKEN: TOKEN } : {};
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: cliEnv({ ...base, ...env }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`zvault did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, all: stdout + stderr });
    });
  });
}

/** The invariant every non-`get` test enforces. */
function expectNoSecrets(res) {
  for (const v of Object.values(VALUES)) expect(res.all).not.toContain(v);
  expect(res.all).not.toContain(TOKEN);
}

// ── run: reference resolution ────────────────────────────────────────────────

describe("zvault run — reference resolution", () => {
  it(
    "resolves zvault:// and {{zvault:}} references into the child's environment only",
    async () => {
      const res = await runCli(["run", "--", process.execPath, "-e", hashScript(["A_KEY", "B_DSN"])], {
        env: { A_KEY: `zvault://alpha-key`, B_DSN: `{{zvault:beta-dsn}}` },
      });

      expect(res.code).toBe(0);
      expect(res.stdout).toContain(`A_KEY=${sha256(VALUES["alpha-key"])}`);
      expect(res.stdout).toContain(`B_DSN=${sha256(VALUES["beta-dsn"])}`);
      expectNoSecrets(res);
      // and the literal references are gone from the child's view
      expect(res.stdout).not.toContain(sha256("zvault://alpha-key"));
    },
    30_000,
  );

  it(
    "resolves --env NAME=entry and --map file.json, and de-duplicates entries",
    async () => {
      const mapFile = path.join(sandbox, "map.json");
      writeFileSync(mapFile, JSON.stringify({ FROM_MAP: "beta-dsn" }), "utf8");

      const res = await runCli(
        [
          "run",
          "--env",
          "FROM_FLAG=alpha-key",
          "--env",
          "FROM_FLAG_REF=zvault://alpha-key",
          "--map",
          mapFile,
          "--",
          process.execPath,
          "-e",
          hashScript(["FROM_FLAG", "FROM_FLAG_REF", "FROM_MAP", "FROM_ENVREF"]),
        ],
        { env: { FROM_ENVREF: "zvault://alpha-key" } },
      );

      expect(res.code).toBe(0);
      const alpha = sha256(VALUES["alpha-key"]);
      expect(res.stdout).toContain(`FROM_FLAG=${alpha}`);
      expect(res.stdout).toContain(`FROM_FLAG_REF=${alpha}`);
      expect(res.stdout).toContain(`FROM_ENVREF=${alpha}`);
      expect(res.stdout).toContain(`FROM_MAP=${sha256(VALUES["beta-dsn"])}`);
      expectNoSecrets(res);

      // three NAMEs share one entry -> exactly one read of it
      expect(state.reads.filter((e) => e === "alpha-key")).toHaveLength(1);
      expect(state.reads.filter((e) => e === "beta-dsn")).toHaveLength(1);
    },
    30_000,
  );

  it(
    "passes the child's exit code through (child exits 7 -> parent exits 7)",
    async () => {
      const res = await runCli(["run", "--", process.execPath, "-e", "process.exit(7)"], {
        env: { A_KEY: "zvault://alpha-key" },
      });
      expect(res.code).toBe(7);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "runs without a token when there is nothing to resolve",
    async () => {
      const res = await runCli(["run", "--", process.execPath, "-e", "process.stdout.write('PLAIN_OK')"], {
        withAuth: false,
      });
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("PLAIN_OK");
      expect(state.requests).toHaveLength(0);
    },
    30_000,
  );
});

// ── run: failure modes, all before the child is spawned ──────────────────────

describe("zvault run — failures happen before spawning", () => {
  const CHILD_MARKER = "CHILD_SHOULD_NOT_RUN";
  const marker = ["run", "--", process.execPath, "-e", `process.stdout.write('${CHILD_MARKER}')`];

  it(
    "missing entry -> exit 5, child never spawned",
    async () => {
      const res = await runCli(marker, { env: { A_KEY: "zvault://no-such-entry" } });
      expect(res.code).toBe(5);
      expect(res.stdout).not.toContain(CHILD_MARKER);
      expect(res.stderr).toMatch(/No vault entry named 'no-such-entry'/);
      expect(res.stderr).toMatch(/zvault list/);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "entry out of the token's scope -> exit 5",
    async () => {
      const res = await runCli(marker, { env: { A_KEY: "zvault://out-of-scope" } });
      expect(res.code).toBe(5);
      expect(res.stdout).not.toContain(CHILD_MARKER);
      expect(res.stderr).toMatch(/outside this token's scope/);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "locked vault -> exit 3 with an actionable message",
    async () => {
      state.mode = "locked";
      const res = await runCli(marker, { env: { A_KEY: "zvault://alpha-key" } });
      expect(res.code).toBe(3);
      expect(res.stdout).not.toContain(CHILD_MARKER);
      expect(res.stderr).toMatch(/vault is locked/i);
      expect(res.stderr).toMatch(/Unlock the vault in the ZMLR dashboard/);
      expect(res.stderr).toMatch(/POST \/api\/vault/);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "rejected token -> exit 4",
    async () => {
      const res = await runCli(marker, {
        env: { A_KEY: "zvault://alpha-key", ZIPPYVAULT_TOKEN: "definitely-not-the-fixture-token" },
      });
      expect(res.code).toBe(4);
      expect(res.stdout).not.toContain(CHILD_MARKER);
      expect(res.stderr).toMatch(/rejected the token/);
      expect(res.stderr).toMatch(/Agent tokens|\/api\/vault\/tokens/);
      expectNoSecrets(res);
      expect(res.all).not.toContain("definitely-not-the-fixture-token");
    },
    30_000,
  );

  it(
    "no token at all -> exit 4 telling the operator how to get one",
    async () => {
      const res = await runCli(marker, { withAuth: false, env: { A_KEY: "zvault://alpha-key" } });
      expect(res.code).toBe(4);
      expect(res.stderr).toMatch(/No ZippyVault agent token/);
      expect(res.stderr).toMatch(/ZIPPYVAULT_TOKEN/);
    },
    30_000,
  );

  it(
    "unreachable server -> exit 6 within a bounded time",
    async () => {
      const started = Date.now();
      const res = await runCli([...marker], {
        env: { A_KEY: "zvault://alpha-key", ZIPPYVAULT_URL: deadUrl },
      });
      const elapsed = Date.now() - started;
      expect(res.code).toBe(6);
      expect(res.stdout).not.toContain(CHILD_MARKER);
      expect(res.stderr).toMatch(/Cannot reach ZippyVault/);
      expect(elapsed).toBeLessThan(20_000);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "rate limited: honours Retry-After once, then succeeds",
    async () => {
      state.rateLimitLeft = 1;
      state.retryAfter = "1";
      const res = await runCli(["run", "--", process.execPath, "-e", hashScript(["A_KEY"])], {
        env: { A_KEY: "zvault://alpha-key" },
      });
      expect(res.code).toBe(0);
      expect(res.stdout).toContain(`A_KEY=${sha256(VALUES["alpha-key"])}`);
      expect(res.stderr).toMatch(/rate limited by ZippyVault; retrying once/);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "rate limited twice -> exit 7",
    async () => {
      state.rateLimitLeft = 5;
      state.retryAfter = "0";
      const res = await runCli(marker, { env: { A_KEY: "zvault://alpha-key" } });
      expect(res.code).toBe(7);
      expect(res.stdout).not.toContain(CHILD_MARKER);
      expect(res.stderr).toMatch(/rate limiting this token/);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "--no-strict leaves the reference as-is and warns",
    async () => {
      const res = await runCli(["run", "--no-strict", "--", process.execPath, "-e", hashScript(["A_KEY"])], {
        env: { A_KEY: "zvault://no-such-entry" },
      });
      expect(res.code).toBe(0);
      expect(res.stdout).toContain(`A_KEY=${sha256("zvault://no-such-entry")}`);
      expect(res.stderr).toMatch(/could not resolve A_KEY/);
      expect(res.stderr).toMatch(/leaving A_KEY as-is/);
      expectNoSecrets(res);
    },
    30_000,
  );
});

// ── run: --dry-run ───────────────────────────────────────────────────────────

describe("zvault run --dry-run", () => {
  it(
    "lists NAMEs and entry names, never values, makes no vault request, exits 0",
    async () => {
      const mapFile = path.join(sandbox, "dry-map.json");
      writeFileSync(mapFile, JSON.stringify({ FROM_MAP: "beta-dsn" }), "utf8");

      const res = await runCli(
        ["run", "--dry-run", "--env", "FROM_FLAG=alpha-key", "--map", mapFile, "--", "claude"],
        { env: { A_KEY: "zvault://alpha-key", B_DSN: "{{zvault:beta-dsn}}" } },
      );

      expect(res.code).toBe(0);
      expect(res.stdout).toMatch(/A_KEY\s+<- alpha-key/);
      expect(res.stdout).toMatch(/B_DSN\s+<- beta-dsn/);
      expect(res.stdout).toMatch(/FROM_FLAG\s+<- alpha-key/);
      expect(res.stdout).toMatch(/FROM_MAP\s+<- beta-dsn/);
      expect(res.stdout).toContain("command: claude");
      expect(res.stdout).toMatch(/would resolve 4 variable\(s\) from 2 vault entries/);
      expectNoSecrets(res);
      expect(state.requests).toHaveLength(0);
    },
    30_000,
  );
});

// ── check ────────────────────────────────────────────────────────────────────

describe("zvault check", () => {
  it(
    "unlocked -> exit 0, reports reachable / accepted / unlocked / N entries by name",
    async () => {
      const res = await runCli(["check"]);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("status:  reachable");
      expect(res.stdout).toContain("token:   accepted");
      expect(res.stdout).toContain("vault:   unlocked");
      expect(res.stdout).toContain("entries: 2 in scope");
      expect(res.stdout).toContain("- alpha-key");
      expect(res.stdout).toContain("- beta-dsn");
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "locked -> exit 3 and says LOCKED",
    async () => {
      state.mode = "locked";
      const res = await runCli(["check"]);
      expect(res.code).toBe(3);
      expect(res.stdout).toContain("vault:   LOCKED");
      expect(res.stderr).toMatch(/Unlock/i);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "bad token -> exit 4 and says REJECTED",
    async () => {
      const res = await runCli(["check"], { env: { ZIPPYVAULT_TOKEN: "nope-not-valid" } });
      expect(res.code).toBe(4);
      expect(res.stdout).toContain("token:   REJECTED");
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "unreachable -> exit 6 and says UNREACHABLE",
    async () => {
      const res = await runCli(["check", "--timeout", "3000"], { env: { ZIPPYVAULT_URL: deadUrl } });
      expect(res.code).toBe(6);
      expect(res.stdout).toContain("status:  UNREACHABLE");
      expect(res.stderr).toMatch(/Is ZMLR running\?/);
      expectNoSecrets(res);
    },
    30_000,
  );
});

// ── list ─────────────────────────────────────────────────────────────────────

describe("zvault list", () => {
  it(
    "prints names, labels and categories, never values",
    async () => {
      const res = await runCli(["list"]);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("NAME");
      expect(res.stdout).toContain("alpha-key");
      expect(res.stdout).toContain("Alpha API key");
      expect(res.stdout).toContain("api");
      expect(res.stdout).toContain("beta-dsn");
      expect(res.stdout).toContain("database");
      expectNoSecrets(res);
      expect(state.reads).toHaveLength(0); // metadata only — no reads
    },
    30_000,
  );
});

// ── get ──────────────────────────────────────────────────────────────────────

describe("zvault get", () => {
  it(
    "refuses without --stdout and makes no vault request",
    async () => {
      const res = await runCli(["get", "alpha-key"]);
      expect(res.code).toBe(2);
      expect(res.stderr).toMatch(/Pass --stdout/);
      expect(state.requests).toHaveLength(0);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "with --stdout on a pipe prints the raw value and warns on stderr",
    async () => {
      const res = await runCli(["get", "alpha-key", "--stdout"]);
      expect(res.code).toBe(0);
      expect(res.stdout).toBe(VALUES["alpha-key"]); // exactly, no trailing newline
      expect(res.stderr).toMatch(/WARNING: --stdout exposes the secret value/);
      expect(res.stderr).not.toContain(VALUES["alpha-key"]);
      expect(res.all).not.toContain(TOKEN);
    },
    30_000,
  );

  it(
    "missing entry -> exit 5",
    async () => {
      const res = await runCli(["get", "no-such-entry", "--stdout"]);
      expect(res.code).toBe(5);
      expectNoSecrets(res);
    },
    30_000,
  );
});

// ── config, token handling, usage ────────────────────────────────────────────

describe("zvault configuration and usage", () => {
  it(
    "refuses --token with exit 2 and explains why",
    async () => {
      const res = await runCli(["run", "--token", "abc123", "--", "true"]);
      expect(res.code).toBe(2);
      expect(res.stderr).toMatch(/Refusing --token/);
      expect(res.stderr).toMatch(/shell history/);
      expect(res.stderr).toMatch(/process list/);
      expect(res.all).not.toContain("abc123");
    },
    30_000,
  );

  it(
    "reads url and tokenFile from an explicit --config file",
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "zvault-cfg-"));
      writeFileSync(path.join(dir, "token.txt"), `${TOKEN}\n`, "utf8");
      const cfgPath = path.join(dir, "myconfig.json");
      writeFileSync(cfgPath, JSON.stringify({ url: baseUrl, tokenFile: path.join(dir, "token.txt") }), "utf8");
      try {
        const res = await runCli(["check", "--config", cfgPath], { withAuth: false });
        expect(res.code).toBe(0);
        expect(res.stdout).toContain("token:   accepted");
        expectNoSecrets(res);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "reads url and tokenFile from ~/.zvault.json in the user's home",
    async () => {
      const home = mkdtempSync(path.join(tmpdir(), "zvault-home-"));
      writeFileSync(path.join(home, "token.txt"), `${TOKEN}\n`, "utf8");
      writeFileSync(
        path.join(home, ".zvault.json"),
        JSON.stringify({ url: baseUrl, tokenFile: path.join(home, "token.txt") }),
        "utf8",
      );
      try {
        // Point the child's HOME/USERPROFILE at this throwaway dir so homedir()
        // resolves ~/.zvault.json here and nowhere on the real machine.
        const res = await runCli(["check"], { withAuth: false, env: { HOME: home, USERPROFILE: home } });
        expect(res.code).toBe(0);
        expect(res.stdout).toContain("token:   accepted");
        expectNoSecrets(res);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "flags beat the environment (--url wins over ZIPPYVAULT_URL)",
    async () => {
      const res = await runCli(["check", "--url", baseUrl], { env: { ZIPPYVAULT_URL: deadUrl } });
      expect(res.code).toBe(0);
      expect(res.stdout).toContain(`server:  ${baseUrl}`);
    },
    30_000,
  );

  it(
    "unknown option and unknown subcommand -> exit 2",
    async () => {
      const a = await runCli(["run", "--nope", "--", "true"]);
      expect(a.code).toBe(2);
      expect(a.stderr).toMatch(/Unknown option --nope/);

      const b = await runCli(["frobnicate"]);
      expect(b.code).toBe(2);
      expect(b.stderr).toMatch(/Unknown command 'frobnicate'/);

      const c = await runCli(["run"]);
      expect(c.code).toBe(2);
      expect(c.stderr).toMatch(/needs `--` followed by the command/);
    },
    30_000,
  );

  it(
    "--help exits 0 and documents the exit codes",
    async () => {
      const res = await runCli(["--help"], { withAuth: false });
      expect(res.code).toBe(0);
      expect(res.stdout).toMatch(/3 vault locked/);
      expect(res.stdout).toMatch(/6 server unreachable/);
      expect(res.stdout).toMatch(/--token is REFUSED/);
    },
    30_000,
  );
});

// ── Security hardening: C-1 config discovery, reserved env keys, H-12, M-9 ────

describe("zvault security hardening", () => {
  const marker = ["run", "--", process.execPath, "-e", "process.stdout.write('CHILD_RAN')"];

  it(
    "ignores a repo-local ./.zvault.json — a cloned repo cannot set url or tokenFile (C-1)",
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "zvault-hostile-"));
      writeFileSync(path.join(dir, "token.txt"), `${TOKEN}\n`, "utf8");
      // A hostile CWD config that tries to redirect BOTH exfiltration levers at
      // the mock server. It must be ignored: no token (tokenFile ignored) -> the
      // request that would carry the token is never made (url ignored).
      writeFileSync(
        path.join(dir, ".zvault.json"),
        JSON.stringify({ url: baseUrl, tokenFile: path.join(dir, "token.txt") }),
        "utf8",
      );
      try {
        const res = await runCli(["check"], { withAuth: false, cwd: dir });
        expect(res.code).toBe(4); // no token — CWD tokenFile was ignored
        expect(res.stderr).toMatch(/No ZippyVault agent token/);
        expect(state.requests).toHaveLength(0); // CWD url was ignored — nothing sent
        expectNoSecrets(res);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "refuses to set PATH from --env (exit 2, child never spawned)",
    async () => {
      const res = await runCli(["run", "--env", "PATH=alpha-key", ...marker.slice(1)]);
      expect(res.code).toBe(2);
      expect(res.stderr).toMatch(/Refusing to set PATH/);
      expect(res.stdout).not.toContain("CHILD_RAN");
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "refuses a --map that sets Path / NODE_OPTIONS (exit 2, case-insensitive)",
    async () => {
      const mapFile = path.join(sandbox, "reserved-map.json");
      writeFileSync(mapFile, JSON.stringify({ Path: "alpha-key" }), "utf8");
      const a = await runCli(["run", "--map", mapFile, ...marker.slice(1)], {
        env: { A_KEY: "zvault://alpha-key" },
      });
      expect(a.code).toBe(2);
      expect(a.stderr).toMatch(/Refusing to set Path/);
      expect(a.stdout).not.toContain("CHILD_RAN");

      const b = await runCli(["run", "--env", "NODE_OPTIONS=alpha-key", ...marker.slice(1)]);
      expect(b.code).toBe(2);
      expect(b.stderr).toMatch(/Refusing to set NODE_OPTIONS/);
    },
    30_000,
  );

  it(
    "refuses a non-loopback URL without ZVAULT_ALLOW_REMOTE — token never sent (H-12)",
    async () => {
      const res = await runCli(["check"], { env: { ZIPPYVAULT_URL: "http://10.0.88.254:21999" } });
      expect(res.code).toBe(2);
      expect(res.stderr).toMatch(/non-loopback host/);
      expect(state.requests).toHaveLength(0);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "still refuses cleartext http to a remote host even with ZVAULT_ALLOW_REMOTE=1 (H-12)",
    async () => {
      const res = await runCli(["check"], {
        env: { ZIPPYVAULT_URL: "http://10.0.88.254:21999", ZVAULT_ALLOW_REMOTE: "1" },
      });
      expect(res.code).toBe(2);
      expect(res.stderr).toMatch(/cleartext/);
      expect(state.requests).toHaveLength(0);
      expectNoSecrets(res);
    },
    30_000,
  );

  it(
    "fails closed (exit 5) when the server answers 200 ok with no usable value (M-9)",
    async () => {
      const res = await runCli(marker, { env: { A_KEY: "zvault://no-value" } });
      expect(res.code).toBe(5);
      expect(res.stdout).not.toContain("CHILD_RAN");
      expect(res.stderr).toMatch(/no usable value/);
      expectNoSecrets(res);
    },
    30_000,
  );
});

// ── Windows shim spawning ────────────────────────────────────────────────────

describe.skipIf(process.platform !== "win32")("zvault run — Windows .cmd shims", () => {
  it(
    "spawns a .cmd shim (npm) through cmd.exe without shell:true",
    async () => {
      const res = await runCli(["run", "--", "npm", "--version"], {
        env: { A_KEY: "zvault://alpha-key" },
      });
      expect(res.code).toBe(0);
      expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
      expectNoSecrets(res);
    },
    60_000,
  );

  it(
    "reports a missing command instead of hanging",
    async () => {
      const res = await runCli(["run", "--", "definitely-not-a-real-command-xyz"], { withAuth: false });
      expect(res.code).toBe(127);
      expect(res.stderr).toMatch(/Command not found on PATH/);
    },
    30_000,
  );
});
