"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";

const DOWNLOAD_OPTIONS = [
  {
    id: "npm",
    name: "NPM Package",
    description: "Install via npm/npx for Node.js projects",
    icon: "terminal",
    command: "npx zippymesh@latest",
    platform: "all",
  },
  {
    id: "windows",
    name: "Windows Installer",
    description: "Standalone installer for Windows 10/11",
    icon: "desktop_windows",
    filename: "ZippyMesh-Setup-1.0.0.exe",
    size: "45 MB",
    platform: "windows",
  },
  {
    id: "mac",
    name: "macOS App",
    description: "Universal binary for Intel and Apple Silicon",
    icon: "laptop_mac",
    filename: "ZippyMesh-1.0.0.dmg",
    size: "52 MB",
    platform: "mac",
  },
  {
    id: "linux",
    name: "Linux AppImage",
    description: "Portable AppImage for most Linux distributions",
    icon: "computer",
    filename: "ZippyMesh-1.0.0.AppImage",
    size: "48 MB",
    platform: "linux",
  },
  {
    id: "docker",
    name: "Docker Image",
    description: "Pre-built container for server deployments",
    icon: "deployed_code",
    command: "docker pull zippymesh/router:latest",
    platform: "all",
  },
];

export default function DownloadPage() {
  const router = useRouter();
  const [wallets, setWallets] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [license, setLicense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    fetchWallets();
  }, []);

  useEffect(() => {
    if (selectedWallet) {
      checkLicense(selectedWallet.address);
    }
  }, [selectedWallet]);

  async function fetchWallets() {
    try {
      const res = await fetch("/api/v1/wallet");
      if (res.ok) {
        const data = await res.json();
        setWallets(data);
        if (data.length > 0) {
          const defaultWallet = data.find((w) => w.isDefault) || data[0];
          setSelectedWallet(defaultWallet);
        }
      }
    } catch (err) {
      console.error("Failed to fetch wallets:", err);
    } finally {
      setLoading(false);
    }
  }

  async function checkLicense(walletAddress) {
    setChecking(true);
    try {
      const res = await fetch(`/api/purchase?wallet=${encodeURIComponent(walletAddress)}`);
      if (res.ok) {
        const data = await res.json();
        setLicense(data.activated ? data.license : null);
      } else {
        setLicense(null);
      }
    } catch (err) {
      console.error("Failed to check license:", err);
      setLicense(null);
    } finally {
      setChecking(false);
    }
  }

  function copyToClipboard(text, id) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleDownload(option) {
    if (option.command) {
      copyToClipboard(option.command, option.id);
    } else {
      alert(`Download would start for ${option.filename}`);
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
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-text-main mb-2">Downloads</h1>
          <p className="text-text-muted text-lg">
            Get ZippyMesh for your platform
          </p>
        </div>

        {wallets.length > 0 && (
          <Card className="mb-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-text-main">License Status</h3>
                <p className="text-text-muted text-sm">
                  Select your wallet to check license
                </p>
              </div>

              <div className="flex items-center gap-4">
                <select
                  value={selectedWallet?.id || ""}
                  onChange={(e) => {
                    const wallet = wallets.find((w) => w.id === e.target.value);
                    setSelectedWallet(wallet);
                  }}
                  className="bg-sidebar border border-border rounded-lg px-4 py-2 text-sm text-text-main"
                >
                  {wallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.name}
                    </option>
                  ))}
                </select>

                {checking ? (
                  <Badge variant="default">Checking...</Badge>
                ) : license ? (
                  <Badge variant="success">
                    <span className="material-symbols-outlined text-sm mr-1">
                      verified
                    </span>
                    Licensed
                  </Badge>
                ) : (
                  <Badge variant="error">Not Licensed</Badge>
                )}
              </div>
            </div>

            {license && (
              <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-text-muted">Product:</span>
                    <span className="ml-2 text-text-main font-medium">
                      {license.productId}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted">License Key:</span>
                    <code className="ml-2 text-indigo-500 text-xs">
                      {license.licenseKey}
                    </code>
                  </div>
                  <div>
                    <span className="text-text-muted">Activated:</span>
                    <span className="ml-2 text-text-main">
                      {license.activatedAt
                        ? new Date(license.activatedAt).toLocaleDateString()
                        : "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted">Expires:</span>
                    <span className="ml-2 text-text-main">
                      {license.expiresAt
                        ? new Date(license.expiresAt).toLocaleDateString()
                        : "Never"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {!license && !checking && (
              <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-yellow-500 text-sm font-medium">
                    No active license found for this wallet
                  </p>
                  <p className="text-text-muted text-xs">
                    Purchase ZippyMesh to unlock downloads
                  </p>
                </div>
                <Button
                  onClick={() => router.push("/buy")}
                  icon="shopping_cart"
                  size="sm"
                >
                  Buy Now
                </Button>
              </div>
            )}
          </Card>
        )}

        {wallets.length === 0 && (
          <Card className="mb-8 text-center py-8">
            <span className="material-symbols-outlined text-4xl text-text-muted mb-2">
              account_balance_wallet
            </span>
            <h3 className="text-text-main font-bold mb-2">No Wallets Found</h3>
            <p className="text-text-muted text-sm mb-4">
              Add a wallet to check your license status
            </p>
            <Button onClick={() => router.push("/dashboard/wallet")} icon="add">
              Add Wallet
            </Button>
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {DOWNLOAD_OPTIONS.map((option) => (
            <Card
              key={option.id}
              className={`transition ${
                !license
                  ? "opacity-60 pointer-events-none"
                  : "hover:border-indigo-500"
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-indigo-500/20 rounded-lg flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-indigo-500 text-2xl">
                    {option.icon}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-text-main">{option.name}</h3>
                  <p className="text-text-muted text-sm mt-1">
                    {option.description}
                  </p>

                  {option.command && (
                    <div className="mt-3 p-2 bg-sidebar rounded-lg border border-border flex items-center justify-between">
                      <code className="text-xs text-indigo-500 truncate">
                        {option.command}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={copied === option.id ? "check" : "content_copy"}
                        onClick={() => handleDownload(option)}
                        className="h-6 w-6 p-0 ml-2 shrink-0"
                      />
                    </div>
                  )}

                  {option.filename && (
                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-xs text-text-muted">
                        {option.filename} ({option.size})
                      </div>
                      <Button
                        size="sm"
                        icon="download"
                        onClick={() => handleDownload(option)}
                        disabled={!license}
                      >
                        Download
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card className="mt-8">
          <h3 className="font-bold text-text-main mb-4">Quick Start</h3>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0">
                1
              </div>
              <div>
                <p className="text-text-main font-medium">Install ZippyMesh</p>
                <p className="text-text-muted text-sm">
                  Use npm, download the installer, or pull the Docker image
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0">
                2
              </div>
              <div>
                <p className="text-text-main font-medium">Configure Providers</p>
                <p className="text-text-muted text-sm">
                  Add your API keys for OpenAI, Anthropic, Google, and more
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0">
                3
              </div>
              <div>
                <p className="text-text-main font-medium">Start Routing</p>
                <p className="text-text-muted text-sm">
                  Point your apps to localhost:20128 and enjoy unified LLM access
                </p>
              </div>
            </div>
          </div>
        </Card>

        <div className="text-center mt-8">
          <Button
            variant="outline"
            onClick={() => router.push("/dashboard")}
            icon="arrow_back"
          >
            Back to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
