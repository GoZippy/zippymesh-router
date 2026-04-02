"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useRef, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { ThemeToggle, ZippyStatusBar } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { getProviderIconUrl } from "@/shared/constants/provider-urls";

const SUPPORT_URL = "https://zippymesh.com/support?source=zmlr";

function generateTicketShortId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function getMailtoHref() {
  const shortId = generateTicketShortId();
  const subject = encodeURIComponent("[ZMLR Beta] Bug or feedback - TICKET-" + shortId);
  const body = encodeURIComponent(
    "Describe what happened or what you'd like to report:\n\n\nSteps to reproduce (if applicable):\n\n\nApp version: (see Help page or dashboard)\n\n—\nTicket ref: TICKET-" + shortId
  );
  return `mailto:support@gozippy.com?subject=${subject}&body=${body}`;
}

const getPageInfo = (pathname) => {
  if (!pathname) return { title: "", description: "", breadcrumbs: [] };

  // Provider detail page: /dashboard/providers/[id]
  const providerMatch = pathname.match(/\/providers\/([^/]+)$/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    const providerInfo = OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId];
    if (providerInfo) {
      return {
        title: providerInfo.name,
        description: "",
        breadcrumbs: [
          { label: "Providers", href: "/dashboard/providers" },
          { label: providerInfo.name, image: getProviderIconUrl(providerInfo.id) }
        ]
      };
    }
  }

  if (pathname.includes("/providers")) return { title: "Providers", description: "Manage your AI provider connections", breadcrumbs: [] };
  if (pathname.includes("/combos")) return { title: "Combos", description: "Model combos with fallback", breadcrumbs: [] };
  if (pathname.includes("/usage")) return { title: "Usage & Analytics", description: "Monitor your API usage, token consumption, and request logs", breadcrumbs: [] };
  if (pathname.includes("/cli-tools")) return { title: "CLI Tools", description: "Configure CLI tools", breadcrumbs: [] };
  if (pathname.includes("/endpoint")) return { title: "Endpoint", description: "API endpoint configuration", breadcrumbs: [] };
  if (pathname.includes("/about")) return { title: "About", description: "Product overview and routing concepts", breadcrumbs: [] };
  if (pathname.includes("/profile")) return { title: "Settings", description: "Manage your preferences", breadcrumbs: [] };
  if (pathname.includes("/help")) return { title: "Help & Documentation", description: "Understand routing, settings, and workflow", breadcrumbs: [] };
  if (pathname === "/dashboard") return { title: "Endpoint", description: "API endpoint configuration", breadcrumbs: [] };
  return { title: "", description: "", breadcrumbs: [] };
};

export default function Header({ onMenuClick, showMenuButton = true, forceShowMenu = false }) {
  const pathname = usePathname();
  const router = useRouter();
  const { title, description, breadcrumbs } = getPageInfo(pathname);
  const [helpOpen, setHelpOpen] = useState(false);
  const [appVersion, setAppVersion] = useState(null);
  const helpRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data?.version) setAppVersion(data.version); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const handleClickOutside = (e) => {
      if (helpRef.current && !helpRef.current.contains(e.target)) setHelpOpen(false);
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [helpOpen]);

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        router.push("/login");
        router.refresh();
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  return (
    <header className="flex items-center justify-between px-8 py-5 border-b border-black/5 dark:border-white/5 bg-bg/80 backdrop-blur-xl z-10 sticky top-0">
      {/* Mobile menu button */}
      <div className={forceShowMenu ? "flex items-center gap-3" : "flex items-center gap-3 lg:hidden"}>
        {showMenuButton && (
          <button
            onClick={onMenuClick}
            className="text-text-main hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
        )}
      </div>

      {/* Page title with breadcrumbs - desktop */}
      <div className="hidden lg:flex flex-col">
        {breadcrumbs.length > 0 ? (
          <div className="flex items-center gap-2">
            {breadcrumbs.map((crumb, index) => (
              <div key={`${crumb.label}-${crumb.href || "current"}`} className="flex items-center gap-2">
                {index > 0 && (
                  <span className="material-symbols-outlined text-text-muted text-base">
                    chevron_right
                  </span>
                )}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="text-text-muted hover:text-primary transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <div className="flex items-center gap-2">
                    {crumb.image && (
                      <Image
                        src={crumb.image}
                        alt={crumb.label}
                        width={28}
                        height={28}
                        className="object-contain rounded max-w-[28px] max-h-[28px]"
                        sizes="28px"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    )}
                    <h1 className="text-2xl font-semibold text-text-main tracking-tight">
                      {crumb.label}
                    </h1>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : title ? (
          <div>
            <h1 className="text-2xl font-semibold text-text-main tracking-tight">{title}</h1>
            {description && (
              <p className="text-sm text-text-muted">{description}</p>
            )}
          </div>
        ) : null}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-6 ml-auto">
        <ZippyStatusBar />

        <div className="flex items-center gap-3">
          {/* Theme toggle */}
          <ThemeToggle />

          {/* Help / Report bug dropdown */}
          <div className="relative flex items-center gap-1" ref={helpRef}>
            {appVersion && (
              <span className="text-xs text-text-muted hidden sm:inline" title="App version">
                v{appVersion}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setHelpOpen((v) => !v); }}
              className="flex items-center justify-center p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-all"
              title="Report a bug or get help"
              aria-expanded={helpOpen}
              aria-haspopup="true"
            >
              <span className="material-symbols-outlined">help</span>
            </button>
            {helpOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-black/10 dark:border-white/10 bg-bg shadow-lg py-2 z-50"
                role="menu"
              >
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-black/5 dark:border-white/5">
                  <p className="text-sm font-medium text-text-main">
                    Report a bug or get help
                  </p>
                  {appVersion && (
                    <span className="text-xs text-text-muted" title="App version for bug reports">
                      v{appVersion}
                    </span>
                  )}
                </div>
                <a
                  href={SUPPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-black/5 dark:hover:bg-white/5"
                  role="menuitem"
                  onClick={() => setHelpOpen(false)}
                >
                  <span className="material-symbols-outlined text-lg">open_in_new</span>
                  Open Support on ZippyMesh.com
                </a>
                <p className="px-3 py-1 text-xs text-text-muted">
                  Create or link your ZippyMesh.com profile to submit tickets and follow up here.
                </p>
                <a
                  href={getMailtoHref()}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                  role="menuitem"
                  onClick={() => setHelpOpen(false)}
                >
                  <span className="material-symbols-outlined text-lg">mail</span>
                  Email us instead
                </a>
              </div>
            )}
          </div>

          {/* Logout button */}
          <button
            onClick={handleLogout}
            className="flex items-center justify-center p-2 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
            title="Logout"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}

Header.propTypes = {
  onMenuClick: PropTypes.func,
  showMenuButton: PropTypes.bool,
  forceShowMenu: PropTypes.bool,
};
