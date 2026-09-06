import { NextResponse } from "next/server";
import {
  unlockVault,
  storeVaultEntry,
  readVaultEntry,
  isVaultUnlocked,
} from "@/lib/vault.js";
import { requireAuth } from "@/lib/auth/middleware.js";

/**
 * POST /api/vault/bulk-import
 *
 * Unlock the vault AND store many entries in a SINGLE route handler, so the
 * in-memory unlock state and the entry writes are guaranteed to run against
 * the same module instance. (In Next.js dev, separate route bundles can each
 * get their own instance of the vault module, so unlocking via /api/vault and
 * then POSTing to /api/vault/entries can see different in-memory state. Doing
 * both here in one handler sidesteps that entirely.)
 *
 * Body:
 *   {
 *     password: string,           // ZippyVault passphrase
 *     totpCode?: string,          // if TOTP enrolled
 *     entries: [                  // one or more entries to store
 *       { name, value, label?, category?, tags? }, ...
 *     ],
 *     relock?: boolean            // if true, lock the vault again after (default false)
 *   }
 *
 * Response:
 *   { ok: true, stored: N, verified: N, results: [{ name, ok, verified }] }
 *   or { ok: false, error } with an appropriate status.
 */
async function postHandler(request) {
  const body = await request.json().catch(() => ({}));
  const { password, totpCode, entries, relock } = body;

  if (!password || !Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json(
      { ok: false, error: "password and a non-empty entries[] are required" },
      { status: 400 },
    );
  }

  // Unlock in THIS handler's module instance.
  const unlock = unlockVault(password, totpCode ? { totpCode } : {});
  if (!unlock.ok) {
    const status = unlock.requires_totp ? 401 : 403;
    return NextResponse.json(
      { ok: false, error: unlock.error, requires_totp: !!unlock.requires_totp },
      { status },
    );
  }
  if (!isVaultUnlocked()) {
    return NextResponse.json(
      { ok: false, error: "Vault did not unlock (unexpected)" },
      { status: 500 },
    );
  }

  const results = [];
  let stored = 0;
  let verified = 0;

  for (const e of entries) {
    if (!e || !e.name || e.value === undefined || e.value === null) {
      results.push({ name: e?.name ?? "(missing)", ok: false, error: "name+value required" });
      continue;
    }
    const s = storeVaultEntry(e.name, e.value, {
      label: e.label,
      category: e.category,
      tags: e.tags,
    });
    if (!s.ok) {
      results.push({ name: e.name, ok: false, error: s.error });
      continue;
    }
    stored++;

    // Verify round-trip in the same handler.
    const rb = readVaultEntry(e.name);
    const vok = rb.ok && rb.value === String(e.value);
    if (vok) verified++;
    results.push({ name: e.name, ok: true, verified: vok });
  }

  // relock note the caller can honor; harmless in dev where state is per-instance.
  // We intentionally do NOT lock by default so the user can immediately view
  // the imported entries from the dashboard without re-entering the passphrase.
  if (relock) {
    // lazy import to avoid unused binding if never used
    const { lockVault } = await import("@/lib/vault.js");
    lockVault();
  }

  return NextResponse.json({
    ok: true,
    stored,
    verified,
    total: entries.length,
    results,
  });
}

export const POST = requireAuth(postHandler);
