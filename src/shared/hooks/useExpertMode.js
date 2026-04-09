"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "zmlr_expert_mode";

export function useExpertMode() {
  const [isExpert, setIsExpert] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    setIsExpert(stored === "true");
  }, []);

  const setExpert = (value) => {
    setIsExpert(value);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(value));
    }
  };

  const toggle = () => setExpert(!isExpert);

  return { isExpert, setExpert, toggle };
}
