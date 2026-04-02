use tauri::Manager;
use tauri_plugin_shell::ShellExt;

/// How long to wait for the Node server to become ready (ms per poll, max polls).
const HEALTH_POLL_INTERVAL_MS: u64 = 500;
const HEALTH_MAX_POLLS: u32 = 60; // 30 seconds total

/// Poll http://localhost:20128/api/health until it responds 200 or we time out.
async fn wait_for_server() -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap_or_default();

    for _ in 0..HEALTH_MAX_POLLS {
        if let Ok(resp) = client.get("http://localhost:20128/api/health").send().await {
            if resp.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Resolve the standalone resource directory so the sidecar can find server.js.
            let standalone_dir = app
                .path()
                .resource_dir()
                .expect("failed to get resource dir")
                .join("standalone");

            // Spawn the zippy-node sidecar (the Next.js standalone server).
            let shell = app.shell();
            let _child = shell
                .sidecar("binaries/zippy-node")
                .expect("zippy-node sidecar not found")
                .env("ZIPPY_STANDALONE_DIR", standalone_dir.to_string_lossy().as_ref())
                .spawn()
                .expect("failed to spawn zippy-node sidecar");

            // Wait for the server to be ready in a background task, then show the window.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let ready = wait_for_server().await;
                if !ready {
                    log::warn!("zippy-node did not become ready within 30s — opening anyway");
                }
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });

            // Hide the window initially; it will be shown once the server is ready.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
