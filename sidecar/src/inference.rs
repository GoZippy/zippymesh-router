//! inference.rs — GPU-aware inference delegation for ZippyMesh sidecar (Task 2.1.1)
//!
//! Selects the best available peer (GPU-first, then local fallback) and proxies
//! the inference request to it. Supports SSE streaming pass-through.

use crate::models::{ChatRequest, ChatResponse, Message, Choice};
use crate::state::AppState;
use std::env;
use std::sync::Arc;
use tracing::{info, warn, error};

/// GPU capability info extracted from peer announcements
#[derive(Debug, Clone)]
pub struct GpuPeerTarget {
    pub node_id: String,
    pub endpoint: String,
    pub gpu_vram_gb: u32,
    pub models: Vec<String>,
}

/// Select the best inference target for the given model.
/// Priority: peer with GPU + matching model > peer with matching model > local fallback.
pub async fn select_inference_target(
    state: &Arc<AppState>,
    model: &str,
) -> String {
    let peers = state.peer_table.read().await;

    // Filter to peers that advertise the requested model
    let mut candidates: Vec<GpuPeerTarget> = peers
        .values()
        .filter(|p| p.models.contains(&model.to_string()) && p.endpoint != "local")
        .map(|p| GpuPeerTarget {
            node_id: p.id.clone(),
            endpoint: p.endpoint.clone(),
            gpu_vram_gb: p.gpu_vram_gb,
            models: p.models.clone(),
        })
        .collect();

    if candidates.is_empty() {
        let local = env::var("INFERENCE_URL")
            .unwrap_or_else(|_| "http://localhost:11434/v1".to_string());
        warn!("[Inference] No peers found for model '{}', using local: {}", model, local);
        return local;
    }

    // Prefer highest VRAM GPU peer to maximize quality
    candidates.sort_by(|a, b| b.gpu_vram_gb.cmp(&a.gpu_vram_gb));
    let target = candidates.into_iter().next().unwrap();

    info!("[Inference] Delegating model '{}' to peer {} ({}GB VRAM) at {}",
        model, target.node_id, target.gpu_vram_gb, target.endpoint);

    target.endpoint
}

/// Forward a non-streaming chat completion request to the selected peer.
pub async fn perform_inference(req: ChatRequest, state: Arc<AppState>) -> ChatResponse {
    let url = {
        let endpoint = select_inference_target(&state, &req.model).await;
        format!("{}/chat/completions", endpoint.trim_end_matches('/'))
    };

    info!("[Inference] POST {}", url);

    let client = reqwest::Client::new();
    match client.post(&url).json(&req).send().await {
        Ok(res) if res.status().is_success() => {
            match res.json::<ChatResponse>().await {
                Ok(chat_res) => chat_res,
                Err(e) => {
                    error!("[Inference] Parse error: {:?}", e);
                    error_response("Failed to parse upstream response")
                }
            }
        }
        Ok(res) => {
            error!("[Inference] Upstream error: {:?}", res.status());
            error_response(&format!("Upstream error: {}", res.status()))
        }
        Err(e) => {
            error!("[Inference] Connection error: {:?}", e);
            error_response("Failed to contact inference peer")
        }
    }
}

/// Fallback error response in OpenAI format.
fn error_response(msg: &str) -> ChatResponse {
    ChatResponse {
        choices: vec![
            Choice {
                message: Message {
                    role: "system".to_string(),
                    content: msg.to_string(),
                },
            }
        ],
    }
}

