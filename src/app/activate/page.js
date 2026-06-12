"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "https://app.zippymesh.com";

export default function ActivatePage() {
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/activation/check?wallet=${encodeURIComponent(wallet)}`);
      const data = await res.json();
      if (data.activated) {
        document.cookie = `zippymesh_wallet=${encodeURIComponent(wallet)}; path=/; max-age=${60 * 60 * 24 * 365}`;
        router.push("/dashboard");
      } else {
        setError("Wallet not activated. Link wallet and claim at " + PORTAL_URL + "/claim");
      }
    } catch (err) {
      setError("Check failed. Please activate at " + PORTAL_URL + "/claim");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="mb-4 text-xl font-semibold">Activation Required</h1>
        <p className="mb-6 text-sm text-zinc-400">
          Link your wallet and activate at{" "}
          <a href={PORTAL_URL + "/claim"} className="text-blue-400 hover:underline">
            {PORTAL_URL}/claim
          </a>
          , then enter your wallet address below.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x..."
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-zinc-900 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Checking…" : "Verify & Continue"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500">
          <a href="/dashboard" className="hover:underline">Skip (if activation disabled)</a>
        </p>
      </div>
    </div>
  );
}
