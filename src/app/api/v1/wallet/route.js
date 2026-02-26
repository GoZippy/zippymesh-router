import { NextResponse } from "next/server";
import { getWallets, createWallet, updateWallet, deleteWallet } from "@/lib/localDb.js";
import { encrypt } from "@/lib/cryptoUtils.js";

export async function GET() {
    try {
        const wallets = await getWallets();
        return NextResponse.json(wallets);
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}

export async function POST(req) {
    try {
        const data = await req.json();

        if (!data.name || !data.address) {
            return NextResponse.json({ error: "Name and address are required" }, { status: 400 });
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

        return NextResponse.json(wallet);
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}

export async function PATCH(req) {
    try {
        const data = await req.json();
        const { id, ...updates } = data;

        if (!id) {
            return NextResponse.json({ error: "Wallet ID is required" }, { status: 400 });
        }

        const updated = await updateWallet(id, updates);
        if (!updated) {
            return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
        }

        return NextResponse.json(updated);
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
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
            return NextResponse.json({ error: "Wallet ID is required" }, { status: 400 });
        }

        const deleted = await deleteWallet(id);
        if (!deleted) {
            return NextResponse.json({ error: "Wallet not found or already deleted" }, { status: 404 });
        }

        return NextResponse.json({ success: true, wallet: deleted });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
