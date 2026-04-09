"use client";

import { useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { DISPLAY_NAMES } from "@/shared/constants/displayNames";
import { useExpertMode } from "@/shared/hooks/useExpertMode";
import Button from "./Button";
import { ConfirmModal } from "./Modal";

const allNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: "home" },
  { href: "/dashboard/endpoint", label: DISPLAY_NAMES.endpoint, icon: "api" },
  { href: "/dashboard/quickstart", label: "Integration Guide", icon: "integration_instructions" },
  { href: "/dashboard/keys", label: "Virtual Keys", icon: "vpn_key", expertOnly: true },
  { href: "/dashboard/teams", label: "Teams", icon: "group", expertOnly: true },
  { href: "/dashboard/marketplace", label: "Marketplace", icon: "storefront" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/routing", label: DISPLAY_NAMES.playbooks, icon: "alt_route" },
  { href: "/dashboard/combos", label: DISPLAY_NAMES.combos, icon: "layers" },
  { href: "/dashboard/pools", label: DISPLAY_NAMES.pools, icon: "groups", expertOnly: true },
  { href: "/dashboard/analytics", label: "Analytics", icon: "monitoring" },
  { href: "/dashboard/sla", label: "SLA Monitor", icon: "speed", expertOnly: true },
  { href: "/dashboard/compliance", label: "Compliance", icon: "policy", expertOnly: true },
  { href: "/dashboard/prompts", label: "Prompt Library", icon: "article", expertOnly: true },
  { href: "/dashboard/tracer", label: "Request Tracer", icon: "timeline", expertOnly: true },
  { href: "/dashboard/cost-simulator", label: "Cost Simulator", icon: "calculate", expertOnly: true },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/vault-keys", label: "Vault", icon: "security", expertOnly: false },
  { href: "/dashboard/network", label: "Network", icon: "hub", expertOnly: true },
  { href: "/dashboard/monetization", label: "Monetization", icon: "payments", expertOnly: true },
  { href: "/dashboard/wallet", label: "Wallet", icon: "account_balance_wallet", expertOnly: true },
  { href: "/dashboard/compute", label: "Compute", icon: "memory", expertOnly: true },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal", expertOnly: true },
];

// Debug items (only show when ENABLE_REQUEST_LOGS=true)
const debugItems = [
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/profile", label: "Settings", icon: "settings" },
  { href: "/dashboard/about", label: "About", icon: "info" },
  { href: "/dashboard/help", label: "Help", icon: "help" },
];

const compactNavPriority = [
  "/dashboard",
  "/dashboard/endpoint",
  "/dashboard/providers",
  "/dashboard/usage",
  "/dashboard/routing",
  "/dashboard/combos",
  "/dashboard/analytics",
  "/dashboard/quickstart",
];

const SWIPE_SENSITIVITY_OPTIONS = ["low", "medium", "high"];

export default function Sidebar({
  onClose,
  compactMode = false,
  compactQuickNav = true,
  onCompactNavToggle = () => {},
  swipeGesturesEnabled = true,
  onSwipeGesturesToggle = () => {},
  swipeSensitivity = "medium",
  onSwipeSensitivityChange = () => {},
  onSwipeStart,
  onSwipeMove,
  onSwipeEnd,
}) {
  const pathname = usePathname();
  const [showShutdownModal, setShowShutdownModal] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [pluginNavItems, setPluginNavItems] = useState([]);
  const { isExpert, toggle: toggleExpert } = useExpertMode();
  const showCompactControls = compactMode;

  const defaultNavItems = useMemo(() => {
    const baseItems = allNavItems.filter(item => !item.expertOnly || isExpert);
    const existingHrefs = new Set(allNavItems.map(item => item.href));
    const deduplicatedPluginItems = pluginNavItems.filter(item => !existingHrefs.has(item.href));
    return [...baseItems, ...deduplicatedPluginItems];
  }, [isExpert, pluginNavItems]);
  const [navItems, setNavItems] = useState(defaultNavItems);

  const swipeSensitivityLabel =
    swipeSensitivity === "low"
      ? "Gentle"
      : swipeSensitivity === "high"
        ? "Aggressive"
        : "Balanced";

  const compactNavItems = useMemo(() => {
    if (!compactMode || !compactQuickNav) return navItems;
    const prioritized = compactNavPriority
      .map((href) => navItems.find((item) => item.href === href))
      .filter(Boolean);
    const fallback = navItems.filter((item) => !prioritized.some((p) => p.href === item.href));
    return [...prioritized, ...fallback].slice(0, 8);
  }, [compactMode, navItems]);

  const quickNavItems = useMemo(() => {
    if (!compactMode || !compactQuickNav) return [];
    return compactNavItems.slice(0, 5);
  }, [compactMode, compactNavItems]);

  const mainNavItems = useMemo(() => {
    if (!compactMode || !compactQuickNav) return navItems;
    const quickSet = new Set(quickNavItems.map((item) => item.href));
    return compactNavItems.filter((item) => !quickSet.has(item.href));
  }, [compactMode, compactNavItems, quickNavItems]);

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => setShowDebug(data?.enableRequestLogs === true))
      .catch(() => { });
  }, []);

  useEffect(() => {
    fetch("/api/plugins/nav")
      .then(res => res.ok ? res.json() : { navItems: [] })
      .then(data => {
        if (data?.navItems?.length) {
          setPluginNavItems(data.navItems.map((n) => ({ href: n.path, label: n.label, icon: n.icon })));
        }
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    setNavItems(defaultNavItems);
  }, [defaultNavItems]);

  const isActive = (href) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    if (href === "/dashboard/endpoint") {
      return pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShowShutdownModal(false);
    setIsDisconnected(true);
  };

  return (
    <>
      <aside
        className="flex w-72 flex-col border-r border-black/5 dark:border-white/5 bg-vibrancy backdrop-blur-xl transition-colors duration-300"
        onTouchStart={onSwipeStart}
        onTouchMove={onSwipeMove}
        onTouchEnd={onSwipeEnd}
      >
        {/* Logo */}
        <div className="px-6 pt-5 pb-4">
          {compactMode && (
            <button
              onClick={onClose}
              className="mb-3 flex items-center gap-2 text-text-muted hover:text-text-main transition-colors"
              title="Close navigation"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
              <span className="text-xs font-semibold uppercase tracking-wide">Close</span>
            </button>
          )}
          <Link href="/dashboard" className="flex items-center gap-3">
            <img src="/zippymesh-logo.svg" alt="" className="size-9 shrink-0" width="36" height="36" />
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold tracking-tight text-text-main">
                {APP_CONFIG.name}
              </h1>
              <span className="text-xs text-text-muted">v{APP_CONFIG.version}</span>
            </div>
          </Link>
        </div>

        {/* Compact quick-nav for swipe/finger navigation */}
        {compactMode && quickNavItems.length > 0 && (
          <div className="px-4 pb-3">
            <div className="text-[10px] font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
              Quick
            </div>
            <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
              {quickNavItems.map((item) => (
                <Link
                  key={`quick-${item.href}`}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-md border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs font-medium transition-all",
                    isActive(item.href)
                      ? "bg-primary/10 text-primary border-primary/40"
                      : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                  )}
                >
                  <span className="material-symbols-outlined text-sm">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {showCompactControls && (
          <div className="px-4 pb-3">
            <div className="text-[10px] font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
              Compact navigation
            </div>
            <div className="rounded-lg border border-black/10 dark:border-white/10 p-2 bg-surface/60 space-y-2">
              <button
                onClick={onCompactNavToggle}
                className="w-full flex items-center justify-between text-xs font-medium px-2 py-2 rounded-md text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span>Compact quick nav</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-text-muted/40">
                  {compactQuickNav ? "On" : "Off"}
                </span>
              </button>

              <button
                onClick={onSwipeGesturesToggle}
                className="w-full flex items-center justify-between text-xs font-medium px-2 py-2 rounded-md text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span>Swipe gestures</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-text-muted/40">
                  {swipeGesturesEnabled ? "On" : "Off"}
                </span>
              </button>

              <div className="px-2 py-2 text-xs">
                <p className="text-text-muted mb-1.5">Swipe sensitivity</p>
                <div className="flex gap-1">
                  {SWIPE_SENSITIVITY_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => onSwipeSensitivityChange(option)}
                      className={cn(
                        "px-2 py-1 rounded-md text-[11px] border transition-all",
                        option === swipeSensitivity
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "text-text-muted border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                      )}
                    >
                      {option === "low" ? "Gentle" : option === "high" ? "Aggressive" : "Balanced"}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-text-muted px-2">
                Current: {swipeSensitivityLabel}
              </p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto custom-scrollbar">
          {mainNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-4 py-2 rounded-lg transition-all group",
                isActive(item.href)
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface/50 hover:text-text-main"
              )}
            >
              <span
                className={cn(
                  "material-symbols-outlined text-[18px]",
                  isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                )}
              >
                {item.icon}
              </span>
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          ))}

          {/* Debug section (only show when ENABLE_REQUEST_LOGS=true) */}
          {showDebug && (
            <div className="pt-4 mt-2">
              <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
                Debug
              </p>
              {debugItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 rounded-lg transition-all group",
                    isActive(item.href)
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                  )}
                >
                  <span
                    className={cn(
                      "material-symbols-outlined text-[18px]",
                      isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              ))}
            </div>
          )}

          {/* System section */}
          <div className="pt-4 mt-2">
            <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
              System
            </p>
            {systemItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-4 py-2 rounded-lg transition-all group",
                  isActive(item.href)
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                )}
              >
                <span
                  className={cn(
                    "material-symbols-outlined text-[18px]",
                    isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                  )}
                >
                  {item.icon}
                </span>
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            ))}
          </div>
        </nav>

        {/* Footer section */}
        <div className="p-3 border-t border-black/5 dark:border-white/5">
          {/* Info message */}
          <div className="flex items-start gap-2 p-2 rounded-lg bg-surface/50 mb-2">
            <div className="flex items-center justify-center size-6 rounded-md bg-blue-500/10 text-blue-500 shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-[14px]">info</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-text-main leading-relaxed">
                Service is running in terminal. You can close this web page. Shutdown will stop the service.
              </span>
            </div>
          </div>

          {/* Expert Mode Toggle */}
          <div
            className="flex items-center justify-between px-2 py-2 mb-2 rounded-lg hover:bg-surface/50 cursor-pointer select-none"
            onClick={toggleExpert}
            title={isExpert ? "Switch to Basic Mode" : "Switch to Expert Mode"}
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-text-muted">
                {isExpert ? "developer_mode" : "person"}
              </span>
              <span className="text-xs font-medium text-text-muted">
                {isExpert ? "Expert Mode" : "Basic Mode"}
              </span>
            </div>
            <div className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${isExpert ? "bg-primary" : "bg-gray-300 dark:bg-white/20"}`}>
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isExpert ? "translate-x-4" : "translate-x-0.5"}`} />
            </div>
          </div>

          {/* Shutdown button */}
          <Button
            variant="outline"
            fullWidth
            icon="power_settings_new"
            onClick={() => setShowShutdownModal(true)}
            className="text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300"
          >
            Shutdown
          </Button>
        </div>
      </aside>

      {/* Shutdown Confirmation Modal */}
      <ConfirmModal
        isOpen={showShutdownModal}
        onClose={() => setShowShutdownModal(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />

      {/* Disconnected Overlay */}
      {isDisconnected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="text-center p-8">
            <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
              <span className="material-symbols-outlined text-[32px]">power_off</span>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Server Disconnected</h2>
            <p className="text-text-muted mb-6">The proxy server has been stopped.</p>
            <Button variant="secondary" onClick={() => globalThis.location.reload()}>
              Reload Page
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  compactMode: PropTypes.bool,
  compactQuickNav: PropTypes.bool,
  onCompactNavToggle: PropTypes.func,
  swipeGesturesEnabled: PropTypes.bool,
  onSwipeGesturesToggle: PropTypes.func,
  swipeSensitivity: PropTypes.string,
  onSwipeSensitivityChange: PropTypes.func,
  onSwipeStart: PropTypes.func,
  onSwipeMove: PropTypes.func,
  onSwipeEnd: PropTypes.func,
};
