/**
 * scripts/bootstrapEnv.cjs#ensureApiKeySecret — regression for install-audit
 * finding #22 (2026-08-30): with API_KEY_SECRET unset, router API keys were
 * HMAC'd with an ephemeral per-process value and died on every restart.
 *
 * DATA_DIR is a fresh temp dir per test file (tests/unit/_setup/dataDir.mjs),
 * so bootstrap.secret lands there and never in the real store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const bootstrapEnv = require("../../scripts/bootstrapEnv.cjs");
const rootCopy = require("../../bootstrapEnv.cjs");

const secretFile = () => path.join(process.env.DATA_DIR, "bootstrap.secret");

beforeEach(() => {
  delete process.env.API_KEY_SECRET;
  fs.rmSync(secretFile(), { force: true });
});

describe("ensureApiKeySecret()", () => {
  it("generates a 64-hex secret once, persists it, and returns the same value on every later start", () => {
    const first = bootstrapEnv.ensureApiKeySecret();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(process.env.API_KEY_SECRET).toBe(first);
    expect(JSON.parse(fs.readFileSync(secretFile(), "utf8")).API_KEY_SECRET).toBe(first);

    delete process.env.API_KEY_SECRET; // simulate a restart
    expect(bootstrapEnv.ensureApiKeySecret()).toBe(first);
  });

  it("never overrides an explicit API_KEY_SECRET from the environment, and never writes it to disk", () => {
    process.env.API_KEY_SECRET = "operator-provided-secret-value-0123456789";
    expect(bootstrapEnv.ensureApiKeySecret()).toBe("operator-provided-secret-value-0123456789");
    expect(fs.existsSync(secretFile())).toBe(false);
  });

  it("treats an empty API_KEY_SECRET= line (the .env.example default) as unset", () => {
    process.env.API_KEY_SECRET = "";
    const s = bootstrapEnv.ensureApiKeySecret();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(secretFile())).toBe(true);
  });

  it("survives store-bootstrap.cjs rewriting bootstrap.secret (setBootstrapSecrets merges)", () => {
    const s = bootstrapEnv.ensureApiKeySecret();
    bootstrapEnv.setBootstrapSecrets({ JWT_SECRET: "j".repeat(64), PORT: 20128 });
    const onDisk = JSON.parse(fs.readFileSync(secretFile(), "utf8"));
    expect(onDisk.JWT_SECRET).toBe("j".repeat(64));
    expect(onDisk.API_KEY_SECRET).toBe(s);
  });

  it("injectBootstrapSync() ensures the secret even when no bootstrap.secret exists yet", () => {
    expect(fs.existsSync(secretFile())).toBe(false);
    bootstrapEnv.injectBootstrapSync();
    expect(process.env.API_KEY_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  it("repo-root bootstrapEnv.cjs is the same module as the shipped scripts/ copy", () => {
    const a = fs.readFileSync(path.resolve("bootstrapEnv.cjs"), "utf8");
    const b = fs.readFileSync(path.resolve("scripts/bootstrapEnv.cjs"), "utf8");
    expect(a).toBe(b);
    expect(typeof rootCopy.ensureApiKeySecret).toBe("function");
  });
});
