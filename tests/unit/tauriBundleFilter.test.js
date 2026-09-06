/**
 * scripts/lib/bundleFilter.cjs — the gate between the builder's `.env` and a
 * Tauri installer.
 *
 * THE BUG (adversarial review 2026-08-30, item 16e): scripts/build-tauri-frontend.cjs
 * did `fs.cpSync(.next/standalone -> src-tauri/resources/standalone, {recursive:true})`,
 * `next build` copies the repo-root `.env` into `.next/standalone/.env`, and
 * tauri.conf.json bundles `resources/standalone/**`. So the installer would ship
 * the builder's JWT_SECRET, INITIAL_PASSWORD, provider keys and wallet seed —
 * and a CI-built installer would bake ONE shared JWT_SECRET into every copy,
 * letting anyone holding it forge a session cookie for any install of it.
 * `data/` (optionally a symlink at the operator's real store, which cpSync
 * DEREFERENCES) would go the same way.
 *
 * Verified at review time: a 2,623-byte `.env` and a `data/` directory were
 * sitting in src-tauri/resources/standalone/ from an earlier build.
 *
 * Run ONLY: npx vitest run tests/unit/tauriBundleFilter.test.js
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { EXCLUDE_NAMES, LEAK_NAME_RE, copyFiltered, findLeakedNames } =
  require("../../scripts/lib/bundleFilter.cjs");

let tmp, src, dest;

function write(rel, content = "x") {
  const full = path.join(src, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zmlr-bundlefilter-"));
  src = path.join(tmp, "standalone");
  dest = path.join(tmp, "resources");
  fs.mkdirSync(src, { recursive: true });
});

afterAll(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("copyFiltered()", () => {
  it("REGRESSION: does not copy the builder's .env into the bundle", () => {
    write(".env", "JWT_SECRET=deadbeef\nINITIAL_PASSWORD=hunter2\n");
    write("server.js");
    write(".env.example", "JWT_SECRET=\n");

    const stats = copyFiltered(src, dest);

    expect(fs.existsSync(path.join(dest, ".env"))).toBe(false);
    expect(stats.excluded).toContain(".env");
    // ...and the template the bundled README tells the user to copy DOES ship.
    expect(fs.existsSync(path.join(dest, ".env.example"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "server.js"))).toBe(true);
  });

  it("does not copy bootstrap.secret, db.json or a data/ directory", () => {
    write("bootstrap.secret", '{"JWT_SECRET":"x"}');
    write("db.json", "{}");
    write("data/db.json", "{}");
    write("data/vault.sqlite");
    write("run.js");

    copyFiltered(src, dest);

    expect(fs.existsSync(path.join(dest, "bootstrap.secret"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "db.json"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "data"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "run.js"))).toBe(true);
  });

  it("excludes a nested .env too, not only the root one", () => {
    write("open-sse/.env", "SECRET=1");
    write("open-sse/handlers/chatCore.js");

    copyFiltered(src, dest);

    expect(fs.existsSync(path.join(dest, "open-sse", ".env"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "open-sse", "handlers", "chatCore.js"))).toBe(true);
  });

  it("never dereferences a symlink — cpSync would have copied the target's CONTENTS", () => {
    const realStore = path.join(tmp, "real-store");
    fs.mkdirSync(realStore, { recursive: true });
    fs.writeFileSync(path.join(realStore, "vault.sqlite"), "the operator's actual vault");
    write("server.js");

    // `data` is on the exclude list, so use a differently-named link to prove
    // the symlink rule itself rather than the name rule.
    let linked = true;
    try {
      fs.symlinkSync(realStore, path.join(src, "store-link"), "dir");
    } catch {
      linked = false; // Windows without developer mode / admin
    }

    const stats = copyFiltered(src, dest);
    expect(fs.existsSync(path.join(dest, "server.js"))).toBe(true);
    if (linked) {
      expect(stats.skippedLinks).toContain("store-link");
      expect(fs.existsSync(path.join(dest, "store-link"))).toBe(false);
    }
  });

  it("copies an ordinary tree faithfully", () => {
    write("server.js", "console.log(1)");
    write("public/logo.txt", "logo");
    write("node_modules/pkg/index.js", "module.exports={}");

    const stats = copyFiltered(src, dest);

    expect(stats.copied).toBe(3);
    expect(fs.readFileSync(path.join(dest, "server.js"), "utf8")).toBe("console.log(1)");
    expect(fs.readFileSync(path.join(dest, "node_modules", "pkg", "index.js"), "utf8")).toBe("module.exports={}");
  });
});

describe("findLeakedNames() — the post-copy hard gate", () => {
  it("finds a secret that got in some other way, at any depth", () => {
    fs.mkdirSync(path.join(dest, "deep", "deeper"), { recursive: true });
    fs.writeFileSync(path.join(dest, "deep", "deeper", ".env"), "JWT_SECRET=x");
    fs.writeFileSync(path.join(dest, "server.js"), "ok");

    expect(findLeakedNames(dest)).toEqual(["deep/deeper/.env"]);
  });

  it("is silent on a clean tree, .env.example included", () => {
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, ".env.example"), "JWT_SECRET=");
    fs.writeFileSync(path.join(dest, "server.js"), "ok");

    expect(findLeakedNames(dest)).toEqual([]);
  });

  it("guards the same names the release-zip gate does", () => {
    for (const n of [".env", "bootstrap.secret", "db.json", "oauth-secrets.json", "router-config.json"]) {
      expect(LEAK_NAME_RE.test(n), n).toBe(true);
      expect(EXCLUDE_NAMES.has(n), n).toBe(true);
    }
    expect(LEAK_NAME_RE.test(".env.example")).toBe(false);
  });
});
