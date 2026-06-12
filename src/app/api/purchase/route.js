import { NextResponse } from "next/server";
import {
  createPurchase,
  updatePurchase,
  getWalletById,
  getWalletByAddress,
  addWalletTransaction,
  getActiveLicense,
} from "@/lib/localDb.js";
import { openPaymentChannel } from "@/lib/sidecar.js";

const ZIPPYMESH_PAYMENT_WALLET = process.env.ZIPPYMESH_PAYMENT_WALLET || "ZIP-ZIPPYMESH-SALES";

const PRODUCTS = {
  "zippymesh-pro": {
    id: "zippymesh-pro",
    name: "ZippyMesh Pro",
    priceZip: 50,
  },
  "zippymesh-enterprise": {
    id: "zippymesh-enterprise",
    name: "ZippyMesh Enterprise",
    priceZip: 200,
  },
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { productId, walletId, walletAddress, amount } = body;

    if (!productId || !walletAddress || !amount) {
      return NextResponse.json(
        { error: "Missing required fields: productId, walletAddress, amount" },
        { status: 400 }
      );
    }

    const product = PRODUCTS[productId];
    if (!product) {
      return NextResponse.json(
        { error: `Unknown product: ${productId}` },
        { status: 400 }
      );
    }

    if (amount < product.priceZip) {
      return NextResponse.json(
        { error: `Insufficient payment. Expected ${product.priceZip} ZIPc, got ${amount}` },
        { status: 400 }
      );
    }

    const existingLicense = await getActiveLicense(walletAddress, productId);
    if (existingLicense) {
      return NextResponse.json(
        { error: "You already have an active license for this product", license: existingLicense },
        { status: 409 }
      );
    }

    let wallet = null;
    if (walletId) {
      wallet = await getWalletById(walletId);
    } else {
      wallet = await getWalletByAddress(walletAddress);
    }

    if (!wallet) {
      return NextResponse.json(
        { error: "Wallet not found" },
        { status: 404 }
      );
    }

    if (wallet.balance < amount) {
      return NextResponse.json(
        { error: `Insufficient balance. Have ${wallet.balance} ZIPc, need ${amount} ZIPc` },
        { status: 400 }
      );
    }

    const purchase = await createPurchase({
      productId,
      walletAddress,
      amount,
      currency: "ZIPc",
      status: "pending",
      metadata: {
        walletId: wallet.id,
        walletName: wallet.name,
        productName: product.name,
      },
    });

    let txResult = null;
    try {
      txResult = await openPaymentChannel(ZIPPYMESH_PAYMENT_WALLET, amount);
    } catch (paymentError) {
      await updatePurchase(purchase.id, {
        status: "failed",
        metadata: {
          ...purchase.metadata,
          error: paymentError.message,
        },
      });
      return NextResponse.json(
        { error: `Payment failed: ${paymentError.message}` },
        { status: 500 }
      );
    }

    const now = new Date().toISOString();
    await updatePurchase(purchase.id, {
      status: "completed",
      txHash: txResult?.txHash || txResult?.transaction?.hash || null,
      activatedAt: now,
    });

    await addWalletTransaction({
      wallet_id: wallet.id,
      type: "send",
      amount: amount,
      symbol: "ZIPc",
      status: "confirmed",
      counterparty: ZIPPYMESH_PAYMENT_WALLET,
      txHash: txResult?.txHash || null,
      description: `Purchase: ${product.name}`,
    });

    const finalPurchase = await updatePurchase(purchase.id, {});

    return NextResponse.json({
      success: true,
      purchase: finalPurchase,
      message: `Successfully purchased ${product.name}`,
    });
  } catch (error) {
    console.error("[Purchase] Error:", error);
    return NextResponse.json(
      { error: "Purchase failed", details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get("wallet");

  if (!walletAddress) {
    return NextResponse.json(
      { error: "wallet parameter required" },
      { status: 400 }
    );
  }

  try {
    const license = await getActiveLicense(walletAddress);
    if (!license) {
      return NextResponse.json({ activated: false });
    }

    return NextResponse.json({
      activated: true,
      license: {
        productId: license.productId,
        licenseKey: license.licenseKey,
        activatedAt: license.activatedAt,
        expiresAt: license.expiresAt,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to check license", details: error.message },
      { status: 500 }
    );
  }
}
