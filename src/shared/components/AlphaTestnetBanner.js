"use client";

/**
 * AlphaTestnetBanner — displayed on all ZippyCoin/P2P features.
 * Communicates early-alpha status clearly without hiding functionality.
 */
export default function AlphaTestnetBanner({ feature = "this feature" }) {
  return (
    <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/8 px-4 py-3 mb-6">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-yellow-400 text-xl mt-0.5 shrink-0">science</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-yellow-400">Early Alpha — Testnet Only</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
              ZippyCoin Testnet
            </span>
          </div>
          <p className="text-sm text-text-muted leading-relaxed">
            {feature} is part of the ZippyCoin P2P mesh — currently in early alpha on testnet.{" "}
            <strong className="text-text-main">ZippyMesh LLM Router works fully without it</strong> — your AI routing,
            providers, and all dashboard features are unaffected.
          </p>
          <p className="text-sm text-text-muted leading-relaxed mt-1">
            We recommend not relying on ZippyCoin mesh features until the full public release.{" "}
            <a
              href="https://github.com/GoZippy/zippymesh-router/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-yellow-400 hover:text-yellow-300 underline underline-offset-2"
            >
              Bug reports and feedback
            </a>{" "}
            help us improve the mesh and ZippyCoin contract services before launch — thank you for testing early.
          </p>
        </div>
      </div>
    </div>
  );
}
