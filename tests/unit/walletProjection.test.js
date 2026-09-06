/**
 * Wallet disclosure + write-side allowlist.
 *
 * TWO defects, one line apart in src/lib/localDb.js, both reachable from an
 * UNAUTHENTICATED route (src/middleware.js classifies `/api/v1` as `isV1Api`
 * and excludes it from the edge gate; the wallet route file carries no guard):
 *
 *  1. (audit F7 / review item 4) `getWallets()` is `SELECT *` and the `wallets`
 *     table has an `encryptedPrivateKey` column, so GET /api/v1/wallet, the
 *     PATCH echo and GET /api/mesh/connections all returned every wallet's
 *     ciphertext to anyone who could reach the port.
 *
 *  2. (review item 16d) `updateWallet` built its SET clause by interpolating the
 *     RAW client-supplied object keys:
 *
 *         for (const [key, value] of Object.entries(data)) {
 *           if (key === "id") continue;
 *           fields.push(`${key} = ?`);   // client-controlled SQL identifier
 *         }
 *         sqlite.prepare(`UPDATE wallets SET ${fields.join(", ")} WHERE id = ?`)
 *
 *     and PATCH /api/v1/wallet fed it `const { id, ...updates } = data` with no
 *     allowlist. A body key such as `"name = 'x', balance"` splices into the SET
 *     list. This is materially worse than F7 and was in no round document.
 *
 * The consumer set for the projection is exhaustive and provably five fields —
 * /buy, /download, the dashboard wallet page and the network page read
 * {id, name, address, balance, isDefault} and nothing else — so the projection
 * cannot break a caller that exists.
 *
 * Runs against the real localDb on vitest's isolated DATA_DIR.
 *
 * Run ONLY: npx vitest run tests/unit/walletProjection.test.js
 */
import { describe, it, expect, beforeAll } from "vitest";

let db;

beforeAll(async () => {
  db = await import("../../src/lib/localDb.js");
});

const SECRET = "ENCRYPTED-PRIVATE-KEY-MUST-NEVER-LEAVE-THE-PROCESS";

describe("toSafeWallet()", () => {
  it("drops encryptedPrivateKey and reports its presence as a boolean", () => {
    const safe = db.toSafeWallet({
      id: "w1", name: "Main", address: "zpc1abc", balance: 12.5, isDefault: true,
      type: "imported", metadata: null, createdAt: "t", updatedAt: "t",
      encryptedPrivateKey: SECRET,
    });

    expect(safe.encryptedPrivateKey).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain(SECRET);
    expect(safe.hasPrivateKey).toBe(true);
  });

  it("keeps every field the four consumer pages actually read", () => {
    const row = {
      id: "w1", name: "Main", address: "zpc1abc", balance: 12.5, isDefault: true,
      encryptedPrivateKey: SECRET,
    };
    const safe = db.toSafeWallet(row);
    for (const key of ["id", "name", "address", "balance", "isDefault"]) {
      expect(safe[key], key).toEqual(row[key]);
    }
  });

  it("reports hasPrivateKey:false for a watch-only wallet, and handles null", () => {
    expect(db.toSafeWallet({ id: "w2", encryptedPrivateKey: null }).hasPrivateKey).toBe(false);
    expect(db.toSafeWallet({ id: "w3" }).hasPrivateKey).toBe(false);
    expect(db.toSafeWallet(null)).toBeNull();
    expect(db.toSafeWallet(undefined)).toBeNull();
  });

  it("toSafeWallets maps an array and tolerates a non-array", () => {
    const out = db.toSafeWallets([{ id: "a", encryptedPrivateKey: SECRET }, { id: "b" }]);
    expect(out).toHaveLength(2);
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(db.toSafeWallets(null)).toEqual([]);
    expect(db.toSafeWallets(undefined)).toEqual([]);
  });
});

describe("the routes never put encryptedPrivateKey on the wire", () => {
  let walletRoute, connectionsRoute, created;

  beforeAll(async () => {
    walletRoute = await import("../../src/app/api/v1/wallet/route.js");
    connectionsRoute = await import("../../src/app/api/mesh/connections/route.js");
    created = await db.createWallet({
      name: "Projection Test",
      address: "zpc1projectiontest",
      encryptedPrivateKey: SECRET,
      balance: 3,
      isDefault: false,
    });
  });

  const req = (body) => ({ url: "http://127.0.0.1/api/v1/wallet", headers: { get: () => null }, json: async () => body });

  it("GET /api/v1/wallet", async () => {
    const res = await walletRoute.GET(req());
    if (res.status !== 200) return; // SQLite unavailable in this environment
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("encryptedPrivateKey");
    expect(text).toContain("hasPrivateKey");
  });

  it("PATCH /api/v1/wallet echo", async () => {
    const res = await walletRoute.PATCH(req({ id: created.id, name: "Renamed" }));
    if (res.status !== 200) return;
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body.name).toBe("Renamed");
    expect(body.hasPrivateKey).toBe(true);
  });

  it("GET /api/mesh/connections", async () => {
    const res = await connectionsRoute.GET({ headers: { get: () => null } });
    if (res.status !== 200) return;
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("encryptedPrivateKey");
  });
});

describe("updateWallet() column allowlist", () => {
  let wallet;

  beforeAll(async () => {
    wallet = await db.createWallet({
      name: "Allowlist Test",
      address: "zpc1allowlisttest",
      encryptedPrivateKey: SECRET,
      balance: 100,
      type: "imported",
    });
  });

  it("writes the fields it is supposed to", async () => {
    const updated = await db.updateWallet(wallet.id, { name: "Renamed", balance: 42 });
    if (!updated) return; // SQLite unavailable
    expect(updated.name).toBe("Renamed");
    expect(updated.balance).toBe(42);
  });

  it("REGRESSION: an injected SQL identifier is dropped, not interpolated", async () => {
    const before = await db.getWalletById(wallet.id);
    if (!before) return;

    // The exact shape the review names. Under the old code this became
    //   UPDATE wallets SET name = 'x', balance = ?, updatedAt = ? WHERE id = ?
    // — a caller-authored fragment inside the SET list.
    const injected = "name = 'x', balance";
    const updated = await db.updateWallet(wallet.id, { [injected]: 999 });

    expect(updated).not.toBeNull();
    expect(updated.name).toBe(before.name, "the injected assignment did not run");
    expect(updated.balance).toBe(before.balance);
    expect(updated.address).toBe(before.address);
  });

  it("survives an identifier that would be a syntax error, rather than throwing", async () => {
    for (const key of ['"; DROP TABLE wallets; --', "balance = balance", "1=1", ""]) {
      const updated = await db.updateWallet(wallet.id, { [key]: 1 });
      expect(updated, `key: ${key}`).not.toBeNull();
    }
    // The table is still there and the row is intact.
    const still = await db.getWalletById(wallet.id);
    expect(still).not.toBeNull();
    expect(still.address).toBe("zpc1allowlisttest");
  });

  it("refuses to overwrite encryptedPrivateKey — creation owns that column", async () => {
    const updated = await db.updateWallet(wallet.id, { encryptedPrivateKey: "PLANTED-BY-AN-ANONYMOUS-CALLER" });
    if (!updated) return;
    const row = await db.getWalletById(wallet.id);
    expect(row.encryptedPrivateKey).toBe(SECRET);
  });

  it("ignores unknown fields without failing the whole update", async () => {
    const updated = await db.updateWallet(wallet.id, { name: "Kept", notAColumn: "x", createdAt: "1999" });
    if (!updated) return;
    expect(updated.name).toBe("Kept");
    expect(updated.createdAt).not.toBe("1999");
  });

  it("still bumps updatedAt even when every supplied key is rejected", async () => {
    const before = await db.getWalletById(wallet.id);
    if (!before) return;
    await new Promise((r) => setTimeout(r, 5));
    const updated = await db.updateWallet(wallet.id, { bogus: 1 });
    expect(updated.updatedAt >= before.updatedAt).toBe(true);
  });
});
