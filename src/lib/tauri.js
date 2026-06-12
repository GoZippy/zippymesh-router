/**
 * Tauri Bridge Utility
 * 
 * Provides detection for Tauri environment and abstraction for native APIs.
 */

let tauriApp = null;
let tauriShell = null;

if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    // Only import if running inside Tauri
    import('@tauri-apps/api/app').then(m => tauriApp = m);
    import('@tauri-apps/plugin-shell').then(m => tauriShell = m);
}

/**
 * Check if the application is running in a Tauri native shell.
 */
export const isNative = () => {
    return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
};

/**
 * Execute the ZippyNode sidecar binary.
 * @param {string[]} args Arguments for the binary
 * @returns {Promise<any>}
 */
export async function startNativeSidecar(args = []) {
    if (!isNative()) {
        console.warn("Attempted to start sidecar outside of native environment.");
        return null;
    }

    try {
        const { Command } = await import('@tauri-apps/plugin-shell');
        const command = Command.sidecar('binaries/zippy-node', args);

        command.on('close', data => {
            console.log(`Sidecar exited with code ${data.code} and signal ${data.signal}`);
        });

        command.on('error', error => {
            console.error(`Sidecar error: "${error}"`);
        });

        command.stdout.on('data', line => {
            // Forward logs to a global console or store
            if (window.dispatchEvent) {
                window.dispatchEvent(new CustomEvent('zippy-log', {
                    detail: { line, type: 'stdout', timestamp: new Date().toISOString() }
                }));
            }
        });

        return await command.spawn();
    } catch (e) {
        console.error("Failed to spawn native sidecar:", e);
        throw e;
    }
}
