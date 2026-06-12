"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Input from "@/shared/components/Input";
import Badge from "@/shared/components/Badge";

const PRODUCTS = [
  {
    id: "zippymesh-pro",
    name: "ZippyMesh Pro",
    description: "Full-featured LLM router with unlimited provider connections",
    price: 49.99,
    priceZip: 50,
    features: [
      "Unlimited provider connections",
      "Priority routing & failover",
      "Usage analytics & billing",
      "Local model integration",
      "Community support",
    ],
    badge: "Most Popular",
  },
  {
    id: "zippymesh-enterprise",
    name: "ZippyMesh Enterprise",
    description: "For teams and organizations with advanced requirements",
    price: 199.99,
    priceZip: 200,
    features: [
      "Everything in Pro",
      "Multi-user support",
      "SSO integration",
      "Dedicated support",
      "Custom model pools",
      "SLA guarantee",
    ],
    badge: null,
  },
];

export default function BuyPage() {
  const router = useRouter();
  const [wallets, setWallets] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState("select"); // select | wallet | confirm | success

  useEffect(() => {
    fetchWallets();
  }, []);

  async function fetchWallets() {
    try {
      const res = await fetch("/api/v1/wallet");
      if (res.ok) {
        const data = await res.json();
        setWallets(data);
        if (data.length > 0) {
          setSelectedWallet(data.find((w) => w.isDefault) || data[0]);
        }
      }
    } catch (err) {
      console.error("Failed to fetch wallets:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleSelectProduct(product) {
    setSelectedProduct(product);
    setStep("wallet");
    setError(null);
  }

  function handleBack() {
    if (step === "wallet") {
      setStep("select");
      setSelectedProduct(null);
    } else if (step === "confirm") {
      setStep("wallet");
    }
  }

  function handleProceedToConfirm() {
    if (!selectedWallet) {
      setError("Please select a wallet");
      return;
    }
    if (selectedWallet.balance < selectedProduct.priceZip) {
      setError(
        `Insufficient balance. You need ${selectedProduct.priceZip} ZIPc but have ${selectedWallet.balance.toFixed(2)} ZIPc.`
      );
      return;
    }
    setError(null);
    setStep("confirm");
  }

  async function handlePurchase() {
    if (!selectedProduct || !selectedWallet) return;

    setPurchasing(true);
    setError(null);

    try {
      const res = await fetch("/api/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct.id,
          walletId: selectedWallet.id,
          walletAddress: selectedWallet.address,
          amount: selectedProduct.priceZip,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Purchase failed");
      }

      setStep("success");
    } catch (err) {
      setError(err.message);
    } finally {
      setPurchasing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-text-main mb-2">
            Get ZippyMesh
          </h1>
          <p className="text-text-muted text-lg">
            Pay with ZIPc for instant activation
          </p>
        </div>

        {step === "select" && (
          <div className="grid md:grid-cols-2 gap-6">
            {PRODUCTS.map((product) => (
              <Card
                key={product.id}
                className={`relative cursor-pointer transition-all hover:border-indigo-500 ${
                  selectedProduct?.id === product.id
                    ? "border-indigo-500 ring-2 ring-indigo-500/20"
                    : ""
                }`}
                onClick={() => handleSelectProduct(product)}
              >
                {product.badge && (
                  <Badge
                    variant="info"
                    className="absolute top-4 right-4"
                  >
                    {product.badge}
                  </Badge>
                )}
                <div className="space-y-4">
                  <div>
                    <h2 className="text-2xl font-bold text-text-main">
                      {product.name}
                    </h2>
                    <p className="text-text-muted text-sm mt-1">
                      {product.description}
                    </p>
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-indigo-500">
                      {product.priceZip}
                    </span>
                    <span className="text-text-muted">ZIPc</span>
                    <span className="text-text-muted text-sm">
                      (${product.price} USD)
                    </span>
                  </div>

                  <ul className="space-y-2">
                    {product.features.map((feature, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 text-text-muted text-sm"
                      >
                        <span className="material-symbols-outlined text-green-500 text-sm">
                          check_circle
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Button fullWidth icon="shopping_cart">
                    Select {product.name}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {step === "wallet" && selectedProduct && (
          <Card className="max-w-lg mx-auto">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  icon="arrow_back"
                  onClick={handleBack}
                />
                <div>
                  <h2 className="text-xl font-bold text-text-main">
                    Select Payment Wallet
                  </h2>
                  <p className="text-text-muted text-sm">
                    Choose which wallet to pay from
                  </p>
                </div>
              </div>

              <div className="p-4 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                <div className="flex justify-between items-center">
                  <span className="text-text-muted">Product</span>
                  <span className="font-bold text-text-main">
                    {selectedProduct.name}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-text-muted">Amount</span>
                  <span className="font-bold text-indigo-500 text-xl">
                    {selectedProduct.priceZip} ZIPc
                  </span>
                </div>
              </div>

              {wallets.length === 0 ? (
                <div className="text-center py-8">
                  <span className="material-symbols-outlined text-4xl text-text-muted mb-2">
                    account_balance_wallet
                  </span>
                  <p className="text-text-muted">No wallets found.</p>
                  <Button
                    className="mt-4"
                    onClick={() => router.push("/dashboard/wallet")}
                  >
                    Add a Wallet
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {wallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      onClick={() => setSelectedWallet(wallet)}
                      className={`p-4 rounded-lg border cursor-pointer transition ${
                        selectedWallet?.id === wallet.id
                          ? "border-indigo-500 bg-indigo-500/10"
                          : "border-border hover:border-indigo-500/50"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-bold text-text-main flex items-center gap-2">
                            {wallet.name}
                            {wallet.isDefault && (
                              <Badge variant="info" className="text-xs">
                                Default
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-text-muted font-mono truncate max-w-[200px]">
                            {wallet.address}
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className={`font-bold ${
                              wallet.balance >= selectedProduct.priceZip
                                ? "text-green-500"
                                : "text-red-500"
                            }`}
                          >
                            {wallet.balance?.toFixed(2)} ZIPc
                          </div>
                          {wallet.balance < selectedProduct.priceZip && (
                            <div className="text-xs text-red-500">
                              Insufficient
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
                  {error}
                </div>
              )}

              <Button
                fullWidth
                onClick={handleProceedToConfirm}
                disabled={!selectedWallet}
                icon="arrow_forward"
              >
                Continue to Payment
              </Button>
            </div>
          </Card>
        )}

        {step === "confirm" && selectedProduct && selectedWallet && (
          <Card className="max-w-lg mx-auto">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  icon="arrow_back"
                  onClick={handleBack}
                />
                <div>
                  <h2 className="text-xl font-bold text-text-main">
                    Confirm Purchase
                  </h2>
                  <p className="text-text-muted text-sm">
                    Review and confirm your order
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-sidebar rounded-lg border border-border">
                  <h3 className="font-bold text-text-main mb-2">
                    {selectedProduct.name}
                  </h3>
                  <p className="text-text-muted text-sm">
                    {selectedProduct.description}
                  </p>
                </div>

                <div className="p-4 bg-sidebar rounded-lg border border-border space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">From Wallet</span>
                    <span className="text-text-main">{selectedWallet.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Current Balance</span>
                    <span className="text-text-main">
                      {selectedWallet.balance?.toFixed(2)} ZIPc
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Purchase Amount</span>
                    <span className="text-red-500 font-bold">
                      -{selectedProduct.priceZip} ZIPc
                    </span>
                  </div>
                  <hr className="border-border" />
                  <div className="flex justify-between">
                    <span className="text-text-muted">Remaining Balance</span>
                    <span className="text-text-main font-bold">
                      {(selectedWallet.balance - selectedProduct.priceZip).toFixed(
                        2
                      )}{" "}
                      ZIPc
                    </span>
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
                  {error}
                </div>
              )}

              <Button
                fullWidth
                onClick={handlePurchase}
                loading={purchasing}
                disabled={purchasing}
                icon="payment"
              >
                Pay {selectedProduct.priceZip} ZIPc
              </Button>

              <p className="text-xs text-text-muted text-center">
                By completing this purchase, you agree to our Terms of Service.
              </p>
            </div>
          </Card>
        )}

        {step === "success" && (
          <Card className="max-w-lg mx-auto text-center">
            <div className="space-y-6 py-8">
              <div className="w-16 h-16 mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-green-500 text-4xl">
                  check_circle
                </span>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-text-main">
                  Purchase Complete!
                </h2>
                <p className="text-text-muted mt-2">
                  Thank you for purchasing {selectedProduct?.name}
                </p>
              </div>

              <div className="p-4 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                <p className="text-text-muted text-sm mb-2">
                  Your license has been activated for wallet:
                </p>
                <code className="text-xs font-mono text-indigo-500 break-all">
                  {selectedWallet?.address}
                </code>
              </div>

              <div className="space-y-3">
                <Button
                  fullWidth
                  onClick={() => router.push("/download")}
                  icon="download"
                >
                  Go to Downloads
                </Button>
                <Button
                  fullWidth
                  variant="outline"
                  onClick={() => router.push("/dashboard")}
                  icon="dashboard"
                >
                  Go to Dashboard
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
