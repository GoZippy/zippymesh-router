"use client";

import { useState, useEffect, useRef } from "react";

const CHECK_INTERVAL_MS = 60 * 1000; // check every 60s
const DISMISS_KEY = "zippymesh-version-banner-dismissed";

/**
 * Detects when the server has been upgraded to a version different from the
 * client bundle currently loaded in the browser. This happens when the user
 * upgrades ZMLR without clearing browser cache.
 *
 * Returns { mismatch: bool, serverVersion: string, clientVersion: string, dismiss: fn }
 */
export function useVersionCheck() {
  const clientVersion = process.env.NEXT_PUBLIC_BUILD_VERSION || "unknown";
  const [serverVersion, setServerVersion] = useState(null);
  const [mismatch, setMismatch] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    // Restore dismiss state from sessionStorage (resets on tab close)
    try {
      const prev = sessionStorage.getItem(DISMISS_KEY);
      if (prev === clientVersion) setDismissed(true);
    } catch (_) {}
  }, [clientVersion]);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const sv = data.version;
        if (!sv) return;
        setServerVersion(sv);
        // Mismatch: server has a different version than what's baked in the bundle
        if (clientVersion !== "unknown" && sv !== clientVersion) {
          setMismatch(true);
        }
      } catch (_) {
        // Network error — server may be restarting; don't show banner
      }
    }

    check();
    timerRef.current = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [clientVersion]);

  function dismiss() {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, clientVersion); } catch (_) {}
  }

  return { mismatch: mismatch && !dismissed, serverVersion, clientVersion, dismiss };
}
