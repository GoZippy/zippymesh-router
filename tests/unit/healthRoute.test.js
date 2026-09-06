/**
 * GET /api/health is PUBLIC and UNAUTHENTICATED (src/middleware.js lets it
 * through) and may be reachable from the LAN. These tests pin two things:
 *
 *   1. the supervisor contract — the pre-existing fields keep their names and
 *      types, and the new vault / dataDir / trustProxy / bindHost / db / build
 *      fields are present and correctly typed;
 *   2. the disclosure contract — the serialized body contains no filesystem
 *      path, no home-directory fragment, no vault entry name and no secret.
 *
 * localDb is mocked, so no real store is opened; DATA_DIR is still set by the
 * runner to a throwaway directory as a second line of defence.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";

// A DATA_DIR whose path fragments must never appear in the response body.
const SCRATCH_DATA_DIR =
  process.env.DATA_DIR || path.join(os.tmpdir(), "zmlr-health-route-test-data");
process.env.DATA_DIR = SCRATCH_DATA_DIR;

const db = {
  providerConnections: [
    { id: "1", provider: "ollama", testStatus: "active", rateLimitedUntil: null },
    { id: "2", provider: "openai", testStatus: "error", rateLimitedUntil: new Date(Date.now() + 60_000).toISOString() },
  ],
  verifier: null,
  entries: [],
  pragma: 0,
  sqliteOk: true,
};

vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(async () => db.providerConnections),
}));

vi.mock("@/lib/localDb", () => ({
  initLocalProviderConnections: vi.fn(async () => 0),
  vaultMetaGet: vi.fn((k) => (k === "vault_verifier" ? db.verifier : null)),
  vaultListEntries: vi.fn(() => db.entries),
  getSqliteDb: vi.fn(() =>
    db.sqliteOk ? { pragma: vi.fn(() => db.pragma) } : null
  ),
}));

const vaultState = { unlocked: false };
vi.mock("@/lib/vault", () => ({
  isVaultUnlocked: vi.fn(() => vaultState.unlocked),
}));

import { GET, HEAD } from "@/app/api/health/route.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  db.providerConnections = [
    { id: "1", provider: "ollama", testStatus: "active", rateLimitedUntil: null },
    { id: "2", provider: "openai", testStatus: "error", rateLimitedUntil: new Date(Date.now() + 60_000).toISOString() },
  ];
  db.verifier = null;
  db.entries = [];
  db.pragma = 0;
  db.sqliteOk = true;
  vaultState.unlocked = false;
});

afterEach(() => {
  for (const k of ["TRUST_PROXY", "ZIPPY_BIND_HOST", "HOST", "HOSTNAME"]) delete process.env[k];
  process.env.DATA_DIR = SCRATCH_DATA_DIR;
  Object.assign(process.env, { JWT_SECRET: ORIGINAL_ENV.JWT_SECRET });
});

async function body() {
  const res = await GET();
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/health — existing contract", () => {
  it("keeps every pre-existing field with its original name and type", async () => {
    const j = await body();
    expect(j.ok).toBe(true);
    expect(j.status).toBe("ok");
    expect(j.service).toBe("zippymesh");
    expect(typeof j.version).toBe("string");
    expect(typeof j.uptime).toBe("number");
    expect(j.providersConfigured).toBe(2);
    expect(j.providersActive).toBe(1);
    expect(j.providersRateLimited).toBe(1);
    expect(typeof j.timestamp).toBe("string");
    expect(j.apiVersion).toBe("v1");
    expect(j.endpoints).toEqual({
      models: "/v1/models",
      chat: "/v1/chat/completions",
      providerStatus: "/api/provider-status",
      rateLimits: "/api/tokenbuddy/rate-limits?all=true",
    });
  });
});

describe("GET /api/health — supervisor fields", () => {
  it("reports vault { initialized, unlocked } as booleans", async () => {
    const j = await body();
    expect(j.vault).toEqual({ initialized: false, unlocked: false });
  });

  it("treats a verifier blob as initialised even with zero entries", async () => {
    db.verifier = '{"encrypted_value":"deadbeef"}';
    const j = await body();
    expect(j.vault.initialized).toBe(true);
  });

  it("treats a stored entry as initialised when there is no verifier (legacy vault)", async () => {
    db.entries = [{ name: "OPENAI_API_KEY" }];
    const j = await body();
    expect(j.vault.initialized).toBe(true);
  });

  it("reports the unlocked state from vault.js", async () => {
    vaultState.unlocked = true;
    const j = await body();
    expect(j.vault.unlocked).toBe(true);
  });

  it("reports dataDir { configured, writable } as booleans and never the path", async () => {
    const j = await body();
    expect(typeof j.dataDir.configured).toBe("boolean");
    expect(typeof j.dataDir.writable).toBe("boolean");
    expect(j.dataDir.configured).toBe(true); // DATA_DIR is set by the runner
    expect(Object.keys(j.dataDir).sort()).toEqual(["configured", "writable"]);
  });

  it("reports trustProxy from the same helper the vault routes use", async () => {
    expect((await body()).trustProxy).toBe(false);
    process.env.TRUST_PROXY = "1";
    expect((await body()).trustProxy).toBe(true);
  });

  it("reports bindHost.loopbackOnly as a boolean, never the address", async () => {
    expect((await body()).bindHost).toEqual({ loopbackOnly: true });

    process.env.ZIPPY_BIND_HOST = "0.0.0.0";
    const exposed = await body();
    expect(exposed.bindHost).toEqual({ loopbackOnly: false });
    expect(JSON.stringify(exposed)).not.toContain("0.0.0.0");
  });

  it("reports db { ok, schemaVersion }", async () => {
    const j = await body();
    expect(j.db.ok).toBe(true);
    expect(j.db.schemaVersion).toBe(0);
  });

  it("reports db.ok=false and a null schemaVersion when the store will not open", async () => {
    db.sqliteOk = false;
    const j = await body();
    expect(j.db).toEqual({ ok: false, schemaVersion: null });
  });

  it("reports build { version, standalone, nodeVersion }", async () => {
    const j = await body();
    expect(typeof j.build.version).toBe("string");
    expect(typeof j.build.standalone).toBe("boolean");
    expect(j.build.nodeVersion).toBe(process.version);
    expect(j.build.version).toBe(j.version); // same source as the top-level field
  });
});

describe("GET /api/health — disclosure contract", () => {
  it("leaks no fragment of DATA_DIR, no home directory and no path separators from it", async () => {
    const text = JSON.stringify(await body());

    // No component of the configured data dir may appear.
    for (const part of SCRATCH_DATA_DIR.split(/[\\/]/).filter((p) => p.length > 2)) {
      expect(text, `leaked DATA_DIR component "${part}"`).not.toContain(part);
    }
    expect(text).not.toContain(SCRATCH_DATA_DIR);

    // No home-directory shapes.
    expect(text).not.toContain("Users\\");
    expect(text).not.toContain("Users/");
    expect(text).not.toContain("/home/");
    expect(text).not.toContain("AppData");
    expect(text).not.toContain("zippy-mesh\\");
    expect(text).not.toContain(os.homedir());

    // No Windows drive-letter paths and no absolute POSIX paths.
    expect(text).not.toMatch(/[A-Za-z]:\\/);
    expect(text).not.toMatch(/"\/(?:usr|var|home|opt|etc|tmp)\//);
  });

  it("leaks no vault entry name and no secret", async () => {
    db.entries = [{ name: "OPENAI_API_KEY" }, { name: "ZIPPYCOIN_SEED" }];
    db.verifier = '{"encrypted_value":"c0ffee","salt":"pbkdf2$600000$abcd"}';
    const text = JSON.stringify(await body());
    expect(text).not.toContain("OPENAI_API_KEY");
    expect(text).not.toContain("ZIPPYCOIN_SEED");
    expect(text).not.toContain("c0ffee");
    expect(text).not.toContain("pbkdf2");
    expect(text).not.toContain(process.env.JWT_SECRET ?? "__no_jwt_secret__");
  });

  it("leaks no provider name, id or base URL", async () => {
    db.providerConnections = [
      { id: "conn-uuid-1", provider: "ollama", name: "Ollama (10.0.88.254)", baseUrl: "http://10.0.88.254:11434", apiKey: "sk-live-NEVER", testStatus: "active" },
    ];
    const text = JSON.stringify(await body());
    expect(text).not.toContain("conn-uuid-1");
    expect(text).not.toContain("10.0.88.254");
    expect(text).not.toContain("sk-live-NEVER");
    expect(text).not.toContain("Ollama");
  });

  it("emits only booleans, numbers, strings and plain objects — no arrays of records", async () => {
    const j = await body();
    for (const [key, value] of Object.entries(j)) {
      expect(Array.isArray(value), `${key} must not be an array of records`).toBe(false);
    }
  });
});

describe("GET /api/health — failure path", () => {
  it("keeps the supervisor fields on the 500", async () => {
    const { getProviderConnections } = await import("@/models");
    getProviderConnections.mockRejectedValueOnce(new Error("store unavailable"));
    const res = await GET();
    expect(res.status).toBe(500);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.status).toBe("error");
    expect(j.service).toBe("zippymesh");
    expect(typeof j.version).toBe("string");
    expect(typeof j.timestamp).toBe("string");
  });

  // Adversarial review 2026-08-30, item 12 / audit F26. `message` used to be
  // `error.message`, and a driver error carries the absolute data-dir path —
  // i.e. the OS username — on an UNAUTHENTICATED route whose own header forbids
  // exactly that.
  it("never puts the driver's message on the wire", async () => {
    const { getProviderConnections } = await import("@/models");
    getProviderConnections.mockRejectedValueOnce(new Error("store unavailable"));
    const res = await GET();
    const j = await res.json();
    expect(j.message).toBe("health check failed");
    expect(JSON.stringify(j)).not.toContain("store unavailable");
  });

  it("keeps the driver's error CODE, which is diagnostic and not path-shaped", async () => {
    const { getProviderConnections } = await import("@/models");
    const err = new Error(
      `SQLITE_CANTOPEN: unable to open database file ${SCRATCH_DATA_DIR}${path.sep}db.sqlite`
    );
    err.code = "SQLITE_CANTOPEN";
    getProviderConnections.mockRejectedValueOnce(err);
    const res = await GET();
    const j = await res.json();
    expect(j.code).toBe("SQLITE_CANTOPEN");

    // The whole point: not one fragment of the path survives.
    const text = JSON.stringify(j);
    expect(text).not.toContain(SCRATCH_DATA_DIR);
    for (const segment of SCRATCH_DATA_DIR.split(/[\\/]/).filter((s) => s.length > 2)) {
      expect(text, `500 body leaked the path segment "${segment}"`).not.toContain(segment);
    }
    expect(text).not.toContain(os.homedir());
    expect(text).not.toContain("unable to open database file");
  });

  it("reports a null code when the error carries none", async () => {
    const { getProviderConnections } = await import("@/models");
    getProviderConnections.mockRejectedValueOnce(new Error("plain failure"));
    const res = await GET();
    expect((await res.json()).code).toBeNull();
  });
});

describe("HEAD /api/health", () => {
  it("answers 200 with no body when the store responds", async () => {
    const res = await HEAD();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("answers 503 when the store throws", async () => {
    const { getProviderConnections } = await import("@/models");
    getProviderConnections.mockRejectedValueOnce(new Error("down"));
    const res = await HEAD();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("");
  });
});
