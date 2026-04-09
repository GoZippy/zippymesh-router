"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { requiresOAuthClientSecret } from "@/shared/constants/providers";
import {
  isDeviceCodeProvider,
  requiresDeviceCodeExtraData,
  requiresManualCallback,
  requiresDeviceCodePkce,
  getManualCallbackPort,
} from "@/shared/constants/providerCapabilities";

// Human-readable labels for each OAuth flow step
const STEP_LABELS = {
  setup: "Enter client secret",
  waiting: "Waiting for authorization...",
  input: "Paste callback URL",
  exchanging: "Exchanging code for tokens...",
  saving: "Saving credentials...",
  success: "Connected",
  error: "Connection failed",
};

/**
 * OAuth Modal Component
 * - Localhost: Auto callback via popup message
 * - Remote: Manual paste callback URL
 */
export default function OAuthModal({ isOpen, provider, providerInfo, connectionId, onSuccess, onClose }) {
  const [step, setStep] = useState("waiting"); // setup | waiting | input | exchanging | saving | success | error
  const [authData, setAuthData] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [error, setError] = useState(null);
  const [isDeviceCode, setIsDeviceCode] = useState(false);
  const [deviceData, setDeviceData] = useState(null);
  const [polling, setPolling] = useState(false);
  const [pollingAttempt, setPollingAttempt] = useState(0);
  const maxAttempts = 150;
  const popupRef = useRef(null);
  const flowStartedRef = useRef(null); // Tracks provider for which flow started
  const isMountedRef = useRef(true);
  const { copied, copy } = useCopyToClipboard();

  // State for client-only values to avoid hydration mismatch
  const [placeholderUrl, setPlaceholderUrl] = useState("/callback?code=...");
  const callbackProcessedRef = useRef(false);
  const needsClientSecret = requiresOAuthClientSecret(provider);

  // Compute callback URL placeholder on client
  useEffect(() => {
    if (typeof window !== "undefined") {
      setPlaceholderUrl(`${window.location.origin}/callback?code=...`);
    }
  }, []);

  // Define all useCallback hooks BEFORE the useEffects that reference them

  // Exchange tokens
  const exchangeTokens = useCallback(async (code, state) => {
    console.log("[OAuthModal] exchangeTokens called", { code: code?.substring(0, 5) + "...", state, authDataPresent: !!authData });

    if (!authData) {
      console.error("[OAuthModal] Missing authData, cannot exchange tokens");
      return;
    }

    try {
      setStep("exchanging");
      console.log("[OAuthModal] Fetching exchange endpoint", `/api/oauth/${provider}/exchange`);
      const res = await fetch(`/api/oauth/${provider}/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          redirectUri: authData.redirectUri,
          codeVerifier: authData.codeVerifier,
          state,
          connectionId,
          oauthClientSecret: oauthClientSecret?.trim() || undefined,
        }),
      });

      const data = await res.json();
      console.log("[OAuthModal] Exchange response", { ok: res.ok, data });

      if (!res.ok) throw new Error(data.error || data.message || "Token exchange failed");

      setStep("success");
      onSuccess?.();
    } catch (err) {
      console.error("[OAuthModal] Exchange error", err);
      setError(err.message || "An unexpected error occurred during token exchange.");
      setStep("error");
    }
  }, [authData, provider, onSuccess, connectionId, oauthClientSecret]);

  // Poll for device code token (Kiro/AWS flow can take longer; allow up to ~12.5 min)
  const startPolling = useCallback(async (deviceCode, codeVerifier, interval, extraData) => {
    setPolling(true);
    setPollingAttempt(0);

    for (let i = 0; i < maxAttempts; i++) {
      if (!isMountedRef.current) return;
      setPollingAttempt(i + 1);
      await new Promise((r) => setTimeout(r, interval * 1000));
      if (!isMountedRef.current) return;

      try {
        const res = await fetch(`/api/oauth/${provider}/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode, codeVerifier, extraData, connectionId }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.errorDescription || data.error || "Failed to poll for token");
        }

        if (data.success) {
          setStep("success");
          setPolling(false);
          setPollingAttempt(0);
          onSuccess?.();
          return;
        }

        if (data.error === "expired_token" || data.error === "access_denied" || (!data.pending && data.error && data.error !== "slow_down")) {
          throw new Error(data.errorDescription || data.error);
        }

        if (data.error === "slow_down") {
          interval = Math.min(interval + 5, 30);
        }
      } catch (err) {
        setError(err.message);
        setStep("error");
        setPolling(false);
        setPollingAttempt(0);
        return;
      }
    }

    setError("Authorization timeout");
    setStep("error");
    setPolling(false);
    setPollingAttempt(0);
  }, [provider, onSuccess]);

  // Start OAuth flow
  const startOAuthFlow = useCallback(async () => {
    if (!provider) return;
    try {
      setError(null);
      if (needsClientSecret && !oauthClientSecret.trim()) {
        const hasSecretRes = await fetch(`/api/oauth/${provider}/has-secret`);
        const hasSecretData = await hasSecretRes.json().catch(() => ({ hasSecret: false }));
        if (!hasSecretData.hasSecret) {
          setStep("setup");
          return;
        }
        // Server has secret (env or persisted); continue to open Google login
      }

      // Show "opening browser" state briefly before redirecting
      setStep("waiting");

      const deviceCodeFlow = isDeviceCodeProvider(provider);
      const deviceCodeNeedsPkce = deviceCodeFlow && requiresDeviceCodePkce(provider);
      const needsDeviceCodeExtraData = deviceCodeFlow && requiresDeviceCodeExtraData(provider);
      const manualCallbackPort = getManualCallbackPort(provider);

      // Device code flow providers (e.g. GitHub, Qwen, Kiro)
      if (deviceCodeFlow) {
        setIsDeviceCode(true);
        setStep("waiting");

        const res = await fetch(`/api/oauth/${provider}/device-code`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setDeviceData(data);

        // Open verification URL
        const verifyUrl = data.verification_uri_complete || data.verification_uri;
        if (verifyUrl) window.open(verifyUrl, "_blank");

        const codeVerifier = deviceCodeNeedsPkce ? data.codeVerifier : null;
        // Start polling - include provider-specific extra data when required.
        const extraData = needsDeviceCodeExtraData ? { _clientId: data._clientId, _clientSecret: data._clientSecret } : null;
        startPolling(data.device_code, codeVerifier, data.interval || 5, extraData);
        return;
      }

      // Authorization code flow - always use localhost with current port unless a provider needs manual callback handling.
      let redirectUri;
      if (requiresManualCallback(provider)) {
        const manualPort = manualCallbackPort || 1455;
        redirectUri = `http://localhost:${manualPort}/auth/callback`;
      } else {
        // Always use localhost with current port for OAuth callback
        const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
        redirectUri = `http://localhost:${port}/callback`;
      }

      const res = await fetch(`/api/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setAuthData({ ...data, redirectUri });

      // Determine localhost at runtime to avoid first-render race on initial modal open.
      const hostname = window.location.hostname;
      const runningOnLocalhost = hostname === "localhost" || hostname === "127.0.0.1";

      // For providers requiring manual callback handling or non-localhost: use manual input mode
      if (requiresManualCallback(provider) || !runningOnLocalhost) {
        setStep("input");
        window.open(data.authUrl, "_blank");
      } else {
        // Localhost (non-Codex): Store pending auth in localStorage so callback (in popup) can read it and perform exchange (sessionStorage is per-window so popup cannot read opener's)
        try {
          localStorage.setItem(
            `oauth_pending_${data.state}`,
            JSON.stringify({
              provider,
              redirectUri,
              codeVerifier: data.codeVerifier,
              connectionId: connectionId || undefined,
              oauthClientSecret: oauthClientSecret?.trim() || undefined,
            })
          );
        } catch (e) {
          console.warn("[OAuthModal] localStorage set failed", e);
        }
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");

        // Check if popup was blocked
        if (!popupRef.current) {
          setStep("input");
          try {
            localStorage.removeItem(`oauth_pending_${data.state}`);
          } catch {}
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err.message || "Failed to start the authorization flow. Please try again.");
        setStep("error");
      }
    }
  }, [provider, startPolling, needsClientSecret, connectionId, oauthClientSecret]);

  // Reset state and start OAuth when modal opens
  useEffect(() => {
    isMountedRef.current = true;
    if (isOpen && provider) {
      // Only start if not already started for this provider
      if (flowStartedRef.current === provider) {
        console.log("[OAuthModal] Flow already started for provider:", provider);
        return;
      }

      console.log("[OAuthModal] Starting flow for provider:", provider);
      flowStartedRef.current = provider;
      setAuthData(null);
      setCallbackUrl("");
      setError(null);
      setIsDeviceCode(false);
      setDeviceData(null);
      setPolling(false);

      // startOAuthFlow() will open Google login or show setup (checks server has-secret when client secret not in state)
      startOAuthFlow();
    }

    return () => {
      if (!isOpen) {
        flowStartedRef.current = null;
        isMountedRef.current = false;
      }
    };
  }, [isOpen, provider, startOAuthFlow, needsClientSecret, connectionId, oauthClientSecret]);

  // Listen for OAuth callback via multiple methods
  useEffect(() => {
    if (!authData) return;
    callbackProcessedRef.current = false; // Reset when authData changes

    // Handler for callback data - only process once
    const handleCallback = async (data) => {
      if (callbackProcessedRef.current) return; // Already processed

      const { code, state, error: callbackError, errorDescription, exchangeDone } = data;

      if (callbackError) {
        callbackProcessedRef.current = true;
        setError(errorDescription || callbackError);
        setStep("error");
        return;
      }

      // Callback page already performed exchange; just refresh UI
      if (exchangeDone) {
        callbackProcessedRef.current = true;
        setStep("success");
        onSuccess?.();
        return;
      }

      if (code) {
        callbackProcessedRef.current = true;
        await exchangeTokens(code, state);
      }
    };

    // Method 1: postMessage from popup
    const handleMessage = (event) => {
      console.log("[OAuthModal] Received message:", event.data, "from", event.origin);
      // Allow localhost to receive from localhost (port might differ in some setups but usually same origin)
      if (event.origin !== window.location.origin) {
        console.warn("[OAuthModal] Origin mismatch:", event.origin, "expected", window.location.origin);
        // return; // Commenting out strict origin check for debugging
      }

      if (event.data?.type === "oauth_callback") {
        console.log("[OAuthModal] Processing oauth_callback payload");
        handleCallback(event.data.data);
      }
    };
    window.addEventListener("message", handleMessage);

    // Method 2: BroadcastChannel
    let channel;
    try {
      channel = new BroadcastChannel("oauth_callback");
      channel.onmessage = (event) => handleCallback(event.data);
    } catch (e) {
      console.log("BroadcastChannel not supported");
    }

    // Method 3: localStorage event
    const handleStorage = (event) => {
      if (event.key === "oauth_callback" && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          handleCallback(data);
          localStorage.removeItem("oauth_callback");
        } catch (e) {
          console.log("Failed to parse localStorage data");
        }
      }
    };
    window.addEventListener("storage", handleStorage);

    // Also check localStorage on mount (in case callback already happened)
    try {
      const stored = localStorage.getItem("oauth_callback");
      if (stored) {
        const data = JSON.parse(stored);
        // Only use if recent (within 30 seconds)
        if (data.timestamp && Date.now() - data.timestamp < 30000) {
          handleCallback(data);
          localStorage.removeItem("oauth_callback");
        }
      }
    } catch {
      // localStorage may be unavailable or data may be malformed - ignore silently
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      if (channel) channel.close();
    };
  }, [authData, exchangeTokens]);

  // Handle manual URL input
  const handleManualSubmit = async () => {
    try {
      setError(null);
      const url = new URL(callbackUrl);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
        throw new Error(url.searchParams.get("error_description") || errorParam);
      }

      if (!code) {
        throw new Error("No authorization code found in URL");
      }

      await exchangeTokens(code, state);
    } catch (err) {
      setError(err.message || "Failed to process the callback URL. Please check the URL and try again.");
      setStep("error");
    }
  };

  if (!provider || !providerInfo) return null;

  // Derive a visible step label for the progress indicator
  const stepLabel = STEP_LABELS[step] || step;

  return (
    <Modal isOpen={isOpen} title={`Connect ${providerInfo.name}`} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Step progress indicator (shown for non-terminal steps) */}
        {step !== "success" && step !== "error" && (
          <div className="flex items-center gap-2 text-xs text-text-muted pb-1 border-b border-border">
            {(step === "waiting" || step === "exchanging" || step === "saving") ? (
              <span className="material-symbols-outlined text-[14px] animate-spin text-primary">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[14px] text-text-muted">radio_button_unchecked</span>
            )}
            <span>{stepLabel}</span>
          </div>
        )}

        {/* Setup Step - client secret input */}
        {step === "setup" && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-text-muted">
              {connectionId
                ? "Your connection needs the OAuth client secret to sign in again. Enter it below, then you’ll be sent to the provider to authorize."
                : "Enter your OAuth client secret to continue. This will be stored with your provider connection. Then you’ll sign in with the provider to connect your account."}
            </p>
            <Input
              label="OAuth Client Secret"
              type="password"
              value={oauthClientSecret}
              onChange={(e) => setOauthClientSecret(e.target.value)}
              placeholder="GOCSPX-..."
            />
            {/* Help text for client secret */}
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300 flex gap-2">
              <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">info</span>
              <span>
                This is a required app-level OAuth credential. You only need to enter this once. 
                It can also be set in your <code className="font-mono bg-blue-100 dark:bg-blue-900/50 px-1 rounded">.env</code> file 
                (see <code className="font-mono bg-blue-100 dark:bg-blue-900/50 px-1 rounded">.env.example</code>). 
                If entered here, it will be encrypted securely using AES-256-GCM and safely persisted on your machine 
                (in your OS app data directory) so it survives any future updates or migrations.
              </span>
            </div>
            <div className="flex gap-2">
              <Button onClick={startOAuthFlow} fullWidth disabled={!oauthClientSecret.trim()}>
                Continue
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === "waiting" && !isDeviceCode && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Opening Browser...</h3>
            <p className="text-sm text-text-muted mb-1">
              A popup window should open with the {providerInfo?.name} sign-in page.
            </p>
            <p className="text-sm text-text-muted mb-4">
              Complete sign-in there, then return here — this dialog will update automatically.
            </p>
            <Button variant="ghost" onClick={() => setStep("input")}>
              Popup blocked? Enter URL manually
            </Button>
          </div>
        )}

        {/* Exchanging tokens intermediate step */}
        {step === "exchanging" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Exchanging Code for Tokens...</h3>
            <p className="text-sm text-text-muted">
              Almost there — securely exchanging the authorization code for access tokens.
            </p>
          </div>
        )}

        {/* Device Code Flow - Waiting */}
        {step === "waiting" && isDeviceCode && deviceData && (
          <>
            <div className="text-center py-4">
              <p className="text-sm text-text-muted mb-4">
                Visit the URL below and enter the code:
              </p>
              <div className="bg-sidebar p-4 rounded-lg mb-4">
                <p className="text-xs text-text-muted mb-1">Verification URL</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm break-all">{deviceData.verification_uri}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "verify_url" ? "check" : "content_copy"}
                    onClick={() => copy(deviceData.verification_uri, "verify_url")}
                  />
                </div>
              </div>
              <div className="bg-primary/10 p-4 rounded-lg">
                <p className="text-xs text-text-muted mb-1">Your Code</p>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-2xl font-mono font-bold text-primary">{deviceData.user_code}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "user_code" ? "check" : "content_copy"}
                    onClick={() => copy(deviceData.user_code, "user_code")}
                  />
                </div>
              </div>
            </div>
            {polling && (
              <div className="flex flex-col items-center justify-center gap-2 text-sm text-text-muted">
                <div className="w-full max-w-xs h-2 bg-border rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.round((pollingAttempt / maxAttempts) * 100)}%` }}
                  />
                </div>
                <span className="material-symbols-outlined animate-spin">progress_activity</span>
                Waiting for authorization... ({pollingAttempt}/{maxAttempts})
              </div>
            )}
          </>
        )}

        {/* Manual Input Step */}
        {step === "input" && !isDeviceCode && (
          <>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">Step 1: Open this URL in your browser</p>
                <div className="flex gap-2">
                  <Input value={authData?.authUrl || ""} readOnly className="flex-1 font-mono text-xs" />
                  <Button variant="secondary" icon={copied === "auth_url" ? "check" : "content_copy"} onClick={() => copy(authData?.authUrl, "auth_url")}>
                    Copy
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Step 2: Paste the callback URL here</p>
                <p className="text-xs text-text-muted mb-2">
                  After authorization, copy the full URL from your browser.
                </p>
                <Input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder={placeholderUrl}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>
                Connect
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* Success Step */}
        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-text-muted mb-4">
              Your {providerInfo.name} account has been connected.
            </p>
            <Button onClick={onClose} fullWidth>
              Done
            </Button>
          </div>
        )}

        {/* Error Step */}
        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 mb-4 text-left">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Error details</p>
                <p className="text-sm text-red-700 dark:text-red-300 break-words">{error}</p>
              </div>
            )}
            <div className="flex gap-2">
              {needsClientSecret && (
                <Button onClick={() => setStep("setup")} variant="secondary" fullWidth>
                  Enter Client Secret
                </Button>
              )}
              <Button onClick={startOAuthFlow} variant="secondary" fullWidth>
                Try Again
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

OAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  connectionId: PropTypes.string,
  providerInfo: PropTypes.shape({
    name: PropTypes.string,
  }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
