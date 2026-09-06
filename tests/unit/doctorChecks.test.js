/**
 * Unit tests for scripts/doctor/checks.mjs.
 *
 * Every check is exercised through an injected context: a fake fs, a fake env,
 * a fake fetch, a fake clock, a fake git and a fake SQLite reader. Nothing here
 * touches the real filesystem, the real network or a real database, so the
 * suite is safe to run without DATA_DIR pointing anywhere in particular.
 */
import { describe, it, expect, vi } from "vitest";
import path from "node:path";

import {
  mk,
  worstStatus,
  resolveBindHostLike,
  isLoopbackHostLike,
  resolveDataDir,
  resolveUserConfigDir,
  resolvePorts,
  parseEnvFile,
  looksPlaceholderSecret,
  isLocalOrLanUrl,
  safeUrl,
  describeFetchError,
  checkNodeVersion,
  checkContext,
  checkEnvFile,
  checkBind,
  checkPorts,
  checkDataDir,
  checkDbJson,
  checkSqlite,
  checkTrustProxy,
  checkRouterConfig,
  checkStandaloneBuild,
  checkStandaloneBindHost,
  checkServer,
  checkVault,
  collectLocalProviderUrls,
  checkProviders,
  runAllChecks,
  exitCodeFor,
  MIN_NODE_MAJOR,
  STANDALONE_PREAMBLE_MARKER,
} from "../../scripts/doctor/checks.mjs";
import realFs from "node:fs";
import { fileURLToPath } from "node:url";

const CWD = path.join("C:", "repo");
const DATA = path.join("C:", "scratch", "data");

/**
 * An in-memory fs: `files` maps absolute path -> string content (or
 * { dir: true } for a directory, { throwOnRead: code } to fail a read).
 * Anything not listed does not exist. `unwritable` is a set of paths whose
 * accessSync/writeFileSync throws EACCES.
 */
function fakeFs(files = {}, { unwritable = new Set(), mtimes = {} } = {}) {
  const written = new Set();
  return {
    written,
    constants: { W_OK: 2 },
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p) || written.has(p),
    readFileSync: (p) => {
      const v = files[p];
      if (v === undefined) {
        const e = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      }
      if (v && v.throwOnRead) {
        const e = new Error(v.throwOnRead);
        e.code = v.throwOnRead;
        throw e;
      }
      return v;
    },
    writeFileSync: (p, c) => {
      const dir = path.dirname(p);
      if (unwritable.has(dir) || unwritable.has(p)) {
        const e = new Error("EACCES");
        e.code = "EACCES";
        throw e;
      }
      written.add(p);
      files[p] = c;
    },
    unlinkSync: (p) => {
      written.delete(p);
      delete files[p];
    },
    statSync: (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const e = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      }
      return { mtime: new Date(mtimes[p] ?? "2026-01-01T00:00:00.000Z") };
    },
    accessSync: (p) => {
      if (unwritable.has(p)) {
        const e = new Error("EACCES");
        e.code = "EACCES";
        throw e;
      }
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const e = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      }
    },
  };
}

function ctxWith(overrides = {}) {
  const files = overrides.files ?? {};
  const fs = overrides.fs ?? fakeFs(files, overrides.fsOpts);
  return {
    fs,
    env: {},
    cwd: CWD,
    platform: "win32",
    homedir: path.join("C:", "Users", "someone"),
    nodeVersion: "v22.11.0",
    now: () => 1700000000000,
    fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    timeoutSignal: () => undefined,
    httpTimeoutMs: 3000,
    providerTimeoutMs: 3000,
    gitHeadIso: () => null,
    readSqlite: () => ({ available: false, error: "not injected" }),
    url: "http://127.0.0.1:20128",
    dataDir: { dir: DATA, source: "flag" },
    ...overrides,
    files: undefined,
  };
}

// ── pure helpers ──────────────────────────────────────────────────────────────

describe("pure helpers", () => {
  it("worstStatus ranks fail > warn > skip > ok", () => {
    expect(worstStatus([mk("a", "A", "ok", "")])).toBe("ok");
    expect(worstStatus([mk("a", "A", "ok", ""), mk("b", "B", "skip", "")])).toBe("skip");
    expect(worstStatus([mk("a", "A", "skip", ""), mk("b", "B", "warn", "")])).toBe("warn");
    expect(worstStatus([mk("a", "A", "warn", ""), mk("b", "B", "fail", "")])).toBe("fail");
  });

  it("resolveBindHostLike follows ZIPPY_BIND_HOST > HOST > HOSTNAME > default", () => {
    expect(resolveBindHostLike({})).toBe("127.0.0.1");
    expect(resolveBindHostLike({ HOSTNAME: "0.0.0.0" })).toBe("0.0.0.0");
    expect(resolveBindHostLike({ HOST: "1.2.3.4", HOSTNAME: "0.0.0.0" })).toBe("1.2.3.4");
    expect(resolveBindHostLike({ ZIPPY_BIND_HOST: "::1", HOST: "1.2.3.4" })).toBe("::1");
    expect(resolveBindHostLike({ ZIPPY_BIND_HOST: "   " })).toBe("127.0.0.1");
  });

  it("isLoopbackHostLike matches the three loopback spellings and brackets", () => {
    for (const h of ["127.0.0.1", "::1", "[::1]", "localhost", "LOCALHOST", " 127.0.0.1 "]) {
      expect(isLoopbackHostLike(h)).toBe(true);
    }
    for (const h of ["0.0.0.0", "192.168.1.5", "", null, undefined]) {
      expect(isLoopbackHostLike(h)).toBe(false);
    }
  });

  it("resolveDataDir honours the override, then DATA_DIR, then the OS default", () => {
    expect(resolveDataDir({ override: "X:\\over" })).toEqual({ dir: "X:\\over", source: "flag" });
    expect(resolveDataDir({ env: { DATA_DIR: "X:\\env" } })).toEqual({ dir: "X:\\env", source: "env" });

    const win = resolveDataDir({ env: { APPDATA: "C:\\Users\\x\\AppData\\Roaming" }, platform: "win32" });
    expect(win.source).toBe("default");
    expect(win.dir).toBe(path.join("C:\\Users\\x\\AppData\\Roaming", "zippy-mesh"));

    const nix = resolveDataDir({ env: {}, platform: "linux", homedir: "/home/u" });
    expect(nix.dir).toBe(path.join("/home/u", ".zippy-mesh"));

    // ZIPPY_APP_NAME renames the directory, as localDb.js does.
    const named = resolveDataDir({ env: { ZIPPY_APP_NAME: "other" }, platform: "linux", homedir: "/home/u" });
    expect(named.dir).toBe(path.join("/home/u", ".other"));
  });

  it("resolveUserConfigDir ignores DATA_DIR (setup-env.mjs does too)", () => {
    const d = resolveUserConfigDir({ env: { DATA_DIR: "X:\\env", APPDATA: "C:\\AD" }, platform: "win32" });
    expect(d).toBe(path.join("C:\\AD", "zippy-mesh"));
  });

  it("resolvePorts reports the server port and the advertised port separately", () => {
    expect(resolvePorts({})).toMatchObject({ serverPort: 3000, advertisedPort: 20128, mismatch: true });
    expect(resolvePorts({ PORT: "20128" })).toMatchObject({ serverPort: 20128, advertisedPort: 20128, mismatch: false });
    expect(resolvePorts({ PORT: "20128", ZIPPY_PORT: "20130" })).toMatchObject({ mismatch: true });
    expect(resolvePorts({ PORT: "not-a-number" }).serverPort).toBe(3000);
  });

  it("parseEnvFile handles comments, blanks and quotes", () => {
    const parsed = parseEnvFile(['# comment', '', 'A=1', 'B="two"', "C='three'", 'D=', 'BAD', '=x'].join("\n"));
    expect(parsed).toEqual({ A: "1", B: "two", C: "three", D: "" });
  });

  it("looksPlaceholderSecret catches the .env.example values without echoing them", () => {
    expect(looksPlaceholderSecret("REPLACE_WITH_32_RANDOM_CHARS_MINIMUM")).toBe(true);
    expect(looksPlaceholderSecret("")).toBe(true);
    expect(looksPlaceholderSecret("   ")).toBe(true);
    expect(looksPlaceholderSecret("changeme")).toBe(true);
    expect(looksPlaceholderSecret(undefined)).toBe(true);
    expect(looksPlaceholderSecret("a".repeat(64))).toBe(false);
  });

  it("isLocalOrLanUrl accepts loopback and RFC1918, rejects public and non-http", () => {
    for (const u of [
      "http://localhost:11434",
      "http://127.0.0.1:1234/v1",
      "http://10.0.88.254:1234/v1",
      "http://192.168.1.9:8080",
      "http://172.16.0.1",
      "http://172.31.255.1",
      "http://nas.local:1234",
    ]) {
      expect(isLocalOrLanUrl(u), u).toBe(true);
    }
    for (const u of ["https://api.openai.com/v1", "http://8.8.8.8", "http://172.32.0.1", "ftp://127.0.0.1", "not a url", ""]) {
      expect(isLocalOrLanUrl(u), u).toBe(false);
    }
  });

  it("safeUrl strips credentials and query strings", () => {
    expect(safeUrl("http://user:pass@127.0.0.1:1234/v1?key=SECRET")).toBe("http://127.0.0.1:1234/v1");
    expect(safeUrl("nonsense")).toBe("<unparseable url>");
  });

  it("describeFetchError turns a TimeoutError DOMException into 'timeout', not 23", () => {
    const timeout = Object.assign(new Error("The operation was aborted"), { name: "TimeoutError", code: 23 });
    expect(describeFetchError(timeout)).toBe("timeout");
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    expect(describeFetchError(refused)).toBe("ECONNREFUSED");
    expect(describeFetchError(new Error("boom"))).toBe("boom");
  });
});

// ── individual checks ─────────────────────────────────────────────────────────

describe("checkNodeVersion", () => {
  it("fails below the minimum major", () => {
    const r = checkNodeVersion(ctxWith({ nodeVersion: "v18.20.0" }));
    expect(r.status).toBe("fail");
    expect(r.detail).toContain(String(MIN_NODE_MAJOR));
    expect(r.remedy).toBeTruthy();
  });

  it("warns when package.json declares no engines.node", () => {
    const files = { [path.join(CWD, "package.json")]: JSON.stringify({ name: "x" }) };
    const r = checkNodeVersion(ctxWith({ files, fs: fakeFs(files) }));
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("no engines.node");
  });

  it("passes when engines.node is declared", () => {
    const files = { [path.join(CWD, "package.json")]: JSON.stringify({ engines: { node: ">=20" } }) };
    const r = checkNodeVersion(ctxWith({ files, fs: fakeFs(files) }));
    expect(r.status).toBe("ok");
    expect(r.detail).toContain(">=20");
  });

  it("warns on an unparseable version string", () => {
    expect(checkNodeVersion(ctxWith({ nodeVersion: "banana" })).status).toBe("warn");
  });
});

describe("checkContext", () => {
  const p = (...s) => path.join(CWD, ...s);

  it("recognises a source repo", () => {
    const files = { [p("package.json")]: "{}", [p("src")]: "", [p("next.config.mjs")]: "" };
    expect(checkContext(ctxWith({ fs: fakeFs(files) })).status).toBe("ok");
    expect(checkContext(ctxWith({ fs: fakeFs(files) })).detail).toContain("Source repository");
  });

  it("recognises a standalone build", () => {
    const files = { [p("server.js")]: "", [p(".next")]: "" };
    expect(checkContext(ctxWith({ fs: fakeFs(files) })).detail).toContain("Standalone build");
  });

  it("warns when neither is recognised", () => {
    expect(checkContext(ctxWith({ fs: fakeFs({}) })).status).toBe("warn");
  });
});

describe("checkEnvFile", () => {
  const envPath = path.join(CWD, ".env");
  const REAL = "a1b2c3d4".repeat(8); // 64 chars, no placeholder marker

  it("fails when there is no .env and no JWT_SECRET", () => {
    const r = checkEnvFile(ctxWith({ fs: fakeFs({}) }));
    expect(r.status).toBe("fail");
    expect(r.remedy).toContain("npm run setup");
  });

  it("fails on the .env.example placeholder", () => {
    const files = { [envPath]: "JWT_SECRET=REPLACE_WITH_32_RANDOM_CHARS_MINIMUM\n" };
    const r = checkEnvFile(ctxWith({ fs: fakeFs(files) }));
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("placeholder");
  });

  it("warns on a short secret", () => {
    const files = { [envPath]: "JWT_SECRET=abcd1234\n" };
    const r = checkEnvFile(ctxWith({ fs: fakeFs(files) }));
    expect(r.status).toBe("warn");
  });

  it("passes on a real-looking secret and never echoes it", () => {
    const files = { [envPath]: `JWT_SECRET=${REAL}\n` };
    const r = checkEnvFile(ctxWith({ fs: fakeFs(files) }));
    expect(r.status).toBe("ok");
    expect(JSON.stringify(r)).not.toContain(REAL);
    expect(r.detail).toContain("64 characters");
  });

  it("prefers the process environment over the file", () => {
    const files = { [envPath]: "JWT_SECRET=REPLACE_ME\n" };
    const r = checkEnvFile(ctxWith({ fs: fakeFs(files), env: { JWT_SECRET: REAL } }));
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("process environment");
  });

  it("fails when .env cannot be read", () => {
    const files = { [envPath]: { throwOnRead: "EACCES" } };
    const r = checkEnvFile(ctxWith({ fs: fakeFs(files) }));
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("EACCES");
  });
});

describe("checkBind", () => {
  it("passes on the loopback default", () => {
    expect(checkBind(ctxWith({}), { requireLogin: false }).status).toBe("ok");
  });

  it("FAILS on a LAN bind with login disabled", () => {
    const r = checkBind(ctxWith({ env: { ZIPPY_BIND_HOST: "0.0.0.0" } }), { requireLogin: false });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("superadmin");
  });

  it("warns on a LAN bind with login enabled", () => {
    const r = checkBind(ctxWith({ env: { ZIPPY_BIND_HOST: "0.0.0.0" } }), { requireLogin: true });
    expect(r.status).toBe("warn");
  });

  it("warns (never fails) when requireLogin is unknown", () => {
    const r = checkBind(ctxWith({ env: { HOST: "0.0.0.0" } }), { requireLogin: undefined });
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("could not be read");
  });
});

describe("checkPorts", () => {
  it("warns when PORT and ZIPPY_PORT disagree", () => {
    const r = checkPorts(ctxWith({ env: {} }));
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("3000");
    expect(r.detail).toContain("20128");
  });

  it("passes when they agree", () => {
    expect(checkPorts(ctxWith({ env: { PORT: "20128", ZIPPY_PORT: "20128" } })).status).toBe("ok");
  });
});

describe("checkDataDir", () => {
  it("warns when the directory does not exist", () => {
    expect(checkDataDir(ctxWith({ fs: fakeFs({}) })).status).toBe("warn");
  });

  it("writes a probe only for an explicitly named directory, and removes it", () => {
    const files = { [DATA]: "" };
    const fs = fakeFs(files);
    const r = checkDataDir(ctxWith({ fs, dataDir: { dir: DATA, source: "env" } }));
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("writing a probe file");
    expect([...fs.written]).toEqual([]); // probe was unlinked
  });

  it("fails when an explicit directory is not writable", () => {
    const files = { [DATA]: "" };
    const r = checkDataDir(ctxWith({ fs: fakeFs(files, { unwritable: new Set([DATA]) }) }));
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("EACCES");
  });

  it("NEVER writes into the OS-default directory — permission check only", () => {
    const files = { [DATA]: "" };
    const fs = fakeFs(files);
    const spy = vi.spyOn(fs, "writeFileSync");
    const r = checkDataDir(ctxWith({ fs, dataDir: { dir: DATA, source: "default" } }));
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("no file was written");
    expect(spy).not.toHaveBeenCalled();
  });

  it("fails when the OS-default directory is not writable", () => {
    const files = { [DATA]: "" };
    const r = checkDataDir(
      ctxWith({ fs: fakeFs(files, { unwritable: new Set([DATA]) }), dataDir: { dir: DATA, source: "default" } })
    );
    expect(r.status).toBe("fail");
  });
});

describe("checkDbJson", () => {
  const dbFile = path.join(DATA, "db.json");

  it("warns on a first run", () => {
    const { result, requireLogin } = checkDbJson(ctxWith({ fs: fakeFs({}) }));
    expect(result.status).toBe("warn");
    expect(requireLogin).toBeUndefined();
  });

  it("fails on unparseable JSON", () => {
    const { result } = checkDbJson(ctxWith({ fs: fakeFs({ [dbFile]: "{not json" }) }));
    expect(result.status).toBe("fail");
  });

  it("passes and surfaces requireLogin", () => {
    const files = { [dbFile]: JSON.stringify({ settings: { requireLogin: false }, users: [] }) };
    const { result, requireLogin } = checkDbJson(ctxWith({ fs: fakeFs(files) }));
    expect(result.status).toBe("ok");
    expect(requireLogin).toBe(false);
    expect(result.detail).toContain("requireLogin=false");
  });
});

describe("checkSqlite", () => {
  const dbFile = path.join(DATA, "zippymesh.db");

  it("warns when the file is absent", () => {
    expect(checkSqlite(ctxWith({ fs: fakeFs({}) })).result.status).toBe("warn");
  });

  it("skips when better-sqlite3 cannot be loaded", () => {
    const r = checkSqlite(ctxWith({ fs: fakeFs({ [dbFile]: "" }), readSqlite: () => ({ available: false, error: "no module" }) }));
    expect(r.result.status).toBe("skip");
    expect(r.result.detail).toContain("no module");
  });

  it("warns when user_version is 0 (no schema stamp)", () => {
    const r = checkSqlite(
      ctxWith({
        fs: fakeFs({ [dbFile]: "" }),
        readSqlite: () => ({ available: true, userVersion: 0, tableCount: 33, tables: [], localNodes: [] }),
      })
    );
    expect(r.result.status).toBe("warn");
    expect(r.result.detail).toContain("33 tables");
    expect(r.info.tableCount).toBe(33);
  });

  it("passes once a version stamp exists", () => {
    const r = checkSqlite(
      ctxWith({
        fs: fakeFs({ [dbFile]: "" }),
        readSqlite: () => ({ available: true, userVersion: 7, tableCount: 33, tables: [], localNodes: [] }),
      })
    );
    expect(r.result.status).toBe("ok");
  });
});

describe("checkTrustProxy", () => {
  it("passes when unset", () => {
    expect(checkTrustProxy(ctxWith({ env: {} })).status).toBe("ok");
    expect(checkTrustProxy(ctxWith({ env: { TRUST_PROXY: "  " } })).status).toBe("ok");
  });

  it("warns when enabled", () => {
    const r = checkTrustProxy(ctxWith({ env: { TRUST_PROXY: "1" } }));
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("Enabled");
  });

  it("warns on a value the app does not recognise", () => {
    const r = checkTrustProxy(ctxWith({ env: { TRUST_PROXY: "yes" } }));
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("unrecognised");
  });
});

describe("checkRouterConfig", () => {
  it("warns when it is missing", () => {
    const r = checkRouterConfig(ctxWith({ fs: fakeFs({}), env: { APPDATA: "C:\\AD" } }));
    expect(r.status).toBe("warn");
    expect(r.remedy).toContain("npm run setup");
  });

  it("passes and never reads the contents", () => {
    const userFile = path.join("C:\\AD", "zippy-mesh", "router-config.json");
    const files = { [userFile]: '{"JWT_SECRET":"NEVER-PRINT-ME"}' };
    const fs = fakeFs(files);
    const spy = vi.spyOn(fs, "readFileSync");
    const r = checkRouterConfig(ctxWith({ fs, env: { APPDATA: "C:\\AD" } }));
    expect(r.status).toBe("ok");
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("NEVER-PRINT-ME");
  });
});

describe("checkStandaloneBuild", () => {
  const server = path.join(CWD, ".next", "standalone", "server.js");

  it("warns when nothing has been built", () => {
    expect(checkStandaloneBuild(ctxWith({ fs: fakeFs({}) })).status).toBe("warn");
  });

  it("warns when the build predates HEAD", () => {
    const fs = fakeFs({ [server]: "" }, { mtimes: { [server]: "2026-01-01T00:00:00.000Z" } });
    const r = checkStandaloneBuild(ctxWith({ fs, gitHeadIso: () => "2026-08-30T07:21:05-05:00" }));
    expect(r.status).toBe("warn");
    expect(r.remedy).toContain("npm run build");
  });

  it("passes when the build is newer than HEAD", () => {
    const fs = fakeFs({ [server]: "" }, { mtimes: { [server]: "2026-09-01T00:00:00.000Z" } });
    const r = checkStandaloneBuild(ctxWith({ fs, gitHeadIso: () => "2026-08-30T07:21:05-05:00" }));
    expect(r.status).toBe("ok");
  });

  it("passes without git", () => {
    const fs = fakeFs({ [server]: "" });
    expect(checkStandaloneBuild(ctxWith({ fs, gitHeadIso: () => null })).status).toBe("ok");
  });
});

/**
 * checkStandaloneBindHost — release gate 4 (docs/RELEASE.md).
 *
 * THE BUG (adversarial review 2026-08-30, item 16a / H-14): the check detected a
 * hardened bundle with `head.includes("resolveBindHost")`. The preamble that
 * `scripts/prepare-standalone.cjs` has injected since 4726f6da resolves the bind
 * INLINE and never uses that identifier — `resolveBindHost` occurs ZERO times in
 * the real `.next/standalone/server.js` — while the literal `0.0.0.0` DOES
 * appear in its first 4 KB, inside a comment. So the check fell through to the
 * stock-template branch and reported the opposite of the truth, escalating to a
 * hard `fail` (exit 1, breaking the CI gate) precisely when `requireLogin` is
 * false. It also PASSED a genuinely stock template whose only mention of
 * `resolveBindHost` was in a comment.
 *
 * The old fixture here was `PATCHED = "import { resolveBindHost } …"` — a string
 * the build has never produced. That mismatch is what let the bug survive a
 * green suite, so the fixture below is assembled from the marker the real
 * script emits, and one test asserts the marker still matches that script.
 */
describe("checkStandaloneBindHost", () => {
  const server = path.join(CWD, ".next", "standalone", "server.js");
  const STOCK = "const currentPort = parseInt(process.env.PORT, 10) || 3000\nconst hostname = process.env.HOSTNAME || '0.0.0.0'\n";
  const PATCHED = "import { resolveBindHost } from './src/lib/net/bindHost.js'\nconst hostname = resolveBindHost({})\n";

  const prepareStandaloneSrc = realFs.readFileSync(
    fileURLToPath(new URL("../../scripts/prepare-standalone.cjs", import.meta.url)),
    "utf8"
  );

  /** The head of a bundle the way prepare-standalone.cjs actually writes it. */
  const REAL_PREAMBLE_HEAD =
    "process.env.NODE_ENV = 'production'\n" +
    `// ── ${STANDALONE_PREAMBLE_MARKER} (injected by scripts/prepare-standalone.cjs) ──\n` +
    "// Next's generated entry reads process.env.PORT and process.env.HOSTNAME below,\n" +
    "// BEFORE Next loads .env, and defaults to 0.0.0.0:3000. Neither default matches\n" +
    "{\n" +
    "  const zPick = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);\n" +
    "  const zBind = zPick(process.env.ZIPPY_BIND_HOST) || zPick(process.env.HOST) || zPick(process.env.HOSTNAME) || '127.0.0.1';\n" +
    "  process.env.HOSTNAME = zBind;\n" +
    "}\n" +
    `// ── end ${STANDALONE_PREAMBLE_MARKER} ──\n` +
    STOCK;

  it("the marker it looks for is the one prepare-standalone.cjs writes", () => {
    expect(prepareStandaloneSrc).toContain(`PREAMBLE_MARKER = '${STANDALONE_PREAMBLE_MARKER}'`);
    expect(prepareStandaloneSrc).toContain("${PREAMBLE_MARKER} (injected by scripts/prepare-standalone.cjs)");
  });

  it("skips when there is no build", () => {
    expect(checkStandaloneBindHost(ctxWith({ fs: fakeFs({}) })).status).toBe("skip");
  });

  it("REGRESSION: passes a REAL hardened bundle — no resolveBindHost, 0.0.0.0 only in a comment", () => {
    expect(REAL_PREAMBLE_HEAD).not.toContain("resolveBindHost");
    expect(REAL_PREAMBLE_HEAD).toContain("0.0.0.0");

    const r = checkStandaloneBindHost(
      ctxWith({ fs: fakeFs({ [server]: REAL_PREAMBLE_HEAD }) }),
      { requireLogin: false }
    );
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("preamble");
  });

  it("REGRESSION: does not hard-fail a hardened bundle when requireLogin is false", () => {
    // The exact combination that broke the CI gate: exit 1 on a correct node.
    const r = checkStandaloneBindHost(
      ctxWith({ fs: fakeFs({ [server]: REAL_PREAMBLE_HEAD }), env: { HOSTNAME: "" } }),
      { requireLogin: false }
    );
    expect(r.status).not.toBe("fail");
  });

  it("REGRESSION: does NOT pass a stock template that merely mentions resolveBindHost in a comment", () => {
    const decoy = "// TODO: use resolveBindHost() here one day\n" + STOCK;
    const r = checkStandaloneBindHost(ctxWith({ fs: fakeFs({ [server]: decoy }) }), { requireLogin: false });
    expect(r.status).toBe("fail");
  });

  it("still passes a hand-patched entry that really calls resolveBindHost", () => {
    const r = checkStandaloneBindHost(ctxWith({ fs: fakeFs({ [server]: PATCHED }) }));
    expect(r.status).toBe("ok");
  });

  it("warns when the built server is Next's stock 0.0.0.0 template", () => {
    const r = checkStandaloneBindHost(ctxWith({ fs: fakeFs({ [server]: STOCK }) }), { requireLogin: true });
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("ignores ZIPPY_BIND_HOST");
  });

  it("FAILS when the stock template meets requireLogin=false", () => {
    const r = checkStandaloneBindHost(ctxWith({ fs: fakeFs({ [server]: STOCK }) }), { requireLogin: false });
    expect(r.status).toBe("fail");
    // The remedy no longer sends the operator to `node server.js` at the repo
    // root — that advice existed only as a workaround for the bug 4726f6da fixed.
    expect(r.remedy).toContain("npm run build");
    expect(r.remedy).not.toContain("from the repo root");
  });

  it("only warns when HOSTNAME pins it back to loopback", () => {
    const r = checkStandaloneBindHost(
      ctxWith({ fs: fakeFs({ [server]: STOCK }), env: { HOSTNAME: "127.0.0.1" } }),
      { requireLogin: false }
    );
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("keeps it on loopback");
  });

  it("warns when neither marker is present", () => {
    const r = checkStandaloneBindHost(ctxWith({ fs: fakeFs({ [server]: "// something else entirely" }) }));
    expect(r.status).toBe("warn");
  });
});

describe("checkServer", () => {
  it("warns when the server is not running", async () => {
    const fetch = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    });
    const { result, payload } = await checkServer(ctxWith({ fetch }), "http://127.0.0.1:20128");
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("ECONNREFUSED");
    expect(payload).toBeNull();
  });

  it("fails on a non-200", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 500 }));
    const { result } = await checkServer(ctxWith({ fetch }), "http://127.0.0.1:20128");
    expect(result.status).toBe("fail");
  });

  it("fails when the body is not JSON", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }));
    const { result } = await checkServer(ctxWith({ fetch }), "http://127.0.0.1:20128");
    expect(result.status).toBe("fail");
  });

  it("surfaces the payload fields and strips a trailing slash from --url", async () => {
    const body = {
      ok: true,
      version: "1.3.0",
      uptime: 12.7,
      providersConfigured: 8,
      providersActive: 3,
      providersRateLimited: 0,
      db: { ok: true, schemaVersion: 0 },
      build: { standalone: true, nodeVersion: "v22.11.0" },
      bindHost: { loopbackOnly: true },
      trustProxy: false,
    };
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    const { result, payload } = await checkServer(ctxWith({ fetch }), "http://127.0.0.1:20128/");
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:20128/api/health", expect.objectContaining({ method: "GET" }));
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("version=1.3.0");
    expect(result.detail).toContain("providersConfigured=8");
    expect(result.detail).toContain("loopbackOnly=true");
    expect(payload).toBe(body);
  });
});

describe("checkVault", () => {
  it("skips without a payload", () => {
    expect(checkVault(ctxWith({}), null).status).toBe("skip");
  });

  it("warns when the running server has no vault field", () => {
    const r = checkVault(ctxWith({}), { ok: true });
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("predates");
  });

  it("warns when uninitialised, warns when locked, passes when unlocked", () => {
    expect(checkVault(ctxWith({}), { vault: { initialized: false, unlocked: false } }).status).toBe("warn");
    const locked = checkVault(ctxWith({}), { vault: { initialized: true, unlocked: false } });
    expect(locked.status).toBe("warn");
    expect(locked.detail).toContain("locked");
    expect(checkVault(ctxWith({}), { vault: { initialized: true, unlocked: true } }).status).toBe("ok");
  });
});

describe("provider reachability", () => {
  const dbFile = path.join(DATA, "db.json");

  it("collects and de-duplicates local URLs from SQLite and db.json, dropping public ones", () => {
    const files = {
      [dbFile]: JSON.stringify({
        providerNodes: [{ name: "dup", baseUrl: "http://127.0.0.1:11434" }],
        providerConnections: [
          { name: "cloud", baseUrl: "https://api.openai.com/v1", apiKey: "sk-NEVER" },
          { name: "custom", metadata: { baseUrl: "http://192.168.1.9:8080" } },
        ],
      }),
    };
    const sqliteInfo = {
      localNodes: [
        { name: "Ollama", baseUrl: "http://127.0.0.1:11434" },
        { name: "LM Studio", baseUrl: "http://10.0.88.254:1234/v1" },
      ],
    };
    const urls = collectLocalProviderUrls(ctxWith({ fs: fakeFs(files) }), sqliteInfo);
    expect(urls.map((u) => u.url).sort()).toEqual([
      "http://10.0.88.254:1234/v1",
      "http://127.0.0.1:11434/",
      "http://192.168.1.9:8080/",
    ]);
    expect(JSON.stringify(urls)).not.toContain("openai");
    expect(JSON.stringify(urls)).not.toContain("sk-NEVER");
  });

  it("skips when nothing local is configured", async () => {
    const r = await checkProviders(ctxWith({ fs: fakeFs({}) }), null);
    expect(r.status).toBe("skip");
  });

  it("passes when every node answers", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const r = await checkProviders(ctxWith({ fs: fakeFs({}), fetch }), {
      localNodes: [{ name: "Ollama", baseUrl: "http://127.0.0.1:11434" }],
    });
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("1/1 reachable");
  });

  it("counts a 401 as reachable (LM Studio answers 401 when it is up)", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 401 }));
    const r = await checkProviders(ctxWith({ fs: fakeFs({}), fetch }), {
      localNodes: [{ name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" }],
    });
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("HTTP 401");
  });

  it("warns and names the timeout when a node is down", async () => {
    const fetch = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError", code: 23 });
    });
    const r = await checkProviders(ctxWith({ fs: fakeFs({}), fetch }), {
      localNodes: [{ name: "LM Studio", baseUrl: "http://172.30.80.1:1234/v1" }],
    });
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("timeout");
    expect(r.detail).not.toContain("; 23)"); // not the raw DOMException code
  });
});

// ── orchestration ─────────────────────────────────────────────────────────────

describe("runAllChecks / exitCodeFor", () => {
  it("returns one result per check, each with the reporting shape", async () => {
    const results = await runAllChecks(ctxWith({ fs: fakeFs({}) }));
    expect(results.length).toBe(15);
    for (const r of results) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.title).toBe("string");
      expect(["ok", "warn", "fail", "skip"]).toContain(r.status);
      expect(typeof r.detail).toBe("string");
      if (r.status !== "ok") expect(r.remedy, r.id).toBeTruthy();
    }
    // Ids are unique, so --json consumers can key on them.
    expect(new Set(results.map((r) => r.id)).size).toBe(results.length);
  });

  it("exits 1 only on a failure — warnings and skips do not fail the run", () => {
    expect(exitCodeFor([mk("a", "A", "ok", "")])).toBe(0);
    expect(exitCodeFor([mk("a", "A", "warn", ""), mk("b", "B", "skip", "")])).toBe(0);
    expect(exitCodeFor([mk("a", "A", "warn", ""), mk("b", "B", "fail", "")])).toBe(1);
  });

  it("the LAN-bind + login-disabled combination is what makes the doctor exit 1", async () => {
    const dbFile = path.join(DATA, "db.json");
    const files = {
      [path.join(CWD, ".env")]: `JWT_SECRET=${"a1b2c3d4".repeat(8)}\n`,
      [dbFile]: JSON.stringify({ settings: { requireLogin: false } }),
      [DATA]: "",
    };
    const results = await runAllChecks(ctxWith({ fs: fakeFs(files), env: { ZIPPY_BIND_HOST: "0.0.0.0" } }));
    expect(exitCodeFor(results)).toBe(1);
    expect(results.find((r) => r.id === "bind-host").status).toBe("fail");
  });
});
