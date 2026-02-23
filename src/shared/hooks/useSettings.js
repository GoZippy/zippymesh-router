"use client";

import { useState, useEffect, useCallback } from "react";

export function useSettings() {
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchSettings = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/settings");
            if (!res.ok) throw new Error("Failed to fetch settings");
            const data = await res.json();
            setSettings(data);
            setError(null);
        } catch (err) {
            console.error("Error fetching settings:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const updateSettings = async (newSettings) => {
        try {
            const res = await fetch("/api/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newSettings),
            });

            if (!res.ok) throw new Error("Failed to update settings");
            const updated = await res.json();
            setSettings(updated);
            return updated;
        } catch (err) {
            console.error("Error updating settings:", err);
            throw err;
        }
    };

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    return {
        settings,
        loading,
        error,
        updateSettings,
        refreshSettings: fetchSettings
    };
}
