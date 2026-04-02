// Community Edition Stub — upgrade to Pro for full functionality
"use client";

export default function WalletPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
        <span className="material-symbols-outlined text-[32px]">account_balance_wallet</span>
      </div>
      <h2 className="text-xl font-semibold mb-2">ZippyMesh Pro Required</h2>
      <p className="text-text-muted mb-6 max-w-md">
        The ZippyCoin wallet and payment features are available in ZippyMesh Pro.
      </p>
      <a
        href="https://zippymesh.io/pro"
        className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
      >
        Upgrade to Pro
      </a>
    </div>
  );
}
