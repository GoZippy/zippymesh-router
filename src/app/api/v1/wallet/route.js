/**
 * /api/v1/wallet — wallet CRUD.
 *
 * SECURITY: this route is UNAUTHENTICATED by design. src/middleware.js:104
 * classifies `/api/v1` as `isV1Api` and excludes it from `isManagementApi`, so
 * the edge gate never runs, and there is no route-level guard here. That is
 * deliberate for GET: the public `/buy` and `/download` pages read it without a
 * session (adversarial review 2026-08-30, item 4 — "do NOT gate GET").
 *
 * Because it is unauthenticated, every response goes through toSafeWallet(),
 * which drops `encryptedPrivateKey` and reports its presence as a boolean, and
 * every write goes through updateWallet()'s column allowlist. Do not return a
 * raw wallet row from this file.
 */
import { NextResponse } from "next/server";
import { getWallets, createWallet, updateWallet, deleteWallet, toSafeWallet, toSafeWallets } from "@/lib/localDb.js";
import { encrypt } from "@/lib/cryptoUtils.js";
import { apiError } from "@/lib/apiErrors.js";

export async function GET(request) {
    try {
        const wallets = await getWallets();
        return NextResponse.json(toSafeWallets(wallets));
    } catch (error) {
        return apiError(request, 500, "Internal Server Error");
    }
}

export async function POST(req) {
    try {
        const data = await req.json();

        if (!data.name || !data.address) {
            return apiError(req, 400, "Name and address are required");
        }

        let encryptedPrivateKey = data.encryptedPrivateKey;
        if (data.privateKey && !encryptedPrivateKey) {
            encryptedPrivateKey = encrypt(data.privateKey, data.passphrase);
        }

        const wallet = await createWallet({
            name: data.name,
            address: data.address,
            encryptedPrivateKey,
            type: data.type || "imported",
            balance: data.balance || 0,
            isDefault: data.isDefault || false,
            metadata: data.metadata || {}
        });

        return NextResponse.json(toSafeWallet(wallet));
    } catch (error) {
        return apiError(req, 500, "Internal Server Error");
    }
}

export async function PATCH(req) {
    try {
        const data = await req.json();
        const { id, ...updates } = data;

        if (!id) {
            return apiError(req, 400, "Wallet ID is required");
        }

        const updated = await updateWallet(id, updates);
        if (!updated) {
            return apiError(req, 404, "Wallet not found");
        }

        return NextResponse.json(toSafeWallet(updated));
    } catch (error) {
        return apiError(req, 500, "Internal Server Error");
    }
}

export async function DELETE(req) {
    try {
        const { searchParams } = new URL(req.url);
        let id = searchParams.get("id");

        if (!id) {
            try {
                const data = await req.json();
                id = data.id;
            } catch (e) {
                // Ignore json parse error if no body
            }
        }

        if (!id) {
            return apiError(req, 400, "Wallet ID is required");
        }

        const deleted = await deleteWallet(id);
        if (!deleted) {
            return apiError(req, 404, "Wallet not found or already deleted");
        }

        return NextResponse.json({ success: true, wallet: toSafeWallet(deleted) });
    } catch (error) {
        return apiError(req, 500, "Internal Server Error");
    }
}
