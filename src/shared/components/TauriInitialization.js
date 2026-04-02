"use client";

import { useEffect } from 'react';
import { isNative, startNativeSidecar } from '@/lib/tauri';

/**
 * TauriInitialization Component
 * 
 * Handles early-stage initialization for Tauri native apps,
 * such as starting the P2P sidecar and configuring window behavior.
 */
export function TauriInitialization() {
    useEffect(() => {
        if (isNative()) {
            console.log("detected Tauri native shell. initializing ecosystem...");

            // Start the sidecar with default edge mode
            startNativeSidecar(['--mode=edge'])
                .then(child => {
                    console.log("native sidecar started. PID:", child?.pid);
                })
                .catch(err => {
                    console.error("failed to start native sidecar:", err);
                });

            // Prevent right-click context menu in production
            if (process.env.NODE_ENV === 'production') {
                const handleContextMenu = (e) => e.preventDefault();
                document.addEventListener('contextmenu', handleContextMenu);
                return () => document.removeEventListener('contextmenu', handleContextMenu);
            }
        }
    }, []);

    return null; // This component doesn't render anything
}
