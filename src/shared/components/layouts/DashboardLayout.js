"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "../Sidebar";
import Header from "../Header";
import ZippyDevTools from "../ZippyDevTools";
import { DevModeProvider, useDevMode } from "../DevModeContext";
import { isNative } from "@/lib/tauri";

const SWIPE_HINT_KEY = "zippymesh-sidebar-swipe-hint-dismissed-v1";
const SWIPE_GESTURE_ENABLED_KEY = "zippymesh-sidebar-swipe-gestures-v1";
const SWIPE_SENSITIVITY_KEY = "zippymesh-sidebar-swipe-sensitivity-v1";
const COMPACT_QUICK_NAV_KEY = "zippymesh-sidebar-compact-quick-nav-v1";

const SWIPE_SENSITIVITY_PRESETS = {
  low: {
    label: "Gentle",
    edgeDelta: 0.9,
    distanceMultiplier: 1.2,
    verticalMultiplier: 1.12,
    velocityMultiplier: 1.1,
  },
  medium: {
    label: "Balanced",
    edgeDelta: 1,
    distanceMultiplier: 1,
    verticalMultiplier: 1,
    velocityMultiplier: 1,
  },
  high: {
    label: "Aggressive",
    edgeDelta: 0.95,
    distanceMultiplier: 0.82,
    verticalMultiplier: 0.94,
    velocityMultiplier: 0.82,
  },
};

function SetupGuard({ children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then(({ firstRun }) => {
        if (firstRun) router.replace("/setup");
        else setReady(true);
      })
      .catch(() => setReady(true));
  }, [router]);
  if (!ready) return null;
  return children;
}

function DashboardLayoutContent({ children, sidebarOpen, setSidebarOpen }) {
  const { isDevOpen, closeDevMode } = useDevMode();
  const [deviceProfile, setDeviceProfile] = useState({
    isTouch: false,
    isPwa: false,
    isNativeApp: false,
    isCompact: false,
  });
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const [swipeGesturesEnabled, setSwipeGesturesEnabled] = useState(true);
  const [swipeSensitivity, setSwipeSensitivity] = useState("medium");
  const [compactQuickNavEnabled, setCompactQuickNavEnabled] = useState(true);
  const touchState = useRef(null);

  const swipeConfig = useMemo(() => {
    const sensitivity = SWIPE_SENSITIVITY_PRESETS[swipeSensitivity] || SWIPE_SENSITIVITY_PRESETS.medium;

    if (deviceProfile.isNativeApp) {
      return {
        edge: Math.max(18, Math.round(34 * sensitivity.edgeDelta)),
        minDistance: Math.round(52 * sensitivity.distanceMultiplier),
        maxVerticalDelta: Math.round(72 * sensitivity.verticalMultiplier),
        velocityThreshold: 0.45 * sensitivity.velocityMultiplier,
      };
    }
    if (deviceProfile.isPwa) {
      return {
        edge: Math.max(16, Math.round(28 * sensitivity.edgeDelta)),
        minDistance: Math.round(58 * sensitivity.distanceMultiplier),
        maxVerticalDelta: Math.round(76 * sensitivity.verticalMultiplier),
        velocityThreshold: 0.55 * sensitivity.velocityMultiplier,
      };
    }
    return {
      edge: Math.max(12, Math.round(24 * sensitivity.edgeDelta)),
      minDistance: Math.round(64 * sensitivity.distanceMultiplier),
      maxVerticalDelta: Math.round(82 * sensitivity.verticalMultiplier),
      velocityThreshold: 0.6 * sensitivity.velocityMultiplier,
    };
  }, [deviceProfile.isNativeApp, deviceProfile.isPwa, swipeSensitivity]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedSwipeGestures = window.localStorage.getItem(SWIPE_GESTURE_ENABLED_KEY);
    const storedSwipeSensitivity = window.localStorage.getItem(SWIPE_SENSITIVITY_KEY);
    const storedCompactQuickNav = window.localStorage.getItem(COMPACT_QUICK_NAV_KEY);

    if (storedSwipeGestures !== null) {
      setSwipeGesturesEnabled(storedSwipeGestures !== "0");
    }
    if (storedSwipeSensitivity && SWIPE_SENSITIVITY_PRESETS[storedSwipeSensitivity]) {
      setSwipeSensitivity(storedSwipeSensitivity);
    }
    if (storedCompactQuickNav !== null) {
      setCompactQuickNavEnabled(storedCompactQuickNav !== "0");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SWIPE_GESTURE_ENABLED_KEY, swipeGesturesEnabled ? "1" : "0");
  }, [swipeGesturesEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SWIPE_SENSITIVITY_KEY, swipeSensitivity);
  }, [swipeSensitivity]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COMPACT_QUICK_NAV_KEY, compactQuickNavEnabled ? "1" : "0");
  }, [compactQuickNavEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const detectEnvironment = () => {
      const isTouch =
        window.matchMedia("(pointer: coarse)").matches ||
        "ontouchstart" in window ||
        navigator.maxTouchPoints > 0;
      const isCompactWidth = window.innerWidth < 1024;
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
      const isIOSStandalone = Boolean(window.navigator.standalone);
      const isNativeApp = isNative();
      const isCompact = isCompactWidth || isTouch || isStandalone || isIOSStandalone || isNativeApp;

      setDeviceProfile((prev) => ({
        ...prev,
        isTouch,
        isPwa: isStandalone || isIOSStandalone,
        isNativeApp,
        isCompact,
      }));
    };

    detectEnvironment();
    window.addEventListener("resize", detectEnvironment);
    return () => window.removeEventListener("resize", detectEnvironment);
  }, []);

  useEffect(() => {
    if (!deviceProfile.isCompact || !swipeGesturesEnabled || typeof window === "undefined") {
      setShowSwipeHint(false);
      return;
    }

    if (window.localStorage.getItem(SWIPE_HINT_KEY) === "1") {
      setShowSwipeHint(false);
      return;
    }

    setShowSwipeHint(true);
  }, [deviceProfile.isCompact, swipeGesturesEnabled]);

  useEffect(() => {
    if (!showSwipeHint) return;
    const timer = setTimeout(() => {
      dismissSwipeHint();
    }, 9000);

    return () => clearTimeout(timer);
  }, [showSwipeHint]);

  const dismissSwipeHint = () => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SWIPE_HINT_KEY, "1");
    setShowSwipeHint(false);
  };

  const openSidebar = () => {
    if (showSwipeHint) dismissSwipeHint();
    setSidebarOpen(true);
  };

  const handleSwipeStart = (event, mode) => {
    if (!deviceProfile.isCompact || !swipeGesturesEnabled || !event.touches || event.touches.length !== 1) {
      return;
    }
    if (showSwipeHint) dismissSwipeHint();
    const touch = event.touches[0];

    if (mode === "open" && touch.clientX > swipeConfig.edge) return;

    touchState.current = {
      mode,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      startedAt: performance.now(),
    };
  };

  const handleSwipeMove = (event) => {
    if (!touchState.current || !event.touches || event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchState.current.lastX = touch.clientX;
    touchState.current.lastY = touch.clientY;
  };

  const handleSwipeEnd = () => {
    const state = touchState.current;
    if (!state) return;
    touchState.current = null;

    const deltaX = state.lastX - state.startX;
    const deltaY = Math.abs(state.lastY - state.startY);
    if (deltaY > swipeConfig.maxVerticalDelta) return;

    const elapsedMs = Math.max(performance.now() - state.startedAt, 1);
    const velocity = Math.abs(deltaX) / elapsedMs;
    const isQuickSwipe = velocity > swipeConfig.velocityThreshold || Math.abs(deltaX) > swipeConfig.minDistance;

    if (state.mode === "open" && deltaX > 0 && isQuickSwipe) {
      dismissSwipeHint();
      setSidebarOpen(true);
      return;
    }

    if (state.mode === "close" && deltaX < 0 && isQuickSwipe) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && deviceProfile.isCompact && swipeGesturesEnabled && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onTouchStart={(event) => handleSwipeStart(event, "close")}
          onTouchMove={handleSwipeMove}
          onTouchEnd={handleSwipeEnd}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <div className={deviceProfile.isCompact ? "hidden" : "hidden lg:flex"}>
        <Sidebar compactMode={deviceProfile.isCompact} />
      </div>

      {/* Sidebar - Mobile */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } ${deviceProfile.isCompact ? "" : "lg:hidden"}`}
      >
        <Sidebar
          onClose={() => setSidebarOpen(false)}
          compactMode={deviceProfile.isCompact}
          compactQuickNav={compactQuickNavEnabled}
          onCompactNavToggle={() => setCompactQuickNavEnabled((value) => !value)}
          swipeGesturesEnabled={swipeGesturesEnabled}
          onSwipeGesturesToggle={() => setSwipeGesturesEnabled((value) => !value)}
          swipeSensitivity={swipeSensitivity}
          onSwipeSensitivityChange={(value) => setSwipeSensitivity(value)}
          onSwipeStart={swipeGesturesEnabled ? (event) => handleSwipeStart(event, "close") : undefined}
          onSwipeMove={handleSwipeMove}
          onSwipeEnd={handleSwipeEnd}
        />
      </div>

      {/* Main content */}
      <main
        className="flex flex-col flex-1 h-full min-w-0 relative transition-colors duration-300"
        onTouchStart={swipeGesturesEnabled ? (event) => handleSwipeStart(event, "open") : undefined}
        onTouchMove={handleSwipeMove}
        onTouchEnd={handleSwipeEnd}
      >
        <Header
          onMenuClick={openSidebar}
          forceShowMenu={deviceProfile.isCompact}
        />

        {showSwipeHint && swipeGesturesEnabled && (
          <div className="pointer-events-none fixed left-3 top-[74px] z-50 max-w-[70vw] rounded-xl border border-primary/25 bg-bg/95 px-3 py-2 shadow-lg backdrop-blur-sm">
            <div className="flex items-start gap-2 text-xs text-text-main">
                <span className="material-symbols-outlined text-sm text-primary animate-pulse shrink-0 mt-0.5">
                  menu_open
              </span>
              <div>
                <p className="font-medium">Need navigation?</p>
                <p>Swipe from the left edge to open the menu, then tap an item.</p>
              </div>
            </div>
            <button
              onClick={dismissSwipeHint}
              className="pointer-events-auto mt-2 ml-auto inline-flex items-center text-[11px] font-semibold tracking-wide uppercase text-primary hover:underline"
            >
              Got it
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-10">
          <div className="max-w-7xl mx-auto">{children}</div>
        </div>
      </main>

      {/* Global DevTools Overlay */}
      <ZippyDevTools isOpen={isDevOpen} onClose={closeDevMode} />
    </div>
  );
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <DevModeProvider>
      <SetupGuard>
      <DashboardLayoutContent
        children={children}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />
      </SetupGuard>
    </DevModeProvider>
  );
}
