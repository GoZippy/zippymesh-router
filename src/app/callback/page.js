"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * OAuth Callback Page Content
 */
function CallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("processing");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    const callbackData = {
      code,
      state,
      error,
      errorDescription,
      fullUrl: window.location.href,
    };

    const notifyOpener = (exchangeDone = true) => {
      if (typeof window.opener !== "undefined" && window.opener) {
        try {
          window.opener.postMessage(
            { type: "oauth_callback", data: { ...callbackData, exchangeDone } },
            "*"
          );
        } catch (e) {
          console.log("postMessage failed:", e);
        }
      }
      try {
        const ch = new BroadcastChannel("oauth_callback");
        ch.postMessage({ ...callbackData, exchangeDone });
        ch.close();
      } catch (e) {}
      try {
        localStorage.setItem(
          "oauth_callback",
          JSON.stringify({ ...callbackData, exchangeDone, timestamp: Date.now() })
        );
      } catch (e) {}
    };

    const showSuccess = () => {
      setStatus("success");
      setTimeout(() => {
        window.close();
        setTimeout(() => setStatus("done"), 500);
      }, 1500);
    };

    let cancelled = false;

    (async () => {
      if (error) {
        notifyOpener(false);
        setStatus("error");
        setErrorMsg(errorDescription || error);
        return;
      }

      if (!code) {
        setTimeout(() => setStatus("manual"), 0);
        return;
      }

      // Do the exchange in the callback so the connection is always saved (opener may miss postMessage). Use localStorage so popup can read what opener stored.
      const pendingKey = state ? `oauth_pending_${state}` : null;
      let pending = null;
      try {
        if (pendingKey) pending = localStorage.getItem(pendingKey);
      } catch (e) {}

      if (pending) {
        try {
          const { provider, redirectUri, codeVerifier, connectionId } = JSON.parse(pending);
          const res = await fetch(`/api/oauth/${provider}/exchange`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code,
              redirectUri,
              codeVerifier,
              state,
              connectionId: connectionId || undefined,
            }),
          });
          const data = await res.json();
          try {
            if (pendingKey) sessionStorage.removeItem(pendingKey);
          } catch (e) {}
          if (cancelled) return;
          if (!res.ok) {
            setStatus("error");
            setErrorMsg(data.error || "Token exchange failed");
            notifyOpener(false);
            return;
          }
          notifyOpener(true);
          showSuccess();
          return;
        } catch (err) {
          try {
            if (pendingKey) sessionStorage.removeItem(pendingKey);
          } catch (e) {}
          if (cancelled) return;
          console.error("[Callback] Exchange failed", err);
          setStatus("error");
          setErrorMsg(err.message || "Exchange failed");
          notifyOpener(false);
          return;
        }
      }

      // No pending data: send code to opener so it can exchange (legacy path)
      notifyOpener(false);
      setStatus("success");
      setTimeout(() => {
        window.close();
        setTimeout(() => setStatus("done"), 500);
      }, 1500);
    })();

    return () => { cancelled = true; };
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center p-8 max-w-md">
        {status === "processing" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Processing...</h1>
            <p className="text-text-muted">Please wait while we complete the authorization.</p>
          </>
        )}

        {(status === "success" || status === "done") && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Authorization Successful!</h1>
            <p className="text-text-muted">
              {status === "success" ? "This window will close automatically..." : "You can close this tab now."}
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Authorization failed</h1>
            <p className="text-text-muted">{errorMsg}</p>
          </>
        )}

        {status === "manual" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-yellow-600">info</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Copy This URL</h1>
            <p className="text-text-muted mb-4">
              Please copy the URL from the address bar and paste it in the application.
            </p>
            <div className="bg-surface border border-border rounded-lg p-3 text-left">
              <code className="text-xs break-all">{typeof window !== "undefined" ? window.location.href : ""}</code>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * OAuth Callback Page
 * Receives callback from OAuth providers; performs token exchange here when possible so connection is always saved.
 */
export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center p-8">
          <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
          </div>
          <p className="text-text-muted">Loading...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
