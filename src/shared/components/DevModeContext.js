"use client";

import { createContext, useContext, useState } from "react";

const DevModeContext = createContext();

export function DevModeProvider({ children }) {
    const [isDevOpen, setIsDevOpen] = useState(false);

    const toggleDevMode = () => setIsDevOpen(prev => !prev);
    const closeDevMode = () => setIsDevOpen(false);
    const openDevMode = () => setIsDevOpen(true);

    return (
        <DevModeContext.Provider value={{ isDevOpen, toggleDevMode, closeDevMode, openDevMode }}>
            {children}
        </DevModeContext.Provider>
    );
}

export function useDevMode() {
    const context = useContext(DevModeContext);
    if (!context) {
        throw new Error("useDevMode must be used within a DevModeProvider");
    }
    return context;
}
