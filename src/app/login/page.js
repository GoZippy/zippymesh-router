"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const router = useRouter();

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        console.log(`[Login] Checking settings...`);
        const res = await fetch(`${baseUrl}/api/settings`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          console.log(`[Login] hasPassword: ${data.hasPassword}, requireLogin: ${data.requireLogin}`);
          if (data.requireLogin === false) {
            router.push("/dashboard");
            router.refresh();
            return;
          }
          if (data.hasPassword === false) {
            router.push("/setup");
            router.refresh();
            return;
          }
          setHasPassword(true);
        } else {
          console.error(`[Login] Settings fetch failed: ${res.status}`);
          // Safe fallback on non-OK response to avoid infinite loading state.
          setHasPassword(true);
        }
      } catch (err) {
        console.error(`[Login] Error in checkAuth: ${err.message}`);
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        const data = await res.json();
        // If logged in via env fallback (no permanent credential stored yet),
        // redirect to setup to complete the permanent password setup.
        if (data.needsPasswordSetup) {
          router.push("/setup");
        } else {
          router.push("/dashboard");
        }
        router.refresh();
      } else {
        const data = await res.json();
        if (data.setupRequired) {
          router.push("/setup");
          router.refresh();
          return;
        }
        setError(data.error || "Invalid password");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Show loading state while checking password
  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">Zippy Mesh</h1>
          <p className="text-text-muted">Enter your password to access the dashboard</p>
        </div>

        <Card>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={loading}
            >
              Login
            </Button>

            <p className="text-xs text-center text-text-muted mt-2">
              Your credentials are stored securely and persist across updates.
              Use INITIAL_PASSWORD from .env for first-time login or recovery.
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
